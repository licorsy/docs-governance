'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { stripFencedBlocks, fencedLineIndices, changelogBlockRange, markedBlockLines } = require('../lib/text');

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

test('markedBlockLines finds a well-formed block and returns its interior text', () => {
  const content = [
    '# doc',
    '<!-- fragment:intro:start -->',
    'linha 1',
    'linha 2',
    '<!-- fragment:intro:end -->',
    '## fim',
  ].join('\n');
  const block = markedBlockLines(content, 'intro');
  assert.strictEqual(block.start, 1);
  assert.strictEqual(block.end, 4);
  assert.strictEqual(block.text, 'linha 1\nlinha 2');
});

test('markedBlockLines returns null when the start marker is missing', () => {
  const content = ['# doc', 'linha 1', '<!-- fragment:intro:end -->'].join('\n');
  assert.strictEqual(markedBlockLines(content, 'intro'), null);
});

test('markedBlockLines returns null when the end marker is missing', () => {
  const content = ['# doc', '<!-- fragment:intro:start -->', 'linha 1'].join('\n');
  assert.strictEqual(markedBlockLines(content, 'intro'), null);
});

test('markedBlockLines does not cross-match markers from a different id', () => {
  const content = [
    '<!-- fragment:a:start -->',
    'conteúdo de a',
    '<!-- fragment:a:end -->',
    '<!-- fragment:b:start -->',
    'conteúdo de b',
    '<!-- fragment:b:end -->',
  ].join('\n');
  const block = markedBlockLines(content, 'a');
  assert.strictEqual(block.text, 'conteúdo de a');
});
