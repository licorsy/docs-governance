'use strict';

// lib/git.js generalizes the diff logic version-bump.js already had privately
// (merge-base + git diff --name-status). These tests spin up a real scratch
// git repo per case — the thing under test IS the shell-out, so mocking it
// would test nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { changedFiles } = require('../lib/git');

function git(dir, args, env) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: env || process.env });
}

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-git-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@test.local']);
  git(dir, ['config', 'user.name', 'test']);
  return dir;
}

function write(dir, file, content) {
  fs.writeFileSync(path.join(dir, file), content);
}

function commitAt(dir, message, isoDate) {
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', message], {
    ...process.env,
    GIT_AUTHOR_DATE: isoDate,
    GIT_COMMITTER_DATE: isoDate,
  });
}

function commit(dir, message) {
  commitAt(dir, message, new Date().toISOString());
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

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

test('changedFiles({}) abstains (no baseSha, no since)', () => {
  const dir = tmpRepo();
  withCwd(dir, () => {
    assert.strictEqual(changedFiles({}), null);
  });
});

test('changedFiles({ baseSha }) returns A/M/D relative to the merge-base, markdown only', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n');
  write(dir, 'keep.txt', 'x');
  commit(dir, 'chore: seed');
  git(dir, ['tag', 'base']);

  write(dir, 'a.md', '# a v2\n');
  fs.unlinkSync(path.join(dir, 'keep.txt'));
  write(dir, 'b.md', '# b\n');
  commit(dir, 'chore: changes');

  withCwd(dir, () => {
    const files = changedFiles({ baseSha: 'base' });
    const byFile = Object.fromEntries(files.map((f) => [f.file, f.status]));
    assert.deepStrictEqual(Object.keys(byFile).sort(), ['a.md', 'b.md']);
    assert.strictEqual(byFile['a.md'], 'M');
    assert.strictEqual(byFile['b.md'], 'A');
  });
});

test('changedFiles({ baseSha }) reports a deleted markdown file as D', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n');
  write(dir, 'gone.md', '# bye\n');
  commit(dir, 'chore: seed');
  git(dir, ['tag', 'base']);

  fs.unlinkSync(path.join(dir, 'gone.md'));
  commit(dir, 'chore: remove gone.md');

  withCwd(dir, () => {
    const files = changedFiles({ baseSha: 'base' });
    assert.deepStrictEqual(files, [{ status: 'D', file: 'gone.md' }]);
  });
});

test('changedFiles({ since }) uses the oldest commit inside the window as the boundary', () => {
  const dir = tmpRepo();
  write(dir, 'old.md', '# old\n');
  commitAt(dir, 'chore: old', daysAgo(10)); // outside a 7-day window

  write(dir, 'old.md', '# old v2\n');
  commitAt(dir, 'chore: recent change', daysAgo(3)); // inside the window

  withCwd(dir, () => {
    const files = changedFiles({ since: '7 days ago' });
    assert.deepStrictEqual(files, [{ status: 'M', file: 'old.md' }]);
  });
});

test('changedFiles({ since }) with nothing inside the window returns an empty array', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n');
  commitAt(dir, 'chore: seed', daysAgo(30));

  withCwd(dir, () => {
    assert.deepStrictEqual(changedFiles({ since: '1 day ago' }), []);
  });
});

test('changedFiles({ since }) diffs against the empty tree when the window includes the root commit', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n');
  commitAt(dir, 'chore: root', daysAgo(1));

  withCwd(dir, () => {
    const files = changedFiles({ since: '7 days ago' });
    assert.deepStrictEqual(files, [{ status: 'A', file: 'a.md' }]);
  });
});
