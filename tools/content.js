/* Load the content bundle from disk. Shared by the tools and the tests so there is one
 * definition of "the content" and no path duplication. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function load() {
  const read = (...parts) => JSON.parse(fs.readFileSync(path.join(ROOT, ...parts), 'utf8'));
  return {
    cast: read('content', 'cast.json'),
    templates: read('content', 'templates.json'),
    ladder: read('content', 'ladder.json'),
    story: read('Resources', 'story.json'),
  };
}

module.exports = { ROOT, load };
