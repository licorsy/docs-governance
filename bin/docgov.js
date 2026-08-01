#!/usr/bin/env node

'use strict';

// docgov — mechanical documentation-consistency checker.
//
// Resolves paths via `__dirname` (for itself) and `process.cwd()` (for the
// audited repository). NEVER references ${CLAUDE_PLUGIN_ROOT}: that variable
// only exists on the Claude Code plugin side and doesn't exist in CI. That
// separation is what lets the SAME file serve all three consumers —
// pre-commit, GitHub Actions, and an interactive session.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { load } = require('../lib/config');
const { walkScoped } = require('../lib/walk');
const { parseFrontmatter } = require('../lib/frontmatter');

const VERSION = '1.2.0';

const RULES = [
  require('../lib/rules/frontmatter'),
  require('../lib/rules/internal-links'),
  require('../lib/rules/changelog-retention'),
  require('../lib/rules/version-bump'),
  // Phase 2 (personal-os/local-notes/030): content rules, shadow mode until
  // precision is proven. Each one is inert until the repository declares what
  // to check — `entries: []` for declared_counts/sum_decomposition/facts,
  // empty `scope_dirs`/`root_files` for version_citations (it has no
  // `entries` field) — and runs and finds nothing until then, which is
  // different from being disabled.
  require('../lib/rules/declared-counts'),
  require('../lib/rules/sum-decomposition'),
  require('../lib/rules/facts'),
  require('../lib/rules/version-citations'),
  // Phase 3: covers: in frontmatter vs. the source's real version:.
  require('../lib/rules/sync-destinations'),
  // Phase 4: promotion of layer-4 (LLM-audit) findings that turned out to be
  // mechanically detectable — see README's "The ratchet". Each one is inert
  // until configured (empty `fragments`/`patterns`/`sequences`), same
  // "missing data, not an error" convention as every rule above it.
  require('../lib/rules/fragment-sync'),
  require('../lib/rules/dead-citations'),
  require('../lib/rules/numbered-reference-consistency'),
];

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) args.flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { args.flags[k] = argv[i + 1]; i += 1; }
      else args.flags[k] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function stagedMarkdown() {
  try {
    return new Set(
      execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' })
        .split('\n')
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.split('/').join(path.sep)),
    );
  } catch {
    return null;
  }
}

