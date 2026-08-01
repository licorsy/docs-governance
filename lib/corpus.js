'use strict';

// id -> {file, version} index, built from the corpus's frontmatter. Used by
// the `sync-destinations` rule: a document declares `covers: { id: "X.Y" }`
// in its own frontmatter, and this resolves "id" to the real file and its
// current `version:`, with no fixed list of paths anywhere — the same
// principle that already holds for `related:` in the `frontmatter` rule.

const fs = require('fs');
const { scopedFiles } = require('./walk');
const { parseFrontmatter } = require('./frontmatter');

function buildIdIndex(cfg) {
  const index = new Map();
  for (const file of scopedFiles(cfg)) {
    const fields = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (fields && fields.id) {
      index.set(fields.id, { file, version: fields.version ? fields.version.replace(/^["']|["']$/g, '') : null });
    }
  }
  return index;
}

module.exports = { buildIdIndex, scopedFiles };
