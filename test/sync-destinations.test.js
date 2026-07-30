'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkTarget } = require('../lib/rules/sync-destinations');
const { buildIdIndex } = require('../lib/corpus');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-sync-dest-'));
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

function fm(id, version) {
  return `---\ntitle: "x"\nid: ${id}\nversion: "${version}"\n---\n\nbody\n`;
}

function fmCovers(covers) {
  return `---\ntitle: "x"\nversion: "1.0"\ncovers: {${covers}}\n---\n\nbody\n`;
}

test('checkTarget reports ok when the covered version matches the source', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'agents.md'), fm('agent', '2.36'));
  fs.writeFileSync(path.join(dir, 'project.md'), fmCovers('agent: "2.36"'));
  withCwd(dir, () => {
    const idIndex = buildIdIndex({ root_files: ['agents.md'] });
    const results = checkTarget('project.md', idIndex);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].ok, true);
  });
});

test('checkTarget flags a stale covers version', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'agents.md'), fm('agent', '2.40'));
  fs.writeFileSync(path.join(dir, 'project.md'), fmCovers('agent: "2.36"'));
  withCwd(dir, () => {
    const idIndex = buildIdIndex({ root_files: ['agents.md'] });
    const results = checkTarget('project.md', idIndex);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].ok, false);
    assert.match(results[0].message, /declares covers.agent = "2.36", but agents\.md is at "2.40"/);
  });
});

test('checkTarget flags an id that resolves to nothing in scope', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'project.md'), fmCovers('ghost: "1.0"'));
  withCwd(dir, () => {
    const idIndex = buildIdIndex({});
    const results = checkTarget('project.md', idIndex);
    assert.strictEqual(results.length, 1);
    assert.match(results[0].message, /covers unknown id "ghost"/);
  });
});

test('checkTarget with multiple covers checks each independently', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'agents.md'), fm('agent', '2.40'));
  fs.writeFileSync(path.join(dir, 'identity.md'), fm('agent-identity', '1.7'));
  fs.writeFileSync(path.join(dir, 'project.md'), fmCovers('agent: "2.40", agent-identity: "1.6"'));
  withCwd(dir, () => {
    const idIndex = buildIdIndex({ root_files: ['agents.md', 'identity.md'] });
    const results = checkTarget('project.md', idIndex);
    assert.strictEqual(results.length, 2);
    const byId = Object.fromEntries(results.map((r) => [r.id, r.ok]));
    assert.strictEqual(byId.agent, true);
    assert.strictEqual(byId['agent-identity'], false);
  });
});

test('checkTarget returns nothing for a file without covers', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'project.md'), '---\ntitle: "x"\nversion: "1.0"\n---\n');
  withCwd(dir, () => {
    const results = checkTarget('project.md', buildIdIndex({}));
    assert.strictEqual(results.length, 0);
  });
});
