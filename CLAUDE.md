---
title: "Claude Code Instructions"
doc_type: instruction
description: "Git branch, commit, and merge policy in force for this repository, scaffolded from the git-governance plugin: the branch flow and prefix taxonomy, Conventional Commits, the autonomous-to-develop and human-gated-to-staging/main permission model, the local and remote validation layers, and how companion plugins compose with it."
status: active
version: "1.1.0"
created: 2026-08-01
updated: 2026-08-01
language: en
id: claude-instructions
owner: Alexandre Clemente
tags: [git, branching, commits, merge-policy, claude-code]
---

# Claude Code Instructions

Portable Git branch/merge/commit governance for a solo maintainer working with
Claude Code, scaffolded here from the `git-governance` plugin. Do not add
project-specific detail that wouldn't make sense verbatim in another repo — the
plugin's copy is the source, and this one is expected to stay a faithful
scaffold of it.

The frontmatter block above is the one exception: `created`, `updated`, and
`owner` describe *this* repository, and a scaffolded copy should reset them to
the target's own values. The remaining fields carry over unchanged.

## Branch flow

<!-- fragment:branch-flow:start -->
```text
feat/* (also fix/, refactor/, docs/, chore/, hotfix/)  ->  develop  ->  staging  ->  main
```
<!-- fragment:branch-flow:end -->

- Work branches are created from an up-to-date `develop`.
- `develop -> staging` and `staging -> main` are promotions, never a starting point
  for new work.
- Naming: `<prefix>/<id>-<short-description>`, prefixes `feat`, `fix`,
  `refactor`, `docs`, `chore`, `hotfix`. Full taxonomy and the permission
  matrix live in `agents/git-governance-advisor.md`.

## Commit policy

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`,
  types `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, `build`, `ci`.
  Use a `BREAKING CHANGE:` footer for breaking changes.
- Small, frequent commits over large batched ones.
- `pre-commit` must run and pass **before every commit**, not just before a
  merge — see "Local validation layer" below.

## Merge policy

- **Never push directly to a protected branch.** `staging`, `main`, and
  `develop` are all protected server-side by the same ruleset (see
  `scripts/setup-branch-protection.sh`) — direct push is blocked on all
  three, not just `staging`/`main`. What distinguishes `develop` isn't a
  lighter server-side gate, it's the permission model below.
- Merging into `develop` is autonomous: Claude Code opens the PR and merges
  it once `pre-commit` and commit-message checks pass. No pause is needed —
  every branch requires 0 approvals by design (solo maintainer), so what
  makes `develop` safe to automate is that errors there are cheap to revert,
  not a lighter review requirement.
- Merging into `staging` or `main` always requires **explicit human confirmation
  before the PR is even opened**, and the merge itself is a human action, not
  an automated one — even when the request comes from the repo owner using
  their own credentials. See the permission model in
  `agents/git-governance-advisor.md`.

## Local validation layer (primary)

`pre-commit` is the main gate, not GitHub Actions. Install once per clone:

```bash
pre-commit install
pre-commit install --hook-type commit-msg
```

Both commands are required — the first wires up the file-content hooks
(whitespace, EOF, YAML/JSON, merge-conflict markers), the second wires up the
Conventional Commits check, which runs at a different git hook stage.

## Remote validation layer (secondary, quota-conscious)

GitHub Actions (`.github/workflows/pr-checks.yml`) only runs on:

- `pull_request` targeting `staging` or `main`
- manual `workflow_dispatch`

It deliberately does **not** run on `develop` or on plain `push`. `develop`
already gets the same checks locally via `pre-commit` on every commit, and
merges into `develop` happen automatically and often — running Actions there
too would burn quota on checks that already passed locally. `staging` and `main`
are the deliberate, infrequent promotion points, so that's where spending
Actions minutes on one more remote confirmation is worth it.

## Companion plugins

