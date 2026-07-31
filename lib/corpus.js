'use strict';

// id -> {file, version} index, built from the corpus's frontmatter. Used by
// the `sync-destinations` rule: a document declares `covers: { id: "X.Y" }`
// in its own frontmatter, and this resolves "id" to the real file and its
// current `version:`, with no fixed list of paths anywhere — the same
// principle that already holds for `related:` in the `frontmatter` rule.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('./walk');
const { parseFrontmatter } = require('./frontmatter');

function scopedFiles(cfg) {
  const files = (cfg.scope_dirs || []).reduce((acc, d) => acc.concat(walkScoped(toNative(d))), []);
  const excluded = (f) => (cfg.exclude_prefixes || []).some((p) => underPrefix(f, p));
  return files
    .filter((f) => !excluded(f))
    .concat((cfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

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
