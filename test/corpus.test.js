'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildIdIndex } = require('../lib/corpus');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-corpus-'));
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

test('buildIdIndex maps id to file and version', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), fm('agent', '2.41'));
  withCwd(dir, () => {
    const index = buildIdIndex({ root_files: ['AGENTS.md'] });
    assert.deepStrictEqual(index.get('agent'), { file: 'AGENTS.md', version: '2.41' });
  });
});

test('buildIdIndex walks scope_dirs too', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/agent-identity.md'), fm('agent-identity', '1.7'));
  withCwd(dir, () => {
    const index = buildIdIndex({ scope_dirs: ['docs'] });
    assert.strictEqual(index.get('agent-identity').version, '1.7');
  });
});

test('buildIdIndex ignores files without an id', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.md'), '---\ntitle: "x"\nversion: "1.0"\n---\n');
  withCwd(dir, () => {
    const index = buildIdIndex({ root_files: ['a.md'] });
    assert.strictEqual(index.size, 0);
  });
});
