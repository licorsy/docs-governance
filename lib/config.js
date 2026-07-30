'use strict';

// Carrega `.docgov.config.js` do repositório auditado.
//
// A config é CommonJS, não JSON, por três razões concretas: permite regex
// literal (em vez de "\\bfoo\\b" duas vezes escapado), permite comentário — e
// a config é o lugar onde o "por quê" de cada regra vive —, e permite compor
// listas. O risco de config executável é aceitável num repositório de dono
// único; num contexto multi-tenant não seria.
//
// PRINCÍPIO ARQUITETURAL: a config declara DADOS, nunca lógica. Se dois
// repositórios precisarem da mesma construção nova, ela sobe para `lib/`. É
// isso que impede o motor de ser forkado por config — que é exatamente como o
// problema que ele resolve nasceu.

const fs = require('fs');
const path = require('path');

const ENGINE_MAJOR = 1;

const DEFAULTS = {
  engine: '^1',
  rules: {
    frontmatter: {
      enabled: true,
      scope_dirs: ['docs'],
      exclude_prefixes: [],
      root_files: ['README.md'],
      id_only_sources: [],
      required: ['title', 'doc_type', 'description', 'status', 'version', 'created', 'updated', 'language'],
      status_enum: ['draft', 'active', 'deprecated', 'archived'],
      doc_type_enum: null, // null = não cobra o enum
      date_fields: ['created', 'updated'],
    },
    'internal-links': {
      enabled: true,
      walk_root: null, // null = process.cwd()
      exclude_dir_names: ['.git', 'node_modules', '.vscode'],
      skip_link_patterns: [],
    },
    'changelog-retention': {
      enabled: true,
      scope_dirs: ['docs'],
      root_files: ['README.md'],
      exclude_prefixes: [],
      exclude_files: [],
      marker: 'Changelog:',
      max_entries: 3,
      why: null,
    },
    'version-bump': {
      enabled: true,
    },
    declared_counts: {
      enabled: true,
      shadow: true,
      entries: [],
      exempt: {},
    },
    sum_decomposition: {
      enabled: true,
      shadow: true,
      entries: [],
      exempt: {},
    },
    facts: {
      enabled: true,
      shadow: true,
      entries: [],
      scope_dirs: [],
      root_files: [],
      exclude_prefixes: [],
      exempt: {},
    },
    version_citations: {
      enabled: true,
      shadow: true,
      scope_dirs: [],
      root_files: [],
      exclude_prefixes: [],
      exempt: {},
    },
    sync_destinations: {
      enabled: true,
      targets: [],
      scope_dirs: [],
      root_files: [],
      exclude_prefixes: [],
    },
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp);
}

// Merge raso por regra: array e regex substituem, objeto funde. Substituir
// arrays é deliberado — se o repositório declara `scope_dirs`, ele quer
// exatamente aquilo, não aquilo mais o default.
function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    out[k] = isPlainObject(v) && isPlainObject(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function engineMajor(spec) {
  const m = /(\d+)/.exec(String(spec || ''));
  return m ? parseInt(m[1], 10) : null;
}

function load(cwd, explicitPath) {
  const file = path.resolve(cwd, explicitPath || '.docgov.config.js');
  if (!fs.existsSync(file)) {
    const err = new Error(
      `no config found at ${path.relative(cwd, file) || file}\n` +
      '  run `docgov init` to generate one from what this repository already looks like',
    );
    err.code = 'ENOCONFIG';
    throw err;
  }

  // eslint-disable-next-line global-require, import/no-dynamic-require
  const raw = require(file);
  const cfg = merge(DEFAULTS, raw);

  const declared = engineMajor(cfg.engine);
  const warnings = [];
  if (declared !== null && declared !== ENGINE_MAJOR) {
    // Aviso, não falha: o CI é o portão e roda numa versão fixada; a execução
    // local é adiantamento e pode estar à frente ou atrás. Fingir que o skew
    // não existe seria pior do que declará-lo.
    warnings.push(
      `config declares engine ${cfg.engine} but this docgov is major ${ENGINE_MAJOR} — ` +
      'results may differ from CI',
    );
  }

  return { config: cfg, file, warnings };
}

module.exports = { load, merge, DEFAULTS, ENGINE_MAJOR, engineMajor };
