'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkRequired, checkForbidden, scopedFiles } = require('../lib/rules/facts');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-facts-'));
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

test('checkRequired flags a file missing the expected fact', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), 'nada aqui sobre rotinas');
  withCwd(dir, () => {
    const findings = checkRequired(
      { id: 'rotinas-count', value: '5', required_in: [{ file: 'a.md', pattern: /5 rotinas/ }] },
      {},
    );
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0], /does not state fact "rotinas-count"/);
  });
});

test('checkRequired is silent when the file states the fact', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), 'temos 5 rotinas agendadas');
  withCwd(dir, () => {
    const findings = checkRequired(
      { id: 'rotinas-count', value: '5', required_in: [{ file: 'a.md', pattern: /5 rotinas/ }] },
      {},
    );
    assert.strictEqual(findings.length, 0);
  });
});

test('checkRequired ignores a match that only occurs on an exempt line', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), '5 rotinas, como era à época.');
  withCwd(dir, () => {
    const findings = checkRequired(
      { id: 'rotinas-count', value: '5', required_in: [{ file: 'a.md', pattern: /5 rotinas/ }] },
      { self_qualifying: /à época/ },
    );
    assert.strictEqual(findings.length, 1);
  });
});

test('checkForbidden flags a stale value outside exempt context', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), 'ainda temos 4 rotinas agendadas');
  withCwd(dir, () => {
    const findings = checkForbidden(
      { id: 'rotinas-count', forbidden: [/4 rotinas/] },
      ['a.md'],
      {},
    );
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0], /a\.md:1/);
  });
});

test('checkForbidden does not flag a self-qualifying historical mention', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), 'as 4 rotinas que existiam então');
  withCwd(dir, () => {
    const findings = checkForbidden(
      { id: 'rotinas-count', forbidden: [/4 rotinas/] },
      ['a.md'],
      { self_qualifying: /que existiam então/ },
    );
    assert.strictEqual(findings.length, 0);
  });
});

test('checkForbidden skips files under a historical path', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'logs/sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs/sessions/x.md'), '4 rotinas naquele dia');
  withCwd(dir, () => {
    const findings = checkForbidden(
      { id: 'rotinas-count', forbidden: [/4 rotinas/] },
      ['logs/sessions/x.md'],
      { historical_paths: ['logs/sessions'] },
    );
    assert.strictEqual(findings.length, 0);
  });
});

test('scopedFiles combines scope_dirs and root_files, honouring exclude_prefixes', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state/frozen'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state/a.md'), 'x');
  fs.writeFileSync(path.join(dir, 'state/frozen/b.md'), 'x');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  withCwd(dir, () => {
    const files = scopedFiles({ scope_dirs: ['state'], root_files: ['README.md'], exclude_prefixes: ['state/frozen'] });
    assert.deepStrictEqual(files.sort(), ['README.md', path.join('state', 'a.md')].sort());
  });
});
