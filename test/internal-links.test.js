'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkFile, isExternalOrSkippable, stripFencedBlocks } = require('../lib/rules/internal-links');
const { walkTree } = require('../lib/walk');

function withTree(files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('valid relative link to an existing file passes', () => {
  withTree({ 'a.md': '[b](b.md)\n', 'b.md': 'x\n' }, (dir) => {
    assert.deepStrictEqual(checkFile(path.join(dir, 'a.md'), []), []);
  });
});

test('relative link to a non-existent file fails', () => {
  withTree({ 'a.md': '[gone](gone.md)\n' }, (dir) => {
    const errors = checkFile(path.join(dir, 'a.md'), []);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /broken link "gone\.md"/);
  });
});

test('external, mailto and anchor links are skipped', () => {
  for (const link of ['https://x.com', 'http://x.com', 'mailto:a@b.c', '#section']) {
    assert.strictEqual(isExternalOrSkippable(link, []), true, link);
  }
  assert.strictEqual(isExternalOrSkippable('docs/a.md', []), false);
});

test('configured skip patterns suppress a link class', () => {
  assert.strictEqual(isExternalOrSkippable('../local-notes/030.md', [/local-notes\//]), true);
  assert.strictEqual(isExternalOrSkippable('../local-notes/030.md', []), false);
});

test('anchors and query strings are stripped before resolving', () => {
  withTree({ 'a.md': '[b](b.md#sec)\n[c](b.md?x=1)\n', 'b.md': 'x\n' }, (dir) => {
    assert.deepStrictEqual(checkFile(path.join(dir, 'a.md'), []), []);
  });
});

test('placeholder links inside fenced code blocks are ignored', () => {
  const content = 'real: [ok](ok.md)\n\n```\n[fake](nowhere.md)\n```\n';
  withTree({ 'a.md': content, 'ok.md': 'x\n' }, (dir) => {
    assert.deepStrictEqual(checkFile(path.join(dir, 'a.md'), []), []);
  });
});

test('nested fences (7-backtick outer, 3-backtick inner) stay stripped', () => {
  const content = '```````\n```\n[fake](nowhere.md)\n```\n```````\n';
  assert.strictEqual(stripFencedBlocks(content).includes('nowhere.md'), false);
});

test('a tilde fence does not close a backtick fence', () => {
  const content = '```\n~~~\n[fake](nowhere.md)\n```\nafter\n';
  const stripped = stripFencedBlocks(content);
  assert.strictEqual(stripped.includes('nowhere.md'), false);
  assert.strictEqual(stripped.includes('after'), true);
});

test('walkTree prunes excluded directory names at any depth', () => {
  withTree({
    'a.md': 'x', 'docs/b.md': 'x', 'docs/reports/c.md': 'x', 'node_modules/d.md': 'x',
  }, (dir) => {
    const found = walkTree(dir, ['node_modules', 'reports']).map((f) => path.relative(dir, f));
    assert.deepStrictEqual(found.sort(), ['a.md', path.join('docs', 'b.md')].sort());
  });
});

test('checkFile is re-entrant despite the module-level regex', () => {
  // LINK_RE é global e tem lastIndex; sem reset, a segunda chamada pularia
  // links. Este teste existe porque isso é um bug clássico e silencioso.
  withTree({ 'a.md': '[gone](gone.md)\n' }, (dir) => {
    const f = path.join(dir, 'a.md');
    assert.strictEqual(checkFile(f, []).length, 1);
    assert.strictEqual(checkFile(f, []).length, 1);
  });
});