function cmdCheck(args) {
  const cwd = process.cwd();
  let loaded;
  try {
    loaded = load(cwd, args.flags.config);
  } catch (err) {
    console.error(`docgov: ${err.message}`);
    return 2;
  }

  const { config, warnings } = loaded;
  for (const w of warnings) console.error(`docgov: warning: ${w}`);

  const only = args.flags.rule ? String(args.flags.rule).split(',') : null;
  const staged = args.flags.changed ? stagedMarkdown() : null;
  if (args.flags.changed && staged === null) {
    console.error('docgov: --changed needs a git repository with a staged set; running unfiltered (shadow rules stay skipped under --changed)');
  }

  let failed = 0;

  for (const rule of RULES) {
    const ruleCfg = (config.rules || {})[rule.id] || {};
    if (ruleCfg.enabled === false) continue;
    if (only && !only.includes(rule.id)) continue;

    // A rule in shadow mode never runs under pre-commit (`--changed`) and
    // never fails the process (`check`/CI) — it only prints, prefixed, what
    // it would have found. This is Phase 2 of the plan
    // (`personal-os/local-notes/030`): promotion to blocking is a human
    // decision, made after measuring precision on a real corpus, never
    // automatic because of this code.
    const shadow = !!ruleCfg.shadow;
    if (shadow && args.flags.changed) continue;
    const tag = shadow ? '[shadow] ' : '';

    const ctx = { cwd, baseSha: args.flags['base-sha'] };
    let result;
    try {
      result = rule.run(ruleCfg, ctx);
    } catch (err) {
      console.error(`\n${tag}[${rule.id}] rule crashed: ${err.message}`);
      if (!shadow) failed += 1;
      continue;
    }

    if (result.skipped) {
      console.log(`${tag}[${rule.id}] skipped — ${result.reason}`);
      continue;
    }

    let findings = result.findings;
    if (staged) findings = findings.filter((f) => staged.has(f.file));

    if (findings.length === 0) {
      // Under --changed the summary count is for the whole repository, not
      // what was filtered; saying "all good" with a number that doesn't
      // match the reported scope would be misleading. Hence the explicit
      // label.
      console.log(tag + (staged ? `[${rule.id}] no findings in staged files` : result.okSummary));
      continue;
    }

    if (!shadow) failed += 1;
    for (const finding of findings) {
      if (result.inlineMessages) {
        for (const m of finding.messages) console.error(tag + m);
      } else {
        console.error('\n' + tag + finding.file);
        for (const m of finding.messages) console.error('  - ' + m);
      }
    }
    console.error('\n' + tag + result.failSummary(findings.length));
    if (ruleCfg.why) console.error(`  why this rule exists: ${ruleCfg.why}`);
  }

  return failed > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// sync-status — human-readable report for the `sync_destinations` rule. It
// exists as its own command (instead of just running via `check --rule
// sync_destinations`) because whoever invokes this (step 8 of `personal-os`'s
// Weekly Review) wants the state of EVERY target, including the ones that are
// OK — `check` only prints what failed.

function cmdSyncStatus() {
  const cwd = process.cwd();
  let loaded;
  try {
    loaded = load(cwd);
  } catch (err) {
    console.error(`docgov: ${err.message}`);
    return 2;
  }

  const { config } = loaded;
  const cfg = (config.rules || {}).sync_destinations || {};
  if (!(cfg.targets || []).length) {
    console.log('sync-status: no targets configured (rules.sync_destinations.targets is empty)');
    return 0;
  }

  const rule = require('../lib/rules/sync-destinations');
  const result = rule.run(cfg);

  let anyStale = false;
  for (const r of result.all) {
    console.log(r.ok ? `OK    ${r.message}` : `STALE ${r.message}`);
    if (!r.ok) anyStale = true;
  }

  return anyStale ? 1 : 0;
}

// ---------------------------------------------------------------------------
// init — discovers the shape of the repository instead of asking. Zero
// tokens: it's just `fs` and `git log`.

function discover(cwd) {
  const skip = new Set(['.git', 'node_modules', '.vscode', '.github', 'local-notes', 'dist', 'build']);
  const dirs = fs.readdirSync(cwd, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !skip.has(e.name))
    .map((e) => e.name);

  const density = [];
  for (const d of dirs) {
    const files = walkScoped(d);
    if (files.length === 0) continue;
    const withFm = files.filter((f) => parseFrontmatter(fs.readFileSync(f, 'utf8'))).length;
    density.push({ dir: d, files: files.length, withFm });
  }
  // A directory enters scope when most of its .md files already carry
  // frontmatter — i.e. when the convention already holds there in practice.
  const scopeDirs = density.filter((d) => d.withFm > d.files / 2).map((d) => d.dir);

  const rootFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md'].filter((f) => fs.existsSync(path.join(cwd, f)));

  // Changelog marker actually in use, measured rather than assumed.
  const markers = ['Changelog:', 'Changelog of this document:'];
  const counts = markers.map((m) => {
    let n = 0;
    for (const d of scopeDirs) {
      for (const f of walkScoped(d)) {
        if (fs.readFileSync(f, 'utf8').split(/\r?\n/).some((l) => l.trim() === m)) n += 1;
      }
    }
    return { marker: m, n };
  }).sort((a, b) => b.n - a.n);

  // Candidates for frozen history: directories whose content hasn't been
  // touched in many commits. A suggestion, not a decision — init comments it
  // out, it doesn't enable it.
  let stale = [];
  try {
    const recent = execFileSync('git', ['log', '-n', '80', '--name-only', '--pretty=format:'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    stale = scopeDirs.flatMap((d) => {
      const subs = fs.existsSync(d)
        ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${d}/${e.name}`)
        : [];
      return subs.filter((s) => !recent.some((f) => f.startsWith(s + '/')));
    });
  } catch { /* no git: no history suggestion */ }

  return { scopeDirs, rootFiles, marker: counts[0] && counts[0].n > 0 ? counts[0].marker : 'Changelog:', stale };
}

function renderConfig(d) {
  const list = (a) => `[${a.map((x) => `'${x}'`).join(', ')}]`;
  return `'use strict';

// Generated by \`docgov init\`. Adjust and commit.
//
// This config declares DATA, never logic. If you need a check that doesn't
// exist, it belongs in the engine (licorsy/docs-governance), not here —
// otherwise the engine ends up forked-by-config and duplication sneaks back
// in through the side door.

// Every rule accepts a \`why\` field, printed when it fails. Fill it with the
// REAL defect that motivated the rule. A rule with no real defect shouldn't
// exist.

module.exports = {
  engine: '^1',

  rules: {
    frontmatter: {
      scope_dirs: ${list(d.scopeDirs)},
      root_files: [],
      exclude_prefixes: [],${d.stale.length ? `\n      // detected candidates for frozen history: ${d.stale.join(', ')}` : ''}
      // ids from these count toward resolving \`related:\`, but the files
      // themselves aren't checked — README/AGENTS/CLAUDE.md rarely carry the
      // full frontmatter schema, so \`init\` proposes them here, not in
      // \`root_files\`. Move an entry up to \`root_files\` once you've actually
      // added frontmatter to it and want it validated.
      id_only_sources: ${list(d.rootFiles)},
      required: ['title', 'doc_type', 'description', 'status', 'version', 'created', 'updated', 'language'],
      status_enum: ['draft', 'active', 'deprecated', 'archived'],
      doc_type_enum: null, // null = don't enforce the enum
      date_fields: ['created', 'updated'],
    },

    'internal-links': {
      // prunes by directory NAME, at any depth
      exclude_dir_names: ['.git', 'node_modules', '.vscode', 'local-notes'],
      // links that should never be checked (e.g. gitignored target)
      skip_link_patterns: [],
    },

    'changelog-retention': {
      scope_dirs: ${list(d.scopeDirs)},
      root_files: ${list(d.rootFiles)},
      exclude_prefixes: [],
      exclude_files: [],
      marker: '${d.marker}',
      max_entries: 3,
      why: null,
    },

    'version-bump': {
      enabled: true,
    },

    // ---- Phase 2: content rules, shadow mode until precision is proven ----
    // Each one is inert until you declare what to check — \`entries\` for the
    // first three, \`scope_dirs\`/\`root_files\` for version_citations (it has
    // no \`entries\` field) — and runs and finds nothing until then (missing
    // data, not an error). Shadow mode itself is a default this engine applies
    // (see \`lib/config.js\`), not a field written here; set \`shadow: false\`
    // below to promote one to blocking. Examples:
    //
    // declared_counts: { entries: [
    //   { file: 'docs/index.md', pattern: /(\\d+) prompts total/, dir: 'docs/prompts' },
    // ] },
    // sum_decomposition: { entries: [
    //   { file: 'docs/index.md', pattern: /(\\d+) \\+ (\\d+) \\+ (\\d+) = (\\d+)/ },
    // ] },
    // facts: { scope_dirs: ${list(d.scopeDirs)}, entries: [
    //   { id: 'slug', value: '5', required_in: [{ file: 'README.md', pattern: /5 routines/ }], forbidden: [/4 routines/] },
    // ] },
    // version_citations: { scope_dirs: ${list(d.scopeDirs)}, root_files: ${list(d.rootFiles)} },

    // ---- Phase 3: covers: in the destination's frontmatter vs. the source's version: ----
    // sync_destinations: {
    //   targets: ['docs/prompts/006-project.md'],
    //   scope_dirs: ${list(d.scopeDirs)}, root_files: ${list(d.rootFiles)},
    // },

    // ---- Phase 4: fragment/citation/numbered-reference rules promoted from
    // repeated layer-4 (LLM-audit) findings — see README's "The ratchet" ----
    // fragment_sync: { fragments: [
    //   { id: 'branch-flow', source: 'README.md', destinations: ['CLAUDE.md'] },
    // ] },
    // dead_citations: { scope_dirs: ${list(d.scopeDirs)}, patterns: [
    //   { id: 'md-files', kind: 'filename' },
    //   { id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 },
    // ] },
    // numbered_reference_consistency: { scope_dirs: ${list(d.scopeDirs)}, sequences: [
    //   { id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] },
    // ] },
  },
};
`;
}

const PRE_COMMIT = `#!/bin/sh
# installed by \`docgov init --hook\`
# A false positive here is worse than a false negative: it teaches people to
# use --no-verify. If this hook flags something wrong, FIX THE RULE or REMOVE
# THE RULE.
exec node "$DOCGOV_BIN" check --changed
`;

function installHook(cwd) {
  const hookDir = path.join(cwd, '.git', 'hooks');
  if (!fs.existsSync(hookDir)) {
    console.error('docgov: no .git/hooks — skipping hook install');
    return false;
  }
  const hookPath = path.join(hookDir, 'pre-commit');
  const bin = path.join(__dirname, 'docgov.js');
  fs.writeFileSync(hookPath, PRE_COMMIT.replace('$DOCGOV_BIN', bin.split(path.sep).join('/')), 'utf8');
  try { fs.chmodSync(hookPath, 0o755); } catch { /* Windows: no execute bit */ }
  console.log(`installed .git/hooks/pre-commit -> ${bin}`);
  return true;
}

function cmdInit(args) {
  const cwd = process.cwd();
  const target = path.join(cwd, '.docgov.config.js');

  if (fs.existsSync(target) && !args.flags.force) {
    // Config already exists: `--hook` alone is still a legitimate request —
    // installing the hook in an already-configured repository is the common
    // case, and requiring --force for that would mean overwriting a
    // hand-written config just to get a hook.
    if (args.flags.hook) {
      console.log('.docgov.config.js already exists — keeping it');
      installHook(cwd);
      return 0;
    }
    console.error('docgov: .docgov.config.js already exists (use --force to overwrite, or --hook to only install the hook)');
    return 2;
  }

  const d = discover(cwd);
  if (d.scopeDirs.length === 0) {
    console.error('docgov: no directory found where most .md files carry frontmatter.');
    console.error('  docgov governs a frontmatter convention; there is nothing to govern here yet.');
    return 2;
  }

  fs.writeFileSync(target, renderConfig(d), 'utf8');
  console.log(`wrote .docgov.config.js`);
  console.log(`  scope: ${d.scopeDirs.join(', ')}`);
  console.log(`  root-level files: ${d.rootFiles.join(', ') || '(none)'} (frontmatter: id-only; changelog-retention: validated)`);
  console.log(`  changelog marker: "${d.marker}"`);
  if (d.stale.length) console.log(`  possible frozen history (commented, not enabled): ${d.stale.join(', ')}`);

  if (args.flags.hook) installHook(cwd);

  return 0;
}

const USAGE = `docgov ${VERSION} — mechanical documentation-consistency checks

  docgov check       [--config <path>] [--changed] [--base-sha <sha>] [--rule <id,...>]
  docgov init        [--hook] [--force]
  docgov sync-status

  check       run every enabled rule; exit 1 on findings, 2 on setup error.
              Rules in shadow mode (\`shadow: true\`, on by default for the
              Phase 2 content rules — see lib/config.js) never fail the
              process and never run under --changed; findings print prefixed
              "[shadow]"
  --changed   report only findings in staged files (for pre-commit)
  --base-sha  base commit for the version-bump rule (or BASE_SHA env var)
  init        generate .docgov.config.js by discovering this repository's shape
  --hook      also install .git/hooks/pre-commit
  sync-status per-target report of rules.sync_destinations (OK and STALE both
              printed, not just failures); exit 1 if any target is stale
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.flags.version) { console.log(VERSION); return 0; }
  if (!cmd || args.flags.help) { console.log(USAGE); return cmd ? 0 : 2; }

  if (cmd === 'check') return cmdCheck(args);
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'sync-status') return cmdSyncStatus();

  console.error(`docgov: unknown command "${cmd}"\n\n${USAGE}`);
  return 2;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, parseArgs, discover, VERSION };
