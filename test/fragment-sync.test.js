'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkFragment, run, checkAnchor } = require('../lib/rules/fragment-sync');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-fragment-sync-'));
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

function block(id, body) {
  return `<!-- fragment:${id}:start -->\n${body}\n<!-- fragment:${id}:end -->`;
}

test('checkFragment: matching source and destination blocks produce no findings', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'source.md'), `# Title\n\n${block('branch-flow', 'Same content here.')}\n`);
  fs.writeFileSync(path.join(dir, 'dest.md'), `# Other\n\n${block('branch-flow', 'Same content here.')}\n`);
  withCwd(dir, () => {
    const results = checkFragment({ id: 'branch-flow', source: 'source.md', destinations: ['dest.md'] });
    const findings = results.filter((r) => !r.ok);
    assert.strictEqual(findings.length, 0);

    const summary = run({ fragments: [{ id: 'branch-flow', source: 'source.md', destinations: ['dest.md'] }] });
    assert.strictEqual(summary.findings.length, 0);
    assert.strictEqual(summary.okSummary, 'All configured fragments (1) are in sync across their destinations.');
  });
});

test('checkFragment: mismatched destination block produces exactly one finding attributed to the destination', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'source.md'), `${block('branch-flow', 'Original content.')}\n`);
  fs.writeFileSync(path.join(dir, 'dest.md'), `${block('branch-flow', 'Different content.')}\n`);
  withCwd(dir, () => {
    const results = checkFragment({ id: 'branch-flow', source: 'source.md', destinations: ['dest.md'] });
    const findings = results.filter((r) => !r.ok);
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0].message, /block content differs/);
    assert.strictEqual(findings[0].file, 'dest.md');
    assert.notStrictEqual(findings[0].file, '');
    assert.notStrictEqual(findings[0].file, 'source.md');
  });
});

test('checkFragment: destination missing markers produces a distinct "missing markers" finding', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'source.md'), `${block('branch-flow', 'Original content.')}\n`);
  fs.writeFileSync(path.join(dir, 'dest.md'), 'No markers here at all.\n');
  withCwd(dir, () => {
    const results = checkFragment({ id: 'branch-flow', source: 'source.md', destinations: ['dest.md'] });
    const findings = results.filter((r) => !r.ok);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, 'dest.md');
    assert.match(findings[0].message, /missing <!-- fragment:branch-flow:start\/end --> markers/);
    assert.doesNotMatch(findings[0].message, /declared as source/);
    assert.doesNotMatch(findings[0].message, /block content differs/);
  });
});

test('checkFragment: source missing markers produces a finding attributed to the source, distinct wording', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'source.md'), 'No markers here at all.\n');
  fs.writeFileSync(path.join(dir, 'dest.md'), `${block('branch-flow', 'Some content.')}\n`);
  withCwd(dir, () => {
    const results = checkFragment({ id: 'branch-flow', source: 'source.md', destinations: ['dest.md'] });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].ok, false);
    assert.strictEqual(results[0].file, 'source.md');
    assert.match(results[0].message, /missing <!-- fragment:branch-flow:start\/end --> markers \(declared as source\)/);
  });
});

test('checkFragment: missing source file entirely', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'dest.md'), `${block('branch-flow', 'Some content.')}\n`);
  withCwd(dir, () => {
    const results = checkFragment({ id: 'branch-flow', source: 'nope.md', destinations: ['dest.md'] });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].file, 'nope.md');
    assert.match(results[0].message, /fragment source does not exist/);
  });
});

test('checkFragment: missing destination file entirely', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'source.md'), `${block('branch-flow', 'Some content.')}\n`);
  withCwd(dir, () => {
    const results = checkFragment({ id: 'branch-flow', source: 'source.md', destinations: ['missing.md'] });
    const findings = results.filter((r) => !r.ok);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, 'missing.md');
    assert.match(findings[0].message, /fragment destination does not exist/);
  });
});

test('checkFragment: multiple destinations, mixed result — only the mismatched one is flagged with the correct file', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'source.md'), `${block('branch-flow', 'Canonical text.')}\n`);
  fs.writeFileSync(path.join(dir, 'good.md'), `${block('branch-flow', 'Canonical text.')}\n`);
  fs.writeFileSync(path.join(dir, 'bad.md'), `${block('branch-flow', 'Divergent text.')}\n`);
  withCwd(dir, () => {
    const results = checkFragment({
      id: 'branch-flow',
      source: 'source.md',
      destinations: ['good.md', 'bad.md'],
    });
    const findings = results.filter((r) => !r.ok);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, 'bad.md');
    assert.notStrictEqual(findings[0].file, '');
    assert.notStrictEqual(findings[0].file, 'good.md');
  });
});

test('run: forward-slash destination path in config is normalized to the native separator in finding.file', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'source.md'), `${block('branch-flow', 'Original content.')}\n`);
  fs.writeFileSync(path.join(dir, 'sub', 'dest.md'), `${block('branch-flow', 'Different content.')}\n`);
  withCwd(dir, () => {
    const summary = run({
      fragments: [{ id: 'branch-flow', source: 'source.md', destinations: ['sub/dest.md'] }],
    });
    assert.strictEqual(summary.findings.length, 1);
    // Same assertion shape as test/walk.test.js's toNative tests: compare
    // against a path.sep-joined literal so this stays meaningful on any OS.
    assert.strictEqual(summary.findings[0].file, ['sub', 'dest.md'].join(path.sep));
  });
});

