'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { stripFencedBlocks, fencedLineIndices, changelogBlockRange } = require('../lib/text');

test('stripFencedBlocks removes a simple fence', () => {
  const content = ['antes', '```', 'dentro', '```', 'depois'].join('\n');
  assert.strictEqual(stripFencedBlocks(content), 'antes\ndepois');
});

test('stripFencedBlocks supports nested fences of different length', () => {
  const content = ['antes', '```````', '```', 'dentro do interno', '```', '```````', 'depois'].join('\n');
  assert.strictEqual(stripFencedBlocks(content), 'antes\ndepois');
});

test('fencedLineIndices marks fence lines and interior, not text outside', () => {
  const lines = ['a', '```', 'b', '```', 'c'];
  const idx = fencedLineIndices(lines);
  assert.deepStrictEqual([...idx].sort(), [1, 2, 3]);
});

test('changelogBlockRange spans from marker through trailing blank lines, same stopping rule as countChangelogEntries', () => {
  const content = ['# doc', '', 'Changelog:', '', '- v1.2: b', '- v1.1: a', '', '## fim'].join('\n');
  const range = changelogBlockRange(content, 'Changelog:');
  assert.strictEqual(range.start, 2);
  // Índice 6 é a linha em branco antes de "## fim" — blank não fecha o bloco
  // (mesma regra de parada de countChangelogEntries), só a primeira linha que
  // não é "- " nem em branco fecha (índice 7, "## fim", fica de fora).
  assert.strictEqual(range.end, 6);
});

test('changelogBlockRange returns null without the marker', () => {
  assert.strictEqual(changelogBlockRange('# doc\n\nsem changelog', 'Changelog:'), null);
});
