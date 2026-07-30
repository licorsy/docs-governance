'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { parseFrontmatter, parseRelated, parseCovers, extractVersion, compareVersions } = require('../lib/frontmatter');
const rule = require('../lib/rules/frontmatter');

const CFG = {
  required: ['title', 'doc_type', 'description', 'status', 'version', 'created', 'updated', 'language'],
  status_enum: ['draft', 'active', 'deprecated', 'archived'],
  doc_type_enum: ['instruction', 'reference', 'status-artifact'],
  date_fields: ['created', 'updated'],
};

function doc(overrides) {
  const base = {
    title: '"t"',
    doc_type: 'reference',
    description: '"d"',
    status: 'active',
    version: '"1.0"',
    created: '2026-07-29',
    updated: '2026-07-29',
    language: 'pt',
  };
  const fields = { ...base, ...overrides };
  const body = Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${body}\n---\n\n# doc\n`;
}

// Escreve num tmpdir e valida, porque validateFile lê do disco.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function withFile(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-'));
  const file = path.join(dir, 'a.md');
  fs.writeFileSync(file, content, 'utf8');
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('valid frontmatter passes with no errors', () => {
  withFile(doc(), (f) => assert.deepStrictEqual(rule.validateFile(f, null, CFG), []));
});

test('missing required field fails', () => {
  withFile(doc({ language: undefined }), (f) => {
    const errors = rule.validateFile(f, null, CFG);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /required field: language/);
  });
});

test('invalid status value fails', () => {
  withFile(doc({ status: 'wip' }), (f) => {
    assert.match(rule.validateFile(f, null, CFG).join(), /invalid status "wip"/);
  });
});

test('invalid doc_type value fails', () => {
  withFile(doc({ doc_type: 'novel' }), (f) => {
    assert.match(rule.validateFile(f, null, CFG).join(), /invalid doc_type "novel"/);
  });
});

test('doc_type enum is not enforced when the config sets it to null', () => {
  withFile(doc({ doc_type: 'anything' }), (f) => {
    assert.deepStrictEqual(rule.validateFile(f, null, { ...CFG, doc_type_enum: null }), []);
  });
});

test('malformed created date fails', () => {
  withFile(doc({ created: '29/07/2026' }), (f) => {
    assert.match(rule.validateFile(f, null, CFG).join(), /invalid created "29\/07\/2026"/);
  });
});

test('missing frontmatter block fails with a single explicit error', () => {
  withFile('# just a heading\n', (f) => {
    const errors = rule.validateFile(f, null, CFG);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /missing or malformed YAML frontmatter/);
  });
});

test('related entries resolving to known ids pass', () => {
  withFile(doc({ id: 'a', related: '[b, c]' }), (f) => {
    assert.deepStrictEqual(rule.validateFile(f, new Set(['b', 'c']), CFG), []);
  });
});

test('dangling related entry fails and names the entry', () => {
  withFile(doc({ id: 'a', related: '[b, ghost]' }), (f) => {
    const errors = rule.validateFile(f, new Set(['b']), CFG);
    assert.strictEqual(errors.length, 1);
    assert.match(errors[0], /"ghost" does not resolve/);
  });
});

test('related check is skipped when no id set is provided (per-file mode)', () => {
  withFile(doc({ related: '[ghost]' }), (f) => {
    assert.deepStrictEqual(rule.validateFile(f, null, CFG), []);
  });
});

test('parseFrontmatter keeps the first occurrence of a duplicated key', () => {
  const fields = parseFrontmatter('---\nstatus: active\nstatus: draft\n---\n');
  assert.strictEqual(fields.status, 'active');
});

test('parseRelated returns [] for a missing or non-inline list', () => {
  assert.deepStrictEqual(parseRelated(null), []);
  assert.deepStrictEqual(parseRelated({ related: 'not-a-list' }), []);
});

test('extractVersion strips quotes', () => {
  assert.strictEqual(extractVersion('---\nversion: "3.10"\n---\n'), '3.10');
  assert.strictEqual(extractVersion("---\nversion: '2.1'\n---\n"), '2.1');
});

test('extractVersion returns null without frontmatter or version', () => {
  assert.strictEqual(extractVersion('# no frontmatter\n'), null);
  assert.strictEqual(extractVersion('---\ntitle: t\n---\n'), null);
});

test('compareVersions handles multi-digit segments numerically', () => {
  assert.strictEqual(compareVersions('3.10', '3.9'), 1);
  assert.strictEqual(compareVersions('3.9', '3.10'), -1);
  assert.strictEqual(compareVersions('1.0', '1.0'), 0);
  assert.strictEqual(compareVersions('1.1', '1'), 1);
});

test('compareVersions returns null only when a segment has no leading digit', () => {
  assert.strictEqual(compareVersions('beta', '1.0'), null);
});

test('parseCovers reads an inline object of id -> version', () => {
  const fields = parseFrontmatter('---\ncovers: {agent: "2.36", agent-identity: "1.6"}\n---\n');
  assert.deepStrictEqual(parseCovers(fields), { agent: '2.36', 'agent-identity': '1.6' });
});

test('parseCovers returns {} for a missing or malformed covers field', () => {
  assert.deepStrictEqual(parseCovers(null), {});
  assert.deepStrictEqual(parseCovers({ covers: 'not-an-object' }), {});
});

test('compareVersions truncates a suffix instead of bailing out', () => {
  // parseInt('0-rc') === 0, não NaN. Documentado porque é contraintuitivo e
  // porque faz um esquema com pré-lançamento ser lido como "sem bump".
  assert.strictEqual(compareVersions('1.0-beta', '1.0'), 0);
  assert.strictEqual(compareVersions('1.0-rc', '1.0-beta'), 0);
});
