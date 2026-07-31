'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { load, merge, DEFAULTS, ENGINE_MAJOR, engineMajor } = require('../lib/config');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-config-'));
}

function writeConfig(dir, source, name) {
  fs.writeFileSync(path.join(dir, name || '.docgov.config.js'), source, 'utf8');
}

test('load() reads .docgov.config.js and merges it over DEFAULTS', () => {
  const dir = tmpRepo();
  writeConfig(dir, "module.exports = { rules: { frontmatter: { scope_dirs: ['x'] } } };");
  const { config, warnings } = load(dir);
  assert.deepStrictEqual(config.rules.frontmatter.scope_dirs, ['x']);
  // untouched defaults survive the merge
  assert.strictEqual(config.rules.frontmatter.enabled, true);
  assert.strictEqual(config.rules['version-bump'].enabled, true);
  assert.deepStrictEqual(warnings, []);
});

test('load() throws an ENOCONFIG error when the file is missing', () => {
  const dir = tmpRepo();
  assert.throws(
    () => load(dir),
    (err) => err.code === 'ENOCONFIG' && /docgov init/.test(err.message),
  );
});

test('load() honors an explicit config path', () => {
  const dir = tmpRepo();
  writeConfig(dir, "module.exports = { rules: { frontmatter: { scope_dirs: ['custom'] } } };", 'other.config.js');
  const { config, file } = load(dir, 'other.config.js');
  assert.strictEqual(config.rules.frontmatter.scope_dirs[0], 'custom');
  assert.strictEqual(file, path.resolve(dir, 'other.config.js'));
});

test('load() warns when the declared engine major does not match this docgov', () => {
  const dir = tmpRepo();
  writeConfig(dir, "module.exports = { engine: '^2' };");
  const { warnings } = load(dir);
  assert.strictEqual(warnings.length, 1);
  assert.match(warnings[0], /engine \^2/);
  assert.match(warnings[0], new RegExp(`major ${ENGINE_MAJOR}`));
});

test('load() does not warn when the declared engine major matches', () => {
  const dir = tmpRepo();
  writeConfig(dir, `module.exports = { engine: '^${ENGINE_MAJOR}' };`);
  const { warnings } = load(dir);
  assert.deepStrictEqual(warnings, []);
});

test('load() silently skips the skew warning when engine is unparsable', () => {
  const dir = tmpRepo();
  writeConfig(dir, "module.exports = { engine: 'not-a-version' };");
  const { warnings } = load(dir);
  assert.deepStrictEqual(warnings, []);
});

test('merge() replaces arrays from override instead of concatenating', () => {
  const out = merge({ a: [1, 2, 3] }, { a: [9] });
  assert.deepStrictEqual(out.a, [9]);
});

test('merge() deep-merges plain objects', () => {
  const out = merge({ rule: { x: 1, y: 2 } }, { rule: { y: 3 } });
  assert.deepStrictEqual(out.rule, { x: 1, y: 3 });
});

test('merge() falls back to base when override is undefined', () => {
  assert.strictEqual(merge('base-value', undefined), 'base-value');
});

test('merge() lets override win when it is not a plain object', () => {
  assert.strictEqual(merge({ a: 1 }, 'override'), 'override');
});

test('DEFAULTS.engine matches ENGINE_MAJOR', () => {
  assert.strictEqual(engineMajor(DEFAULTS.engine), ENGINE_MAJOR);
});

test('engineMajor() extracts the leading digit group', () => {
  assert.strictEqual(engineMajor('^1'), 1);
  assert.strictEqual(engineMajor('~2.3'), 2);
});

test('engineMajor() returns null for an unparsable or missing spec', () => {
  assert.strictEqual(engineMajor('not-a-version'), null);
  assert.strictEqual(engineMajor(undefined), null);
});
