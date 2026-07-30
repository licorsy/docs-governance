'use strict';

// Índice id -> {file, version}, construído a partir do frontmatter do corpus.
// Usado pela regra `sync-destinations`: um documento declara `covers: { id:
// "X.Y" }` no próprio frontmatter, e isto resolve "id" para o arquivo real e
// sua `version:` atual, sem lista fixa de caminhos em lugar nenhum — o mesmo
// princípio que já vale para `related:` na regra `frontmatter`.

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
