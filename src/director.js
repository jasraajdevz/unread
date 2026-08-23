/* The director: turns (runSeed, day) into a transcript.
 *
 * Pure. No DOM, no Date, no Math.random -- everything derives from the seed, so the same
 * run produces the same transcript and a bug is reproducible from its seed alone (D24).
 * Loads as a CommonJS module in the tests and as a global in the built page.
 *
 * Act I's mechanic is decay (ladder.json): each day slightly fewer people reply. Nothing
 * else changes for twenty days, and that restraint is the point.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Director = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- seeded randomness ------------------------------------------------- */

  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededRandom(parts) {
    return mulberry32(xmur3(parts.join('|'))());
  }

  function pickWeighted(rand, items, weightOf) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += Math.max(0, weightOf(items[i]));
    if (total <= 0) return null;
    var roll = rand() * total;
    for (i = 0; i < items.length; i++) {
      roll -= Math.max(0, weightOf(items[i]));
      if (roll <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /* ---- content access ---------------------------------------------------- */

  function indexCast(cast) {
    var byId = {};
    (cast.cast || []).forEach(function (c) { byId[c.id] = c; });
    return byId;
  }

  function ladderFor(ladder, day) {
    var found = null;
    (ladder.days || []).forEach(function (d) { if (d.day === day) found = d; });
    return found;
  }

  function actFor(ladder, day) {
    var entry = ladderFor(ladder, day);
    return entry ? entry.act : null;
  }

  function fillSlots(text, chosen) {
    return text.replace(/\{([A-Z0-9_]+)\}/g, function (whole, key) {
      return Object.prototype.hasOwnProperty.call(chosen, key) ? chosen[key] : whole;
    });
  }

  function chooseSlots(rand, template) {
    var chosen = {};
    Object.keys(template.slots || {}).sort().forEach(function (key) {
      var options = template.slots[key];
      chosen[key] = options[Math.floor(rand() * options.length) % options.length];
    });
    return chosen;
  }

  /* ---- eligibility ------------------------------------------------------- */

  /* requiresMemory is one tag or several. Several means the template needs all of them,
     which is what lets something point out that two of your answers cannot both be
     true. */
  var RECALL_COOLDOWN_DAYS = 14;

  function memoryTags(template) {
    var need = template.requiresMemory;
    if (!need) return [];
    return Object.prototype.toString.call(need) === '[object Array]' ? need : [need];
  }

  function eligible(template, context) {
    var act = context.act;
    if (template.acts && (act < template.acts[0] || act > template.acts[1])) return false;
    /* a template may belong to part of an act rather than all of it */
    if (template.days && (context.day < template.days[0] || context.day > template.days[1])) {
      return false;
    }
    if (template.phases && template.phases.indexOf(context.phase) < 0) return false;
    if (template.once && context.fired[template.id]) return false;
    var need = template.requiresFlags || [];
    for (var i = 0; i < need.length; i++) {
      if (!context.flags[need[i]]) return false;
    }
    /* Act II: a template that quotes the player back can only fire if the player
       actually said it. This is why Act I wrote memory from day one -- it cannot be
       retrofitted onto history someone has already lived through. */
    /* Act III: presence. A clue found in Act I is confirmed in Act III -- the light was
       on a sensor, and something was standing under it. A clue never found is never
       confirmed, and that silence is the cost of not having looked. */
    if (template.requiresClue && !context.clues[template.requiresClue]) return false;

    var tags = memoryTags(template);
    for (var j = 0; j < tags.length; j++) {
      if (!context.memory[tags[j]]) return false;
      /* Quoted once, then left alone for a fortnight. Saying it back twice in a week is
         nagging; coming back to it after two weeks is the thing having only that to say. */
      /* Combining two memories is not quoting one freshly: it is pointing out that both
         cannot be true. That works precisely because you already heard each of them, so
         the cooldown does not apply. */
      if (tags.length === 1) {
        var when = context.spent[tags[j]];
        if (when && (context.day - when) < RECALL_COOLDOWN_DAYS) return false;
      }
    }
    if (template.requiresMemory && context.recallUsed) return false;
    return true;
  }

  /* ---- planning ----------------------------------------------------------
     The ladder's reply budget is the primary driver, not the message count. Decay is
     "fewer people reply", so a phase keeps drawing templates until its budget is spent
     or the pool runs dry; the message target is a floor, not a cap. That makes
     replies-per-day an exact function of the ladder, which is what lets the gate assert
     the curve numerically instead of eyeballing it.
     -------------------------------------------------------------------------- */

  function totalBudget(budget) {
    var sum = 0;
    Object.keys(budget).forEach(function (k) { sum += budget[k]; });
    return sum;
  }

  function planPhase(content, options) {
    var castById = indexCast(content.cast);
    var rand = seededRandom([options.runSeed, options.day, options.phase]);
    var events = [];
    var used = {};
    var replies = 0;
    var dropped = 0;

    /* Rolled before the draw so it is part of the seed, not a side effect of it. */
    var recallAllowed = rand() < (options.recallChance === undefined ? 1 : options.recallChance);

    var pool = (content.templates.templates || []).filter(function (t) {
      return eligible(t, {
        act: options.act, phase: options.phase,
        fired: options.fired, flags: options.flags, day: options.day,
        memory: options.memory || {}, spent: options.spent || {},
        clues: options.clues || {}, recallUsed: false
      });
    });

    /* The ladder decides how hard the draw leans toward being quoted back. */
    function weightOf(t) {
      var base = t.weight || 1;
      return t.requiresMemory ? base * (options.recallWeight || 1) : base;
    }

    var guard = 0;
    while (guard++ < 60) {
      if (events.length >= options.target && totalBudget(options.budget) <= 0) break;

      var available = pool.filter(function (t) { return !used[t.id]; });
      if (!available.length) break;

      /* Prefer templates whose speakers still have budget: a contact with nothing left
         to say should not be the one picked to say it. */
      var withBudget = available.filter(function (t) {
        return t.lines.some(function (l) { return (options.budget[l.speaker] || 0) > 0; });
      });
      /* Once nobody has budget the withBudget list is empty, and a no-reply sender like
         Notify would otherwise win the endgame by default. Prefer the cast who used to
         answer: the point of day 20 is a person talking to nobody. */
      /* Act I only. Its endgame wants a person talking to nobody, so it prefers the cast
         who used to answer. Applied later it silently excludes the unknown number, which
         is the one voice acts II and III are built on. */
      var human = options.act === 1
        ? available.filter(function (t) {
            return t.lines.some(function (l) {
              return castById[l.speaker] && (castById[l.speaker].baseReplies || 0) > 0;
            });
          })
        : available;
      var recall = recallAllowed
        ? available.filter(function (t) { return t.requiresMemory || t.requiresClue; })
        : [];
      var candidates = withBudget.length
        ? withBudget
        : (recall.length || human.length ? recall.concat(human) : available);
      var template = pickWeighted(rand, candidates, weightOf);
      if (!template) break;

      used[template.id] = true;
      if (template.once) options.fired[template.id] = true;
      if (template.requiresMemory) recallAllowed = false;   /* one per phase */
      memoryTags(template).forEach(function (tag) { options.spent[tag] = options.day; });
      (template.setsFlags || []).forEach(function (f) { options.flags[f] = true; });

      var slots = chooseSlots(rand, template);
      memoryTags(template).forEach(function (tag, index) {
        slots[index === 0 ? 'MEMORY' : 'MEMORY' + (index + 1)] =
          (options.memory || {})[tag] || '';
      });
      var openedBy = {};

      template.lines.forEach(function (line) {
        if (!castById[line.speaker]) return;

        /* The first line a contact says in a template opens; everything after it is a
           reply, and replies are what the ladder takes away. */
        var isReply = !!openedBy[line.speaker];
        /* A recall is not conversation, so it does not pay conversation's price. Decay
           is the cast losing the will to answer each other; the thing quoting you back
           has no such problem, and cutting it off mid-sentence loses the whole point of
           "ren stopped answering on the tuesday / you started on the sunday". */
        if (isReply && !template.requiresMemory && options.act === 1) {
          if ((options.budget[line.speaker] || 0) <= 0) { dropped++; return; }
          options.budget[line.speaker] -= 1;
          replies += 1;
        }
        openedBy[line.speaker] = true;

        events.push({
          templateId: template.id,
          threadId: template.threadId,
          speaker: line.speaker,
          from: 'them',
          kind: 'text',
          body: fillSlots(line.text, slots),
          isReply: isReply
        });
      });

      (template.choices || []).forEach(function (choice) {
        events.push({
          templateId: template.id,
          threadId: template.threadId,
          kind: 'choice',
          choiceId: choice.id,
          label: choice.label,
          tells: choice.tells ? fillSlots(choice.tells, slots) : null,
          revealsClue: choice.revealsClue || null,
          memory: choice.memory
            ? { tag: choice.memory.tag, fragment: fillSlots(choice.memory.fragment, slots) }
            : null
        });
      });
    }

    /* D26: the player can always reply. Decay is something that happens to other
       people, and a phase with nothing to say is a phase where this stopped being a
       messaging app. If the draw produced no choices, draw one that has them -- ignoring
       budget, because the budget governs the cast, never the player. */
    if (!events.some(function (e) { return e.kind === 'choice'; })) {
      var withChoices = pool.filter(function (t) {
        return !used[t.id] && (t.choices || []).length;
      });
      var rescue = pickWeighted(rand, withChoices, weightOf);
      if (rescue) {
        used[rescue.id] = true;
        if (rescue.once) options.fired[rescue.id] = true;
        (rescue.setsFlags || []).forEach(function (f) { options.flags[f] = true; });
        var rescueSlots = chooseSlots(rand, rescue);
        memoryTags(rescue).forEach(function (tag, index) {
          rescueSlots[index === 0 ? 'MEMORY' : 'MEMORY' + (index + 1)] =
            (options.memory || {})[tag] || '';
        });
        var rescueOpened = {};
        rescue.lines.forEach(function (line) {
          if (!castById[line.speaker]) return;
          if (rescueOpened[line.speaker]) return;   /* the opener only: no budget spent */
          rescueOpened[line.speaker] = true;
          events.push({
            templateId: rescue.id,
            threadId: rescue.threadId,
            speaker: line.speaker,
            from: 'them',
            kind: 'text',
            body: fillSlots(line.text, rescueSlots),
            isReply: false
          });
        });
        (rescue.choices || []).forEach(function (choice) {
          events.push({
            templateId: rescue.id,
            threadId: rescue.threadId,
            kind: 'choice',
            choiceId: choice.id,
            label: choice.label,
            tells: choice.tells ? fillSlots(choice.tells, rescueSlots) : null,
            revealsClue: choice.revealsClue || null,
            memory: choice.memory
              ? { tag: choice.memory.tag,
                  fragment: fillSlots(choice.memory.fragment, rescueSlots) }
              : null
          });
        });
      }
    }

    return { events: events, replies: replies, dropped: dropped };
  }

  /* Day 1 is authored: its morning is beat 1's history and its night is the live beats
     that already exist in story.json. It enters the system as the first entry, not as an
     exception to it. */
  function authoredDay(content, day, entry) {
    var story = content.story || { beats: [] };
    var live = [], history = [];
    (story.beats || []).forEach(function (beat) {
      var isLive = beat.messages.some(function (m) { return m.live === true; });
      (isLive ? live : history).push(beat);
    });

    function eventsFrom(beats) {
      var out = [];
      beats.slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (beat) {
        var opened = {};
        beat.messages.forEach(function (m) {
          if (m.from !== 'them') return;
          var who = m.fromContactId || beat.threadId;
          var isReply = !!opened[who];
          opened[who] = true;
          out.push({
            templateId: 'authored',
            threadId: beat.threadId,
            speaker: m.fromContactId || null,
            from: 'them',
            kind: m.kind,
            body: m.body || '',
            isReply: isReply
          });
        });
      });
      return out;
    }

    var dayEvents = eventsFrom(history);
    var nightEvents = eventsFrom(live);
    var replies = function (list) {
      return list.filter(function (e) { return e.isReply; }).length;
    };
    return {
      day: day,
      act: entry.act,
      authored: true,
      phases: { day: dayEvents, night: nightEvents },
      replies: replies(dayEvents) + replies(nightEvents),
      dropped: 0,
      messages: dayEvents.length + nightEvents.length,
      budgetAtStart: {},
      budgetLeft: {}
    };
  }

  function planDay(content, runSeed, day, carried) {
    var entry = ladderFor(content.ladder, day);
    if (!entry) return null;
    if (entry.authored) return authoredDay(content, day, entry);

    var castById = indexCast(content.cast);
    var state = carried || { flags: {}, fired: {}, memory: {}, spent: {}, clues: {} };
    state.memory = state.memory || {};
    state.spent = state.spent || {};
    state.clues = state.clues || {};

    /* Split the day's budget between the phases so night is never left mute by a
       talkative morning. */
    var dayBudget = {}, nightBudget = {};
    Object.keys(castById).forEach(function (id) {
      var whole = Math.max(0, Math.round((castById[id].baseReplies || 0) * entry.replyBudget));
      dayBudget[id] = Math.ceil(whole * 0.6);
      nightBudget[id] = whole - dayBudget[id];
    });

    var out = {
      day: day,
      act: entry.act,
      authored: false,
      budgetAtStart: {
        day: JSON.parse(JSON.stringify(dayBudget)),
        night: JSON.parse(JSON.stringify(nightBudget))
      },
      phases: {},
      replies: 0,
      dropped: 0,
      messages: 0
    };

    [['day', dayBudget], ['night', nightBudget]].forEach(function (pair) {
      var result = planPhase(content, {
        runSeed: runSeed,
        day: day,
        phase: pair[0],
        act: entry.act,
        target: pair[0] === 'day' ? entry.dayMessages : entry.nightMessages,
        budget: pair[1],
        flags: state.flags,
        fired: state.fired,
        memory: state.memory,
        spent: state.spent,
        clues: state.clues,
        recallWeight: entry.recallWeight || 1,
        recallChance: entry.recallChance === undefined ? 1 : entry.recallChance
      });
      out.phases[pair[0]] = result.events;
      out.replies += result.replies;
      out.dropped += result.dropped;
      out.messages += result.events.filter(function (e) { return e.kind !== 'choice'; }).length;
    });

    out.budgetLeft = { day: dayBudget, night: nightBudget };
    return out;
  }

  /* Determinism is now conditional: same seed AND same memory produces the same
     transcript. Act II reads what the player said, so the seed alone cannot describe a
     run any more. Tests pass a fixed memory to keep the property testable. */
  function planRun(content, runSeed, fromDay, toDay, memory) {
    /* copy: a run accumulates memory forward, and mutating the caller's object would
       make the second identical call start from the first one's leftovers. */
    var seeded = {};
    Object.keys(memory || {}).forEach(function (k) { seeded[k] = memory[k]; });
    var state = { flags: {}, fired: {}, memory: seeded, spent: {}, clues: {} };
    var days = [];
    for (var day = fromDay; day <= toDay; day++) {
      var planned = planDay(content, runSeed, day, state);
      if (planned) {
        days.push(planned);
        /* a run remembers forward: what was said on day 3 is still quotable on day 30 */
        ['day', 'night'].forEach(function (phase) {
          (planned.phases[phase] || []).forEach(function (e) {
            if (e.kind !== 'choice') return;
            if (e.memory && !state.memory[e.memory.tag]) {
              state.memory[e.memory.tag] = e.memory.fragment;
            }
            if (e.revealsClue) state.clues[e.revealsClue] = true;
          });
        });
      }
    }
    return days;
  }

  return {
    xmur3: xmur3,
    mulberry32: mulberry32,
    seededRandom: seededRandom,
    fillSlots: fillSlots,
    ladderFor: ladderFor,
    actFor: actFor,
    planPhase: planPhase,
    planDay: planDay,
    planRun: planRun
  };
});
