'use strict';

// This repository IS the engine. Running the engine against itself is the
// point: a rule that would embarrass us here shouldn't ship to consumers.
//
// This config declares DATA, never logic. If you need a check that doesn't
// exist, it belongs in lib/rules/ — which is right here — not in this file.
// A config that grows its own logic is the forked-by-config failure mode the
// generated template warns about in every consuming repository.

// Every rule accepts a `why` field, printed when it fails. Fill it with the
// REAL defect that motivated the rule. A rule with no real defect shouldn't
// exist.

module.exports = {
  engine: '^1',

  rules: {
    frontmatter: {
      // agents/ and commands/ are Claude Code plugin manifests, whose
      // frontmatter (name, description, tools, model) is the routing contract
      // Claude Code parses — not this engine's document schema. `description`
      // is the field both kinds share and the one routing actually needs.
      //
      // CLAUDE.md carries the full org schema (title, doc_type, description,
      // status, version, created, updated, language) under the org-wide
      // decision that every tracked Markdown file is enumerable. Only
      // `description` is ENFORCED, because this rule applies one `required`
      // list to everything in scope and the manifests above cannot satisfy
      // the other seven. Enforcing both needs two rules with independent
      // `required` lists — an engine change, tracked rather than worked
      // around here.
      //
      // README.md stays out: it is the rendered repository landing page, and
      // GitHub renders frontmatter there as a visible table.
      scope_dirs: ['agents', 'commands'],
      root_files: ['AGENTS.md', 'CLAUDE.md'],
      exclude_prefixes: [],
      id_only_sources: [],
      required: ['description'],
      status_enum: ['draft', 'active', 'deprecated', 'archived'],
      doc_type_enum: null, // null = don't enforce the enum
      date_fields: ['created', 'updated'],
      why: 'a missing description breaks Claude Code\'s ability to route to this '
        + 'agent/command at all',
    },

    'internal-links': {
      // prunes by directory NAME, at any depth. `.superpowers` holds
      // untracked session working files from the skill that built parts of
      // this engine; they are not part of the corpus.
      exclude_dir_names: ['.git', 'node_modules', '.vscode', 'local-notes', '.superpowers', 'test'],
      skip_link_patterns: [],
      why: 'README.md and CLAUDE.md cross-reference lib/rules/ and the agents by '
        + 'path; renaming a rule file without updating them is the drift this '
        + 'engine exists to catch elsewhere',
    },

    'changelog-retention': {
      scope_dirs: ['agents', 'commands'],
      root_files: ['AGENTS.md', 'CLAUDE.md'],
      exclude_prefixes: [],
      exclude_files: [],
      marker: 'Changelog:',
      max_entries: 3,
      why: 'unbounded in-body changelogs push the real history out of reach; the '
        + 'newest three belong in the file, the rest belongs to `git log --follow`',
    },

    'version-bump': {
      enabled: true,
    },

    // ---- Phase 2+ content rules ----
    // Each exists to pin a fact that has ALREADY drifted here; adding entries
    // speculatively is how a config turns into logic. Everything else stays
    // inert until a real defect motivates it.
    facts: {
      // NOT shadow. `facts` ships shadow-on, which reports and never fails —
      // and a pin that only reports is precisely what let the first entry
      // below drift unnoticed in the repository that SHIPS this rule. Turning
      // it off also makes it run under `--changed`, so pre-commit catches
      // drift rather than CI at promotion time.
      shadow: false,
      scope_dirs: ['agents', 'commands'],
      root_files: ['AGENTS.md', 'CLAUDE.md', 'README.md'],
      entries: [
        {
          id: 'docs-governance-guard-clauses',
          value: "github.event_name == 'pull_request' && hashFiles('.docgov.config.js') != '' && hashFiles('.github/workflows/docs-governance.yml') == ''",
          why: 'this repository shipped a ONE-clause guard while its own CLAUDE.md '
            + 'asserted three (now AGENTS.md) — the engine failing the check it sells. '
            + 'git-governance pins the same fact and stayed correct; this repo '
            + 'had no facts entry at all, which is the whole reason the drift '
            + 'survived here and nowhere else',
          required_in: [
            {
              file: 'AGENTS.md',
              pattern: /all three of[\s\S]*?hashFiles\('\.github\/workflows\/docs-governance\.yml'\) == ''/,
            },
            {
              file: '.github/workflows/pr-checks.yml',
              pattern: /github\.event_name == 'pull_request' &&[\s\S]*?hashFiles\('\.docgov\.config\.js'\) != '' &&[\s\S]*?hashFiles\('\.github\/workflows\/docs-governance\.yml'\) == ''/,
            },
          ],
        },
      ],
    },
  },
};
