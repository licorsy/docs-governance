'use strict';

// Validates declared frontmatter and resolution of `related:` ids.
//
// Why it exists: the frontmatter schema is the one thing that makes the
// corpus machine-enumerable. If it decays, every rule built on top of it
// decays with it.
//
// Resolving `related:` is what no generic schema linter does — it's
// cross-file: an id only resolves if some OTHER document declares it. That's
// why the list of id sources is larger than the list of validated files
// (README/CLAUDE.md aren't checked, but their ids still count).

const fs = require('fs');
const { walkScoped, scopedFiles, toNative } = require('../walk');
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
