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

  /* Which of the player's own lines to read back.
     It prefers one typed somewhere else. Being quoted a thing you said to this number is
     unnerving; being quoted a thing you said to your mother is the whole idea, and the
     cast note for the number has said so from the start.
     Old before recent, too: something from three weeks ago has had time to be forgotten. */
  function chooseTyped(rand, typed, threadId) {
    var usable = (typed || []).filter(function (t) {
      return t && typeof t.text === 'string' && t.text.trim().length > 1;
    });
    if (!usable.length) return null;
    var elsewhere = usable.filter(function (t) { return t.threadId !== threadId; });
    var pool = elsewhere.length ? elsewhere : usable;
    /* the older half, so it has had time to stop being on your mind -- but never fewer
       than three to draw from, or every quote-back in the run is the same sentence */
    var window = pool.slice(0, Math.max(Math.min(3, pool.length),
                                        Math.ceil(pool.length / 2)));
    return window[Math.floor(rand() * window.length) % window.length];
  }

  function threadNameOf(content, threadId) {
    var cast = ((content || {}).cast || {}).cast || [];
    var names = [];
    for (var i = 0; i < cast.length; i++) {
      if (cast[i].thread === threadId && names.indexOf(cast[i].displayName) < 0) {
        names.push(cast[i].displayName);
      }
    }
    if (!names.length) return '';
    if (names.length === 1) return names[0];
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
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

  /* Being read your own sentence back is a trick that works three or four times in a
     hundred days and not thirteen. Longer than the recall cooldown, because this one
     lands harder and wears out faster. */
  var QUOTE_COOLDOWN_DAYS = 21;

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

    /* A template that reads the player's own words back cannot fire before they have
       typed enough of them. This is why the typing had to land first: it cannot be
       retrofitted onto a run somebody has already played. */
    if (template.requiresTyped) {
      var need = template.requiresTyped === true ? 1 : template.requiresTyped;
      var have = (context.typed || []).filter(function (t) {
        return t && typeof t.text === 'string' && t.text.trim().length > 1;
      });
      if (have.length < need) return false;
      var last = context.quotedOn;
      if (last !== undefined && context.day - last < QUOTE_COOLDOWN_DAYS) return false;
    }

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
        clues: options.clues || {}, typed: options.typed || [],
        quotedOn: options.quoted ? options.quoted.on : undefined, recallUsed: false
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
      if (template.requiresTyped && options.quoted) options.quoted.on = options.day;
      memoryTags(template).forEach(function (tag) { options.spent[tag] = options.day; });
      (template.setsFlags || []).forEach(function (f) { options.flags[f] = true; });

      var slots = chooseSlots(rand, template);
      memoryTags(template).forEach(function (tag, index) {
        slots[index === 0 ? 'MEMORY' : 'MEMORY' + (index + 1)] =
          (options.memory || {})[tag] || '';
      });
      var quoted = null;
      if (template.requiresTyped) {
        quoted = chooseTyped(rand, options.typed, template.threadId);
        if (quoted) {
          slots.TYPED = quoted.text;
          slots.TYPEDWHO = threadNameOf(content, quoted.threadId);
          slots.TYPEDDAY = String(quoted.day || 1);
        }
      }
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
          kind: line.kind || 'text',
          game: line.game || null,
          asset: line.asset || null,
          durationMs: line.durationMs || null,
          body: fillSlots(line.text, slots),
          emphasis: line.emphasis || null,
          quotesPlayer: !!(quoted && /\{TYPED\}/.test(line.text)),
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
          match: choice.match || null,
          silent: !!choice.silent,
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
            match: choice.match || null,
            silent: !!choice.silent,
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
    state.typed = state.typed || [];
    state.quoted = state.quoted || {};

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
        typed: state.typed,
        quoted: state.quoted,
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


  /* ---- what the player typed --------------------------------------------
     The player types freely; this decides which authored reply they meant. It is
     deliberately dumb and deliberately explainable: a scoring pass over keywords
     that a human wrote down next to each choice. Nothing here generates a line.

     Negations are never stopwords. "i did" and "i didnt" are the same sentence
     minus three letters, and getting that wrong is the difference between
     confessing and denying. */

  var STOPWORDS = {
    the: 1, a: 1, an: 1, and: 1, or: 1, but: 1, of: 1, to: 1, in: 1, on: 1, at: 1,
    is: 1, are: 1, was: 1, were: 1, be: 1, been: 1, am: 1, im: 1, ive: 1, ill: 1,
    it: 1, its: 1, this: 1, that: 1, there: 1, here: 1, then: 1, so: 1, just: 1,
    for: 1, with: 1, my: 1, your: 1, we: 1, they: 1, them: 1, i: 1, me: 1
  };

  var NEGATIONS = {
    no: 1, not: 1, nope: 1, dont: 1, didnt: 1, doesnt: 1, wasnt: 1, isnt: 1,
    wont: 1, cant: 1, never: 1, nothing: 1, nobody: 1, none: 1, neither: 1
  };

  /* Yes and no arrive in two dozen spellings and nobody should have to write them all
     out next to every choice. Only these two families are folded -- anything wider and
     the matcher starts deciding what the player meant instead of reading it. */
  var CANON = (function () {
    var map = {};
    var families = [
      ['yes', 'yeah yep yea aye yup sure ok okay fine course certainly definitely absolutely'],
      ['no',  'nope nah naw negative']
    ];
    for (var i = 0; i < families.length; i++) {
      var head = families[i][0], words = families[i][1].split(' ');
      map[head] = head;
      for (var j = 0; j < words.length; j++) map[words[j]] = head;
    }
    return map;
  })();

  function canon(word) { return CANON[word] || word; }

  /* Apostrophes go rather than split: didn't and didnt must be the same word, because
     half the people typing will not reach for the apostrophe on a phone. */
  function normalise(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenise(text) {
    var out = [], raw = normalise(text).split(' ');
    for (var i = 0; i < raw.length; i++) {
      var w = raw[i];
      if (!w) continue;
      if (STOPWORDS[w] && !NEGATIONS[w]) continue;
      out.push(canon(w));
    }
    return out;
  }

  function hasNegation(tokens) {
    for (var i = 0; i < tokens.length; i++) if (NEGATIONS[tokens[i]]) return true;
    return false;
  }

  var PHRASE_HIT = 5;    /* they typed the whole authored phrase */
  var TERM_HIT   = 3;    /* they typed a word someone wrote down for this choice */
  var LABEL_HIT  = 1;    /* they typed a word off the button itself */
  var NEG_MISS   = 4;    /* they negated and this choice does not, or the reverse */
  var MIN_SCORE  = 3;    /* below this, nobody understood them */

  function scoreChoice(input, tokens, choice) {
    var terms = choice.match || [], score = 0, i, j, seen = {};

    for (i = 0; i < terms.length; i++) {
      var term = normalise(terms[i]);
      if (!term) continue;
      if (term.indexOf(' ') >= 0) {
        if (input.indexOf(term) >= 0) score += PHRASE_HIT;
        continue;
      }
      var want = canon(term);
      for (j = 0; j < tokens.length; j++) {
        if (tokens[j] === want && !seen['t' + want]) { seen['t' + want] = 1; score += TERM_HIT; }
      }
    }

    var label = tokenise(choice.label || '');
    for (i = 0; i < label.length; i++) {
      for (j = 0; j < tokens.length; j++) {
        if (tokens[j] === label[i] && !seen['l' + label[i]]) {
          seen['l' + label[i]] = 1; score += LABEL_HIT;
        }
      }
    }

    /* "i did" and "i didnt" score identically on overlap alone. They are opposites. */
    if (score > 0) {
      var mine = hasNegation(tokens);
      var theirs = hasNegation(label.concat(terms.join(' ').split(' ')));
      if (mine !== theirs) score -= NEG_MISS;
    }
    return score;
  }

  /* Returns the choice they meant, or null if nobody could tell. Deterministic: a tie
     goes to the earlier choice, because a coin flip reads to the player as a bug. */
  function matchReply(text, choices) {
    var input = normalise(text);
    if (!input) return null;
    /* "that was me" is three stopwords and nothing else, and it is a real reply someone
       wrote. Bailing on an empty token list threw away every phrase-only match. */
    var tokens = tokenise(text);

    var best = null, bestScore = 0, runnerUp = 0;
    for (var i = 0; i < (choices || []).length; i++) {
      var choice = choices[i];
      if (!choice || choice.silent) continue;
      var score = scoreChoice(input, tokens, choice);
      if (score > bestScore) { runnerUp = bestScore; bestScore = score; best = choice; }
      else if (score > runnerUp) { runnerUp = score; }
    }
    if (!best || bestScore < MIN_SCORE) return null;
    return { choice: best, score: bestScore, runnerUp: runnerUp };
  }

  /* Two choices in the same breath that answer to the same words are a coin flip. The
     validator uses this; it is here so there is one definition of "ambiguous". */
  function collisions(choices) {
    var out = [], i, j;
    for (i = 0; i < choices.length; i++) {
      for (j = i + 1; j < choices.length; j++) {
        if (choices[i].silent || choices[j].silent) continue;
        var a = (choices[i].match || []).map(normalise);
        var b = (choices[j].match || []).map(normalise);
        var shared = a.filter(function (term) { return term && b.indexOf(term) >= 0; });
        if (shared.length) {
          out.push({ a: choices[i].id, b: choices[j].id, shared: shared });
        }
      }
    }
    return out;
  }

  return {
    xmur3: xmur3,
    mulberry32: mulberry32,
    seededRandom: seededRandom,
    fillSlots: fillSlots,
    chooseTyped: chooseTyped,
    threadNameOf: threadNameOf,
    normalise: normalise,
    tokenise: tokenise,
    matchReply: matchReply,
    collisions: collisions,
    ladderFor: ladderFor,
    actFor: actFor,
    planPhase: planPhase,
    planDay: planDay,
    planRun: planRun
  };
});
