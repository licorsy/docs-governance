'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../lib/rules/numbered-reference-consistency');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-numbered-ref-'));
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

function baseCfg(overrides) {
  return Object.assign(
    {
      scope_dirs: ['.'],
      root_files: [],
      exclude_prefixes: [],
      exempt: {},
      sequences: [],
    },
    overrides,
  );
}

test('true positive: in-range citation produces zero findings', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), 'See layer 3 for details.');

  withCwd(dir, () => {
    const result = run(baseCfg({ sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }] }));
    assert.strictEqual(result.findings.length, 0);
  });
});

test('true negative: out-of-range citation is flagged with word, id, and valid list', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), 'See layer 9 for details.');

  withCwd(dir, () => {
    const result = run(baseCfg({ sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }] }));
    assert.strictEqual(result.findings.length, 1);
    const msg = result.findings[0].messages[0];
    assert.match(msg, /layer 9/);
    assert.match(msg, /"layer"/);
    assert.match(msg, /1, 2, 3, 4, 5/);
    assert.strictEqual(result.findings[0].file, '');
  });
});

test('non-contiguous valid set: citing a deliberately retired middle number is flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), 'See layer 3 for details.');

  withCwd(dir, () => {
    const result = run(baseCfg({ sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 4, 5] }] }));
    assert.strictEqual(result.findings.length, 1);
    assert.match(result.findings[0].messages[0], /layer 3/);
  });
});

test('case-insensitivity: "Layer 9" is flagged the same as "layer 9"', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), 'See Layer 9 for details.');

  withCwd(dir, () => {
    const result = run(baseCfg({ sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }] }));
    assert.strictEqual(result.findings.length, 1);
    assert.match(result.findings[0].messages[0], /layer 9/);
  });
});

test('word-boundary correctness: "sublayer 9" does not spuriously match bare "layer"', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'doc.md'), 'See sublayer 9 for details, but layer 3 elsewhere.');

  withCwd(dir, () => {
    const result = run(baseCfg({ sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }] }));
    assert.strictEqual(result.findings.length, 0);
  });
});

test('exemption - fenced code block: an out-of-range citation only inside a fence is not flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'doc.md'),
    ['exemplo:', '', '```', 'See layer 9 for details.', '```', ''].join('\n'),
  );

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        exempt: { fenced_code: true },
        sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('exemption - historical path: out-of-range citation in a file under historical_paths is not flagged', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'logs/sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs/sessions/old.md'), 'See layer 9 for details.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        scope_dirs: ['logs'],
        exempt: { historical_paths: ['logs/sessions'] },
        sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('two independent sequences do not interfere with each other', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'doc.md'),
    ['See layer 9 for details.', 'Then follow step 2 to finish.'].join('\n'),
  );

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        sequences: [
          { id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] },
          { id: 'step', word: 'step', valid: [1, 2, 3] },
        ],
      }),
    );
    assert.strictEqual(result.findings.length, 1);
    const msg = result.findings[0].messages[0];
    assert.match(msg, /layer 9/);
    assert.match(msg, /"layer"/);
    assert.match(msg, /1, 2, 3, 4, 5/);
  });
});
