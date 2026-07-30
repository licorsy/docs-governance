'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkLine, checkEntry } = require('../lib/rules/sum-decomposition');

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-sum-decomp-'));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, content);
  return file;
}

test('checkLine passes when the addends sum to the declared total', () => {
  const m = ['', '20', '13', '2', '2', '37'];
  assert.strictEqual(checkLine(m), null);
});

test('checkLine fails when the sum disagrees with the declared total', () => {
  const m = ['', '20', '13', '2', '2', '38'];
  const error = checkLine(m);
  assert.match(error, /declared 20 \+ 13 \+ 2 \+ 2 = 38, but 20 \+ 13 \+ 2 \+ 2 = 37/);
});

test('checkEntry flags the real "35 vs 36" class of defect', () => {
  const file = tmpFile('20 + 13 + 2 + 2 = 36 no total.');
  const findings = checkEntry(
    { file, pattern: /(\d+) \+ (\d+) \+ (\d+) \+ (\d+) = (\d+)/ },
    {},
  );
  assert.strictEqual(findings.length, 1);
  assert.match(findings[0], /36, but 20 \+ 13 \+ 2 \+ 2 = 37/);
});

test('checkEntry is silent when the sum is correct', () => {
  const file = tmpFile('20 + 13 + 2 + 2 = 37 no total.');
  const findings = checkEntry(
    { file, pattern: /(\d+) \+ (\d+) \+ (\d+) \+ (\d+) = (\d+)/ },
    {},
  );
  assert.strictEqual(findings.length, 0);
});

test('checkEntry respects the exempt predicate', () => {
  const file = tmpFile('20 + 13 + 2 + 2 = 99 no total, como era à época.');
  const findings = checkEntry(
    { file, pattern: /(\d+) \+ (\d+) \+ (\d+) \+ (\d+) = (\d+)/ },
    { self_qualifying: /à época/ },
  );
  assert.strictEqual(findings.length, 0);
});
