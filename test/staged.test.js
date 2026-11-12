'use strict';

// docs-governance#55: under WSL2 a Windows-side node.exe on PATH resolves
// `git` to Git for Windows, which cannot see the repository, and `check
// --changed` used to fall back to an unfiltered run behind a message that
// blamed the repository. These tests cover the diagnosis (lib/git.js's
// stagedMarkdown / isWslWindowsNode) and the pre-commit hook's preference for
// a WSL-native nvm node. Real scratch repos and real `sh` — the thing under
// test is the shell-out, so mocking it would test nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { stagedMarkdown, isWslWindowsNode } = require('../lib/git');
const { renderPreCommit } = require('../bin/docgov');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

function writeExec(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  fs.chmodSync(file, 0o755);
}

test('isWslWindowsNode: win32 on a \\\\wsl.localhost or \\\\wsl$ path', () => {
  assert.strictEqual(isWslWindowsNode('win32', '\\\\wsl.localhost\\Ubuntu-24.04\\home\\u\\repo'), true);
  assert.strictEqual(isWslWindowsNode('win32', '\\\\wsl$\\Ubuntu\\home\\u\\repo'), true);
  assert.strictEqual(isWslWindowsNode('win32', 'C:\\Users\\u\\repo'), false);
  assert.strictEqual(isWslWindowsNode('linux', '/home/u/repo'), false);
});

test('stagedMarkdown returns the staged .md set', () => {
  const dir = tmpDir('docgov-staged-');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.md'), '# a\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  const { files, reason } = withCwd(dir, () => stagedMarkdown());
  assert.strictEqual(reason, null);
  assert.deepStrictEqual([...files], ['a.md']);
});

test('stagedMarkdown outside a repository reports not-a-repo', () => {
  const dir = tmpDir('docgov-norepo-');
  const prev = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  try {
    assert.deepStrictEqual(withCwd(dir, () => stagedMarkdown()), { files: null, reason: 'not-a-repo' });
  } finally {
    if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = prev;
  }
});

test('stagedMarkdown names the WSL/Windows-node mismatch when git fails there', () => {
  const dir = tmpDir('docgov-wsl-');
  const prev = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = path.dirname(dir);
  try {
    const result = withCwd(dir, () =>
      stagedMarkdown({ platform: 'win32', cwd: '\\\\wsl.localhost\\Ubuntu\\home\\u\\repo' }));
    assert.deepStrictEqual(result, { files: null, reason: 'wsl-windows-node' });
  } finally {
    if (prev === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = prev;
  }
});

// The hook runs under a real `sh` with a fake `node` first on PATH and a fake
// HOME holding two nvm versions; each fake binary just echoes who it is.
function runHook({ pathNodeReports }) {
  const root = tmpDir('docgov-hook-');
  const hook = path.join(root, 'pre-commit');
  fs.writeFileSync(hook, renderPreCommit('/x/docgov.js'));
  const bin = path.join(root, 'bin');
  writeExec(path.join(bin, 'node'),
    `#!/bin/sh\nif [ "$1" = -p ]; then echo ${pathNodeReports}; else echo "PATH-NODE $*"; fi\n`);
  const home = path.join(root, 'home');
  for (const v of ['v9.0.0', 'v24.18.0']) {
    writeExec(path.join(home, '.nvm', 'versions', 'node', v, 'bin', 'node'), `#!/bin/sh\necho "NVM-${v} $*"\n`);
  }
  return execFileSync('sh', [hook], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
  }).trim();
}

const posixOnly = { skip: process.platform === 'win32' || os.type() !== 'Linux' ? 'hook WSL branch is Linux-only' : false };

test('pre-commit hook prefers the newest nvm node when PATH node is a Windows build', posixOnly, () => {
  assert.strictEqual(runHook({ pathNodeReports: 'win32' }), 'NVM-v24.18.0 /x/docgov.js check --changed');
});

test('pre-commit hook keeps the PATH node when it is native', posixOnly, () => {
  assert.strictEqual(runHook({ pathNodeReports: 'linux' }), 'PATH-NODE /x/docgov.js check --changed');
});
