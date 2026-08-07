'use strict';

// lib/references.js builds a reference graph over a given file set, from the
// two structured, reliably-resolvable citation kinds: markdown links
// (lib/rules/internal-links.js's link scan) and frontmatter `related:` ids
// (resolved the same way the `frontmatter` rule resolves them). Used to
// expand an incremental change set by one hop.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildReferenceGraph, expandWithReferrers } = require('../lib/references');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-references-'));
}

function write(dir, file, content) {
  fs.writeFileSync(path.join(dir, file), content);
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

test('buildReferenceGraph maps a markdown link to a reverse edge on the cited file', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n\nsee [b](./b.md)\n');
  write(dir, 'b.md', '# b\n');

  withCwd(dir, () => {
    const graph = buildReferenceGraph(['a.md', 'b.md']);
    assert.deepStrictEqual([...graph.reverse.get('b.md')], ['a.md']);
    assert.deepStrictEqual([...graph.forward.get('a.md')], ['b.md']);
  });
});

test('buildReferenceGraph maps a related: id to a reverse edge on the file that declares that id', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '---\nid: doc-a\n---\n\n# a\n');
  write(dir, 'b.md', '---\nrelated: [doc-a]\n---\n\n# b\n');

  withCwd(dir, () => {
    const graph = buildReferenceGraph(['a.md', 'b.md']);
    assert.deepStrictEqual([...graph.reverse.get('a.md')], ['b.md']);
  });
});

test('buildReferenceGraph ignores links/ids that resolve outside the given file set', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n\nsee [out](./out.md)\n');
  write(dir, 'out.md', '# out, not in scope\n');

  withCwd(dir, () => {
    const graph = buildReferenceGraph(['a.md']);
    assert.deepStrictEqual([...graph.forward.get('a.md')], []);
  });
});

test('expandWithReferrers adds direct referrers of a changed file, one hop', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a\n\nsee [b](./b.md)\n');
  write(dir, 'b.md', '# b\n');
  write(dir, 'c.md', '# c, unrelated\n');

  withCwd(dir, () => {
    const graph = buildReferenceGraph(['a.md', 'b.md', 'c.md']);
    const expanded = expandWithReferrers(['b.md'], graph).sort();
    assert.deepStrictEqual(expanded, ['a.md', 'b.md']);
  });
});

test('expandWithReferrers does not walk a second hop', () => {
  const dir = tmpRepo();
  // z -> y -> x (z cites y, y cites x); x changed. Only y (the direct
  // referrer of x) should be pulled in, not z (a referrer of y).
  write(dir, 'x.md', '# x\n');
  write(dir, 'y.md', '# y\n\nsee [x](./x.md)\n');
  write(dir, 'z.md', '# z\n\nsee [y](./y.md)\n');

  withCwd(dir, () => {
    const graph = buildReferenceGraph(['x.md', 'y.md', 'z.md']);
    const expanded = expandWithReferrers(['x.md'], graph).sort();
    assert.deepStrictEqual(expanded, ['x.md', 'y.md']);
  });
});

test('expandWithReferrers with no referrers returns just the changed set', () => {
  const dir = tmpRepo();
  write(dir, 'a.md', '# a, cites nothing\n');

  withCwd(dir, () => {
    const graph = buildReferenceGraph(['a.md']);
    assert.deepStrictEqual(expandWithReferrers(['a.md'], graph), ['a.md']);
  });
});
