'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isHistoricalPath, exemptLineSet, isExemptTarget } = require('../lib/exempt');

test('a path under a historical prefix is exempt', () => {
  assert.ok(isHistoricalPath('logs/sessions/2026-07-29-foo.md', ['logs/sessions', 'docs/reports']));
  assert.ok(isHistoricalPath('docs/reports/021-foo.md', ['logs/sessions', 'docs/reports']));
});

test('a path outside every historical prefix is not exempt', () => {
  assert.ok(!isHistoricalPath('state/tasks.md', ['logs/sessions', 'docs/reports']));
});

test('lines inside the changelog block are exempt, lines after are not', () => {
  const content = [
    '# doc', '', 'Changelog:', '',
    '- v1.2: são 35 arquivos', // linha 4, dentro do bloco
    '- v1.1: são 30 arquivos', // linha 5, dentro do bloco
    '', '## corpo',
    'são 37 arquivos', // linha 8, fora do bloco — deve ser cobrada
  ].join('\n');
  const exempt = exemptLineSet(content, { inside_changelog_block: true });
  assert.ok(exempt.has(4));
  assert.ok(exempt.has(5));
  assert.ok(!exempt.has(8));
});

test('lines inside a fenced code block are exempt', () => {
  const content = [
    'texto normal são 5 arquivos', // 0, cobrada
    '```',                          // 1
    'são 999 arquivos',             // 2, exemplo
    '```',                          // 3
    'depois são 5 arquivos',        // 4, cobrada
  ].join('\n');
  const exempt = exemptLineSet(content, { fenced_code: true });
  assert.ok(!exempt.has(0));
  assert.ok(exempt.has(1));
  assert.ok(exempt.has(2));
  assert.ok(exempt.has(3));
  assert.ok(!exempt.has(4));
});

test('self_qualifying regex marks a line exempt regardless of position', () => {
  const content = [
    'são 37 arquivos hoje',                       // 0, cobrada
    'as 4 rotinas que existiam então',             // 1, autoqualificada
  ].join('\n');
  const exempt = exemptLineSet(content, { self_qualifying: /que existiam então|à época|na v\d/i });
  assert.ok(!exempt.has(0));
  assert.ok(exempt.has(1));
});

test('completed_items regex exempts checked-off lines', () => {
  const content = [
    '- [ ] são 5 pendências',   // 0, cobrada
    '- [x] eram 4 pendências',  // 1, isenta
    '- ✅ eram 3 pendências',   // 2, isenta
  ].join('\n');
  const exempt = exemptLineSet(content, { completed_items: /^\s*[-*] \[x\]|✅/ });
  assert.ok(!exempt.has(0));
  assert.ok(exempt.has(1));
  assert.ok(exempt.has(2));
});

test('with no exemption configured, nothing is exempt', () => {
  const content = 'são 37 arquivos\n- v1.1: são 30 arquivos';
  const exempt = exemptLineSet(content, {});
  assert.strictEqual(exempt.size, 0);
});

test('isExemptTarget: an exact string in target_allowlist exempts a matching target', () => {
  assert.ok(isExemptTarget('scaffold/future-module.md', ['scaffold/future-module.md', 'other.md']));
  assert.ok(!isExemptTarget('docs/missing.md', ['scaffold/future-module.md', 'other.md']));
});

test('isExemptTarget: a RegExp entry exempts a matching target', () => {
  assert.ok(isExemptTarget('prompt-999', [/^prompt-9\d\d$/]));
  assert.ok(!isExemptTarget('prompt-042', [/^prompt-9\d\d$/]));
});

test('isExemptTarget: with no target_allowlist configured, nothing is exempt', () => {
  assert.ok(!isExemptTarget('docs/missing.md', undefined));
  assert.ok(!isExemptTarget('docs/missing.md', []));
});