test('checkAnchor: absent anchor is not a finding — the common case stays free', () => {
  assert.strictEqual(checkAnchor({ id: 'x', source: 'a.md' }), null);
});

test('checkAnchor: resolving anchor produces no finding', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'manual.md'), '# Manual\n\n## Step 10\n\nThe rule.\n');
  withCwd(dir, () => {
    assert.strictEqual(
      checkAnchor({ id: 'x', anchor: { file: 'manual.md', text: '## Step 10' } }),
      null,
    );
  });
});

test('checkAnchor: anchor text absent from the anchor file is a finding attributed to that file', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'manual.md'), '# Manual\n\n## Step 11\n\nThe rule, renumbered.\n');
  withCwd(dir, () => {
    const finding = checkAnchor({ id: 'always-on', anchor: { file: 'manual.md', text: '## Step 10' } });
    assert.strictEqual(finding.ok, false);
    assert.strictEqual(finding.file, 'manual.md');
    assert.match(finding.message, /anchor "## Step 10" no longer occurs here/);
    assert.match(finding.message, /fragment "always-on"/);
  });
});

test('checkAnchor: missing anchor file is a distinct finding from missing anchor text', () => {
  const dir = tmpRepo();
  withCwd(dir, () => {
    const finding = checkAnchor({ id: 'x', anchor: { file: 'gone.md', text: '## Step 10' } });
    assert.strictEqual(finding.file, 'gone.md');
    assert.match(finding.message, /anchor file does not exist/);
    assert.doesNotMatch(finding.message, /no longer occurs here/);
  });
});

test('checkAnchor: a half-declared anchor is a config error, not a silent pass', () => {
  assert.match(checkAnchor({ id: 'x', anchor: { file: 'a.md' } }).message, /needs both `file` and `text`/);
  assert.match(checkAnchor({ id: 'x', anchor: { text: '## Step 10' } }).message, /needs both `file` and `text`/);
});

// The whole reason the anchor exists: byte-identical copies say nothing about
// whether the heading they quote still exists.
test('checkFragment: blocks perfectly in sync STILL fail when the anchor has moved', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${block('always-on', 'See Step 10.')}\n`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${block('always-on', 'See Step 10.')}\n`);
  fs.writeFileSync(path.join(dir, 'manual.md'), '## Step 11\n\nRenumbered.\n');
  withCwd(dir, () => {
    const results = checkFragment({
      id: 'always-on',
      source: 'CLAUDE.md',
      destinations: ['AGENTS.md'],
      anchor: { file: 'manual.md', text: '## Step 10' },
    });
    const findings = results.filter((r) => !r.ok);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].file, 'manual.md');
    assert.match(findings[0].message, /anchor "## Step 10" no longer occurs/);
    // and the destination comparison still passed on its own
    assert.ok(results.some((r) => r.ok && r.file === 'AGENTS.md'));
  });
});

test('checkFragment: a broken anchor and a diverged destination are reported as two findings, not one', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${block('always-on', 'Canonical.')}\n`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${block('always-on', 'Diverged.')}\n`);
  fs.writeFileSync(path.join(dir, 'manual.md'), '## Step 11\n');
  withCwd(dir, () => {
    const findings = checkFragment({
      id: 'always-on',
      source: 'CLAUDE.md',
      destinations: ['AGENTS.md'],
      anchor: { file: 'manual.md', text: '## Step 10' },
    }).filter((r) => !r.ok);
    assert.strictEqual(findings.length, 2);
    assert.deepStrictEqual(findings.map((f) => f.file).sort(), ['AGENTS.md', 'manual.md']);
  });
});

test('run: forward-slash anchor path is normalized to the native separator in finding.file', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), `${block('always-on', 'Same.')}\n`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `${block('always-on', 'Same.')}\n`);
  fs.writeFileSync(path.join(dir, 'docs', 'manual.md'), '## Step 11\n');
  withCwd(dir, () => {
    const summary = run({
      fragments: [{
        id: 'always-on',
        source: 'CLAUDE.md',
        destinations: ['AGENTS.md'],
        anchor: { file: 'docs/manual.md', text: '## Step 10' },
      }],
    });
    assert.strictEqual(summary.findings.length, 1);
    assert.strictEqual(summary.findings[0].file, ['docs', 'manual.md'].join(path.sep));
  });
});

test('run: multiple independent fragments do not interfere with each other', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'source.md'),
    `${block('branch-flow', 'Flow text.')}\n\n${block('release-flow', 'Release text.')}\n`,
  );
  fs.writeFileSync(path.join(dir, 'dest-a.md'), `${block('branch-flow', 'Flow text.')}\n`);
  fs.writeFileSync(path.join(dir, 'dest-b.md'), `${block('release-flow', 'Release text.')}\n`);
  withCwd(dir, () => {
    const summary = run({
      fragments: [
        { id: 'branch-flow', source: 'source.md', destinations: ['dest-a.md'] },
        { id: 'release-flow', source: 'source.md', destinations: ['dest-b.md'] },
      ],
    });
    assert.strictEqual(summary.findings.length, 0);
    assert.strictEqual(summary.all.length, 2);
    assert.ok(summary.all.every((r) => r.ok));
  });
});
