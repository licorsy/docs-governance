'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { evaluate } = require('../lib/rules/version-bump');

const doc = (v) => (v === null ? '# no frontmatter\n' : `---\ntitle: t\nversion: "${v}"\n---\n\n# doc\n`);

test('modified file with same version fails', () => {
  const msg = evaluate(doc('1.2'), doc('1.2'), 'a.md');
  assert.match(msg, /modified without a version bump \(still "1\.2"\)/);
});

test('lowered version fails (monotonic)', () => {
  const msg = evaluate(doc('1.3'), doc('1.2'), 'a.md');
  assert.match(msg, /"1\.2" is not greater than base "1\.3"/);
});

test('properly bumped version passes', () => {
  assert.strictEqual(evaluate(doc('1.2'), doc('1.3'), 'a.md'), null);
});

test('multi-digit bump passes (3.9 -> 3.10)', () => {
  assert.strictEqual(evaluate(doc('3.9'), doc('3.10'), 'a.md'), null);
});

test('files without a version field are out of scope', () => {
  assert.strictEqual(evaluate(doc(null), doc(null), 'a.md'), null);
  assert.strictEqual(evaluate(doc(null), doc('1.0'), 'a.md'), null);
  assert.strictEqual(evaluate(doc('1.0'), doc(null), 'a.md'), null);
});

test('identical versions fail on literal equality, suffix or not', () => {
  assert.match(evaluate(doc('1.0-beta'), doc('1.0-beta'), 'a.md'), /without a version bump/);
});

test('a prerelease suffix bump is REJECTED — parseInt truncates it', () => {
  // 1.0-beta -> 1.0-rc compara como 0, então cai no ramo "not greater".
  // Comportamento herdado do script original e preservado por paridade; seria
  // falso positivo num repositório que use pré-lançamento.
  assert.match(evaluate(doc('1.0-beta'), doc('1.0-rc'), 'a.md'), /is not greater than base/);
});

test('an unorderable version pair is only checked for literal equality', () => {
  // 'beta' não tem dígito inicial -> compareVersions devolve null -> só a
  // igualdade literal é cobrada, e aqui elas diferem.
  assert.strictEqual(evaluate(doc('beta'), doc('rc'), 'a.md'), null);
});
