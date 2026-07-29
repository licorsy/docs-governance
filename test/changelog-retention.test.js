'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { countChangelogEntries } = require('../lib/rules/changelog-retention');

const MARKER = 'Changelog:';

function body(entries, closing) {
  const lines = ['# doc', '', MARKER, ''];
  for (const e of entries) lines.push(`- ${e}`);
  if (closing) lines.push('- Entradas antigas: ver `git log --follow` deste arquivo.');
  lines.push('', '## depois');
  return lines.join('\n');
}

test('exactly 3 entries pass the cap', () => {
  assert.strictEqual(countChangelogEntries(body(['v1.3: c', 'v1.2: b', 'v1.1: a'], true), MARKER), 3);
});

test('4 entries exceed the cap', () => {
  assert.strictEqual(countChangelogEntries(body(['v1.4: d', 'v1.3: c', 'v1.2: b', 'v1.1: a'], true), MARKER), 4);
});

test('documents without the marker are skipped (null)', () => {
  assert.strictEqual(countChangelogEntries('# doc\n\nsem changelog\n', MARKER), null);
});

test('the closing "Entradas antigas" line is not counted as an entry', () => {
  const withClosing = countChangelogEntries(body(['v1.1: a'], true), MARKER);
  const without = countChangelogEntries(body(['v1.1: a'], false), MARKER);
  assert.strictEqual(withClosing, 1);
  assert.strictEqual(without, 1);
});

test('counting stops when the list ends', () => {
  const content = [
    '# doc', '', MARKER, '',
    '- v1.2: b',
    '- v1.1: a',
    '',
    'parágrafo qualquer',
    '',
    '- v9.9: isto não é changelog',
  ].join('\n');
  assert.strictEqual(countChangelogEntries(content, MARKER), 2);
});

test('a blank line inside the list does not end it', () => {
  const content = ['# doc', '', MARKER, '', '- v1.2: b', '', '- v1.1: a', '', '## fim'].join('\n');
  assert.strictEqual(countChangelogEntries(content, MARKER), 2);
});

test('the marker must be the whole trimmed line', () => {
  const content = ['# doc', '', 'Ver o Changelog: abaixo', '', '- v1.1: a'].join('\n');
  assert.strictEqual(countChangelogEntries(content, MARKER), null);
});

test('a custom marker is honoured', () => {
  const other = 'Changelog of this document:';
  const content = ['# doc', '', other, '', '- v1.1: a'].join('\n');
  assert.strictEqual(countChangelogEntries(content, other), 1);
  assert.strictEqual(countChangelogEntries(content, MARKER), null);
});

test('CRLF content counts the same as LF', () => {
  const content = body(['v1.2: b', 'v1.1: a'], true).split('\n').join('\r\n');
  assert.strictEqual(countChangelogEntries(content, MARKER), 2);
});
