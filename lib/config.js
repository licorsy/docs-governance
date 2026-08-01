'use strict';

// Loads `.docgov.config.js` from the audited repository.
//
// The config is CommonJS, not JSON, for three concrete reasons: it allows
// literal regex (instead of double-escaped "\\bfoo\\b"), it allows comments —
// and the config is where the "why" of each rule lives —, and it allows
// composing lists. The risk of executable config is acceptable in a
// single-owner repository; it wouldn't be in a multi-tenant context.
//
// ARCHITECTURAL PRINCIPLE: the config declares DATA, never logic. If two
// repositories need the same new construct, it moves up to `lib/`. That's
// what keeps the engine from being forked-by-config — which is exactly how
// the problem it solves was born.

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
      root_files: [],
      // README rarely carries the full required-fields schema, so by default
      // it counts toward resolving `related:` ids without being validated —
      // move it to `root_files` once it actually carries frontmatter.
      id_only_sources: ['README.md'],
      required: ['title', 'doc_type', 'description', 'status', 'version', 'created', 'updated', 'language'],
      status_enum: ['draft', 'active', 'deprecated', 'archived'],
      doc_type_enum: null, // null = don't enforce the enum
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

    fragment_sync: {
      enabled: true,
      fragments: [],
    },

    dead_citations: {
      enabled: true,
      shadow: true,
      scope_dirs: [],
      root_files: [],
      exclude_prefixes: [],
      exempt: {},
      patterns: [],
    },

    numbered_reference_consistency: {
      enabled: true,
      shadow: true,
      scope_dirs: [],
      root_files: [],
      exclude_prefixes: [],
      exempt: {},
      sequences: [],
    },
  },
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof RegExp);
}

// Shallow merge per rule: arrays and regex are replaced, objects are merged.
// Replacing arrays is deliberate — if the repository declares `scope_dirs`,
// it wants exactly that, not that plus the default.
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
    // A warning, not a failure: CI is the gate and runs a pinned version;
    // local execution is ahead-of-time and may be ahead or behind. Pretending
    // the skew doesn't exist would be worse than declaring it.
    warnings.push(
      `config declares engine ${cfg.engine} but this docgov is major ${ENGINE_MAJOR} — ` +
      'results may differ from CI',
    );
  }

  return { config: cfg, file, warnings };
}

module.exports = { load, merge, DEFAULTS, ENGINE_MAJOR, engineMajor };
