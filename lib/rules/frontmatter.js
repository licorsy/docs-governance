'use strict';

// Valida o frontmatter declarado e a resolução dos ids de `related:`.
//
// Por que existe: o schema de frontmatter é a única coisa que torna o corpus
// enumerável por máquina. Se ele decai, toda regra acima dele decai junto.
//
// A resolução de `related:` é o que nenhum linter de schema genérico faz — ela
// é cross-file: um id só resolve se algum OUTRO documento o declara. É por
// isso que a lista de fontes de id é maior que a lista de arquivos validados
// (README/CLAUDE.md não são cobrados, mas seus ids contam).

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');
const { parseFrontmatter, parseRelated } = require('../frontmatter');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function collectIds(files) {
  const ids = new Set();
  for (const file of files) {
    const fields = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (fields && fields.id) ids.add(fields.id);
  }
  return ids;
}

function validateFile(filePath, knownIds, cfg) {
  const errors = [];
  const fields = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));

  if (!fields) {
    errors.push('missing or malformed YAML frontmatter block (must open and close with "---")');
    return errors;
  }

  if (knownIds) {
    for (const ref of parseRelated(fields)) {
      if (!knownIds.has(ref)) {
        errors.push(`related entry "${ref}" does not resolve to any document id`);
      }
    }
  }

  for (const field of cfg.required) {
    if (!fields[field]) errors.push(`missing or empty required field: ${field}`);
  }

  if (cfg.status_enum && fields.status && !cfg.status_enum.includes(fields.status)) {
    errors.push(`invalid status "${fields.status}" (expected one of: ${cfg.status_enum.join(', ')})`);
  }

  if (cfg.doc_type_enum && fields.doc_type && !cfg.doc_type_enum.includes(fields.doc_type)) {
    errors.push(`invalid doc_type "${fields.doc_type}" (expected one of: ${cfg.doc_type_enum.join(', ')})`);
  }

  for (const dateField of cfg.date_fields || []) {
    if (fields[dateField] && !DATE_RE.test(fields[dateField])) {
      errors.push(`invalid ${dateField} "${fields[dateField]}" (expected YYYY-MM-DD)`);
    }
  }

  return errors;
}

function scopedFiles(cfg) {
  const files = (cfg.scope_dirs || []).reduce((acc, d) => acc.concat(walkScoped(toNative(d))), []);
  const excluded = (f) => (cfg.exclude_prefixes || []).some((p) => underPrefix(f, p));
  return files
    .filter((f) => !excluded(f))
    .concat((cfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

function run(cfg) {
  const files = scopedFiles(cfg);
  const idSources = files.concat(
    (cfg.id_only_sources || []).reduce((acc, p) => acc.concat(walkScoped(toNative(p))), []),
  );
  const knownIds = collectIds(idSources);

  const findings = [];
  for (const file of files) {
    const errors = validateFile(file, knownIds, cfg);
    if (errors.length > 0) findings.push({ file, messages: errors });
  }

  return {
    findings,
    failSummary: (n) => `${n} file(s) failed frontmatter validation.`,
    okSummary: `All ${files.length} in-scope Markdown file(s) passed frontmatter validation.`,
  };
}

module.exports = { id: 'frontmatter', run, scopedFiles, validateFile, collectIds, DATE_RE };
