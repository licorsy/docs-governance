'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkEntry, realCount } = require('../lib/rules/declared-counts');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-declared-counts-'));
  return dir;
}

function withCwd(dir, fn) {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(cwd);
  }
}

test('realCount counts .md files in a directory, minus exclusions', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  for (const name of ['a.md', 'b.md', 'c.md', 'index.md']) {
    fs.writeFileSync(path.join(dir, 'docs/prompts', name), '# x');
  }
  withCwd(dir, () => {
    assert.strictEqual(realCount({ dir: 'docs/prompts' }), 4);
    assert.strictEqual(realCount({ dir: 'docs/prompts', exclude_files: ['docs/prompts/index.md'] }), 3);
  });
});

test('checkEntry flags a declared count that disagrees with the real count', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/a.md'), '# x');
  fs.writeFileSync(path.join(dir, 'docs/prompts/b.md'), '# x');
  fs.writeFileSync(path.join(dir, 'claim.md'), 'São 3 arquivos no total.');

  withCwd(dir, () => {
    const findings = checkEntry(
      { file: 'claim.md', pattern: /São (\d+) arquivos/, dir: 'docs/prompts' },
      {},
    );
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0], /declares 3 but docs\/prompts actually has 2/);
  });
});

test('checkEntry is silent when the declared count matches', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/a.md'), '# x');
  fs.writeFileSync(path.join(dir, 'claim.md'), 'São 1 arquivos no total.');

  withCwd(dir, () => {
    const findings = checkEntry(
      { file: 'claim.md', pattern: /São (\d+) arquivos/, dir: 'docs/prompts' },
      {},
    );
    assert.strictEqual(findings.length, 0);
  });
});

test('checkEntry respects the exempt predicate (self-qualifying line is skipped)', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/a.md'), '# x');
  fs.writeFileSync(path.join(dir, 'claim.md'), 'São 99 arquivos, como era à época.');

  withCwd(dir, () => {
    const findings = checkEntry(
      { file: 'claim.md', pattern: /São (\d+) arquivos/, dir: 'docs/prompts' },
      { self_qualifying: /à época/ },
    );
    assert.strictEqual(findings.length, 0);
  });
});

test('checkEntry skips files under a historical path entirely', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'logs/sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/a.md'), '# x');
  fs.writeFileSync(path.join(dir, 'logs/sessions/2026-07-01-foo.md'), 'São 99 arquivos.');

  withCwd(dir, () => {
    const findings = checkEntry(
      { file: 'logs/sessions/2026-07-01-foo.md', pattern: /São (\d+) arquivos/, dir: 'docs/prompts' },
      { historical_paths: ['logs/sessions'] },
    );
    assert.strictEqual(findings.length, 0);
  });
});