`git-governance` owns branch taxonomy, commit format, and merge permissions
for a repo. It does **not** need to own every workflow trigger — a companion
plugin may bring its own workflow instead of using a shared step in
`pr-checks.yml`, as long as it's narrowly scoped to what it actually checks
(for example, path-filtered to `**/*.md` and its own config file). For
[docs-governance](https://github.com/licorsy/docs-governance) specifically,
that file must be named exactly `.github/workflows/docs-governance.yml` — not
just any narrowly-scoped filename — because that literal string is what
`pr-checks.yml`'s guard checks for below; a differently-named docs-governance
workflow would go unrecognized and the shared step would keep running
alongside it. A different companion plugin would need its own guard, since
this specific filename check only knows about docs-governance. What to avoid
is a companion plugin
duplicating a check `pr-checks.yml` already runs broadly: the shared
`docs-governance` step in `pr-checks.yml` is guarded by all three of
`github.event_name == 'pull_request'`, `hashFiles('.docgov.config.js') != ''`,
and `hashFiles('.github/workflows/docs-governance.yml') == ''`, so it
self-disables the moment a repo adds that file — no manual toggling needed.
Keep all three clauses when copying this workflow: dropping the first means a
manual `workflow_dispatch` run passes an empty `base-sha` — only the
`version-bump` rule reads that value, and it abstains rather than fails
without one, so the other rules (frontmatter, internal-links,
changelog-retention) still run and can still fail; a dispatch run is a
*partial* check missing version-bump coverage, not a run doing nothing;
dropping the second runs the step in repos with no docs-governance config at
all; dropping the third is what would let the same check run twice on any PR
into `staging`/`main` that touches docs.

A companion's own workflow file should also match this repo's *branch*
scope, not just its path scope: `pull_request: branches: [staging, main]` plus
`workflow_dispatch: {}`, no `push:` trigger — the same reason `pr-checks.yml`
itself stays off `develop`/`push` (see "Remote validation layer" above).
docs-governance does ship a template for this (its own README's CI section)
with a placeholder `branches: [main]` and a comment pointing at exactly this
kind of taxonomy — but it has no code-level notion of `staging`/`main`, so
filling in that placeholder correctly is still a convention this repo's owner
(or `/git-check`) applies by hand, the same way path-narrowness already is.

**Local pre-commit hooks compose the same way, with one added catch:**
`${CLAUDE_PLUGIN_ROOT}` does not exist outside a Claude Code session, so a
companion plugin's own local hook (e.g. `docgov init --hook` installs
`.git/hooks/pre-commit` directly, calling `docgov` via a fixed path — a
vendored copy under `.github/`, or an absolute path to a sibling checkout)
cannot reference it. Running `pre-commit install` overwrites that hook file
wholesale. Before installing this plugin's `.pre-commit-config.yaml` hooks
into a repo that already has such a hook, add the companion's check as a
`repo: local` entry first (see the commented example already checked into a
target repo's `.pre-commit-config.yaml` if one exists), so the framework
extends the existing coverage instead of silently deleting it.

Each self-hosted plugin marketplace must use **its own plugin name** as its
marketplace name (`git-governance@git-governance`, `docs-governance@docs-governance`,
etc.) — never share a marketplace name across separate source repos. Claude
Code registers at most one marketplace per name, so two different plugins
claiming the same name means the second `marketplace add` silently replaces
the first.

## Documentation ownership

Each fact this plugin governs — the branch-prefix taxonomy, the permission
matrix, a command's step-by-step behavior, a script's contract, an
enforcement claim like the CI guard's clause count — has exactly **one**
authoritative file. Every other file links to it (`"see X"`) instead of
restating it in its own prose:

- Taxonomy and the permission matrix → owned by
  `agents/git-governance-advisor.md` only.
- A command's behavior → owned by that command's own file only.
- A script's contract → owned by that script's header comment only.

This repo uses `docs-governance` (see "Companion plugins" above) to catch
restatement drift mechanically where it can: `.docgov.config.js` declares
`facts` entries for the taxonomy list and the CI guard's clause count, and a
`fragment_sync` entry for the branch-flow diagram duplicated verbatim across
`CLAUDE.md` and `README.md`. If an audit — human, `docgov`, or an LLM
auditor — finds the same fact stated in 2+ files, the fix is to add or
extend one of those config entries, not just correct the wording in place:
correcting the wording alone leaves nothing keeping the next edit from
re-breaking it.

## Replicating this setup into another repository

1. `claude plugin marketplace add licorsy/git-governance` then
   `claude plugin install git-governance@git-governance` in the target repo.
2. Run `/git-check` — it reports what's missing and, with confirmation,
   scaffolds this file plus `.pre-commit-config.yaml` and
   `.github/workflows/pr-checks.yml` via `scripts/init-governance.sh`. It
   never overwrites an existing `CLAUDE.md` in the target repo.
3. If the target repo doesn't have `develop`/`staging` yet, create them before
   running the protection script below.
4. `pre-commit install && pre-commit install --hook-type commit-msg`.
5. Ask Claude Code to run
   `${CLAUDE_PLUGIN_ROOT}/scripts/setup-branch-protection.sh <owner>/<repo>`
   for you (`/git-check` already offers to, once confirmed) — don't paste
   that path into a bare terminal yourself: `scripts/` is never copied into
   the target repo (see step 2's file list), and `${CLAUDE_PLUGIN_ROOT}` only
   resolves inside a Claude Code session in the first place.
6. Review the scaffolded pre-commit hooks — they're stack-agnostic by design;
   add language-specific linters by hand per repo.

See <https://github.com/licorsy/git-governance#readme> for the full walkthrough
(this file's own `README.md` reference won't resolve once this file is
scaffolded into a repo that doesn't have this plugin's README) and
`agents/git-governance-advisor.md` for the branch taxonomy, permission
matrix, and validation vocabulary — that one resolves anywhere the plugin is
installed, since agents are registered by Claude Code, not read off disk.
