'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { walkScoped, walkTree, underPrefix, toNative, scopedFiles } = require('../lib/walk');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-walk-'));
}

test('walkScoped on a .md file returns just that file', () => {
  const dir = tmpRepo();
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, 'x');
  assert.deepStrictEqual(walkScoped(file), [file]);
});

test('walkScoped on a non-.md file returns nothing', () => {
  const dir = tmpRepo();
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'x');
  assert.deepStrictEqual(walkScoped(file), []);
});

test('walkScoped on a directory recurses and collects only .md files', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.md'), 'x');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'sub', 'c.md'), 'x');
  const found = walkScoped(dir).sort();
  assert.deepStrictEqual(found, [path.join(dir, 'a.md'), path.join(dir, 'sub', 'c.md')].sort());
});

test('walkScoped on a nonexistent path returns an empty array, not a throw', () => {
  assert.deepStrictEqual(walkScoped(path.join(os.tmpdir(), 'docgov-does-not-exist-xyz')), []);
});

test('walkTree prunes directories by name at any depth (array)', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'skip.md'), 'x');
  fs.writeFileSync(path.join(dir, 'docs', 'keep.md'), 'x');
  const found = walkTree(dir, ['node_modules']);
  assert.deepStrictEqual(found, [path.join(dir, 'docs', 'keep.md')]);
});

test('walkTree accepts a Set for excludeNames', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'skip.md'), 'x');
  fs.writeFileSync(path.join(dir, 'keep.md'), 'x');
  const found = walkTree(dir, new Set(['reports']));
  assert.deepStrictEqual(found, [path.join(dir, 'keep.md')]);
});

test('underPrefix normalizes a "/"-written prefix to the native separator', () => {
  const file = ['docs', 'prompts', 'a.md'].join(path.sep);
  assert.strictEqual(underPrefix(file, 'docs/prompts'), true);
});

test('underPrefix matches the prefix path itself', () => {
  const file = ['docs', 'prompts'].join(path.sep);
  assert.strictEqual(underPrefix(file, 'docs/prompts'), true);
});

test('underPrefix does not match a directory whose name merely starts with the prefix', () => {
  const file = ['docs2', 'a.md'].join(path.sep);
  assert.strictEqual(underPrefix(file, 'docs'), false);
});

test('toNative converts "/" to the native separator', () => {
  assert.strictEqual(toNative('docs/prompts/a.md'), ['docs', 'prompts', 'a.md'].join(path.sep));
});

test('toNative is a no-op on an already-native path with no slashes', () => {
  assert.strictEqual(toNative('README.md'), 'README.md');
});

test('scopedFiles combines scope_dirs and root_files, honouring exclude_prefixes and exclude_files', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs', 'frozen'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'keep.md'), 'x');
  fs.writeFileSync(path.join(dir, 'docs', 'skip-by-file.md'), 'x');
  fs.writeFileSync(path.join(dir, 'docs', 'frozen', 'old.md'), 'x');
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const found = scopedFiles({
      scope_dirs: ['docs'],
      exclude_prefixes: ['docs/frozen'],
      exclude_files: ['docs/skip-by-file.md'],
      root_files: ['README.md'],
    }).sort();
    assert.deepStrictEqual(found, [path.join('docs', 'keep.md'), 'README.md'].sort());
  } finally {
    process.chdir(cwd);
  }
});

test('scopedFiles drops a root_file that does not exist', () => {
  const dir = tmpRepo();
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.deepStrictEqual(scopedFiles({ root_files: ['MISSING.md'] }), []);
  } finally {
    process.chdir(cwd);
  }
});
