---
title: "AGENTS.md"
doc_type: instruction
description: "Git branch, commit, and merge policy in force for this repository, scaffolded from the git-governance plugin: the branch flow and prefix taxonomy, Conventional Commits, the autonomous-to-develop and human-gated-to-staging/main permission model (including the /promote-window exception), per-branch merge methods and branch lifecycle, the local and remote validation layers, and how companion plugins compose with it."
status: active
version: "2.4.0"
created: 2026-08-01
updated: 2026-08-07
language: en
id: agents-instructions
owner: Alexandre Clemente
tags: [git, branching, commits, merge-policy, agents]
---

# AGENTS.md

**This file is the source of truth for agent instructions in this repository.**
`CLAUDE.md` imports it with `@AGENTS.md` and states nothing of its own, so every
coding agent reads the same policy Claude Code does.

Portable Git branch/merge/commit governance for a solo maintainer working with
Claude Code, scaffolded here from the `git-governance` plugin. Do not add
project-specific detail that wouldn't make sense verbatim in another repo — the
plugin's copy is the source, and this one is expected to stay a faithful
scaffold of it.

The frontmatter block above is the one exception, because it describes *this*
repository. A scaffolded copy resets `created`, `updated`, and `owner` to the
target's own values, and changes `title`/`description` to say the policy was
scaffolded from this plugin rather than naming the plugin as the subject.
`doc_type`, `status`, `version`, `language`, `id`, and `tags` carry over
unchanged.

## Branch flow

```text
feat/* (also fix/, refactor/, docs/, chore/, hotfix/)  ->  develop  ->  staging  ->  main
```

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
  `develop` are each protected server-side by their own ruleset (see
  `scripts/setup-branch-protection.sh`) — direct push is blocked on all
  three, not just `staging`/`main`. What distinguishes `develop` isn't a
  lighter server-side gate, it's the permission model below.
- **Every merge goes through a pull request, including into `develop`.** The
  ruleset requires one, at 0 required approvals — a solo maintainer cannot
  approve their own PR, so any non-zero count would deadlock the branch. Zero
  is a deliberate choice, not a missing setting.
- Merging into `develop` is autonomous: Claude Code opens the PR and merges
  it once `pre-commit` and commit-message checks pass. No pause is needed —
  what makes `develop` safe to automate is that errors there are cheap to
  revert, not a lighter review requirement.
- Opening a promotion PR into `staging` or `main` needs no confirmation.
  **Merging one always requires explicit human confirmation**, given after the
  PR exists — even when the request comes from the repo owner using their own
  credentials, and even in the same breath as the request to open it.
  `/prepare-merge-staging` and `/prepare-release-main` open a PR per hop and
  never merge either one, confirmation or not. `/promote-window` is the one
  exception, asked for **by name**: it covers a whole
  `develop -> staging -> main` window and merges within that authorization,
  each hop only on green required checks. See the permission model in
  `agents/git-governance-advisor.md`.

### Merge methods

Merge commits are the default; squash is a narrow exception and rebase-merge is
off entirely. Enforced by ruleset, per branch:

| Target | Allowed merge methods |
| --- | --- |
| `develop` | merge commit, squash |
| `staging`, `main` | merge commit only |

Promotions must never be squashed. Squashing `develop -> staging` rewrites the
promoted commits into a new one, so `staging` stops sharing history with
`develop` and the *next* promotion re-conflicts on work already merged. Squash
stays available into `develop` for work branches whose intermediate commits
carry no value. Rebase-merge is disabled at the repository level: it offers
nothing this model needs and rewrites committer metadata on the way in.

### Branch lifecycle

`delete_branch_on_merge` is on, so work branches are removed from the remote
automatically when their PR merges. The protected branches survive it: GitHub
exempts protected branches from auto-delete, and each ruleset's `deletion` rule
blocks it independently. That is what keeps `develop` — the head branch of every
`develop -> staging` promotion — from being deleted when a promotion merges.

## Local validation layer (primary)

`pre-commit` is the main gate, not GitHub Actions. Install once per clone:

```bash
pre-commit install
pre-commit install --hook-type commit-msg
```

Both commands are required — the first wires up the file-content hooks
(whitespace, EOF, YAML/JSON, merge-conflict markers), the second wires up the
Conventional Commits check, which runs at a different git hook stage.

The `docgov check --changed` hook that would make this repo dogfood its own
layer-1 rule locally is present in `.pre-commit-config.yaml` but commented out
(see that file for why). Until it's enabled here, this repository's own drift
is caught remotely, on `staging`/`main` promotion PRs, rather than locally —
the opposite of "pre-commit is the main gate" for this one rule specifically.

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

Four independent jobs run there: file-content hooks, documentation consistency,
the promotion-source guard, and security. They are **separate jobs on purpose**
— steps stop at the first failure, so a check bundled as a trailing step can be
silently skipped by an unrelated failure ahead of it. That happened: a
commit-message failure suppressed the documentation check entirely on a real
promotion, which looked merely "red on commit messages."

The **promotion-source guard** is what makes the branch flow enforceable rather
than conventional. Rulesets require a pull request but constrain nothing about
where it comes *from*, so a work branch could target `staging` or `main`
directly. The guard rejects any pull request into `staging` not from `develop`,
and into `main` not from `staging`. `hotfix/` is not an exception — see the
taxonomy in `agents/git-governance-advisor.md`.

There is deliberately **no remote Conventional Commits lint**. On a promotion
pull request every commit in range is already merged into `develop`, so such a
check can only report history that cannot be corrected without rewriting a
protected branch. The `commit-msg` hook gates every commit as it is written,
which is earlier, cheaper, and actually preventive.

## Companion plugins

`git-governance` owns branch taxonomy, commit format, and merge permissions
for a repo. It does **not** need to own every workflow trigger — a companion
plugin may bring its own workflow instead of using the shared job in
`pr-checks.yml`, as long as it's narrowly scoped to what it actually checks
(for example, path-filtered to `**/*.md` and its own config file). For
[docs-governance](https://github.com/licorsy/docs-governance) specifically,
that file must be named exactly `.github/workflows/docs-governance.yml` — not
just any narrowly-scoped filename — because that literal string is what
`pr-checks.yml`'s guard checks for below; a differently-named docs-governance
workflow would go unrecognized and the shared job would keep running
alongside it. A different companion plugin would need its own guard, since
this specific filename check only knows about docs-governance. What to avoid
is a companion plugin
duplicating a check `pr-checks.yml` already runs broadly: the shared
`docs-governance` job in `pr-checks.yml` is guarded by all three of
`github.event_name == 'pull_request'`, `hashFiles('.docgov.config.js') != ''`,
and `hashFiles('.github/workflows/docs-governance.yml') == ''`, so it
self-disables the moment a repo adds that file — no manual toggling needed.
It runs as its own **job**, not a step inside `pre-commit`: steps stop at the
first failure, so as a trailing step this check was hostage to the
commit-message lint, and one non-conforming subject made the documentation check
silently not run at all. Reordering only reverses which check is hostage;
separate jobs make them independent both ways. The guard itself stays at step
level, because `hashFiles()` is not recognized in a job-level `if:`.
Keep all three clauses when copying this workflow: dropping the first means a
manual `workflow_dispatch` run passes an empty `base-sha` — only the
`version-bump` rule reads that value, and it abstains rather than fails
without one, so the other rules (frontmatter, internal-links,
changelog-retention) still run and can still fail; a dispatch run is a
*partial* check missing version-bump coverage, not a run doing nothing;
dropping the second runs the check in repos with no docs-governance config at
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
authoritative file. Every other file either links to it (`"see X"`) or
restates it only where a pinned `facts` entry keeps the copies identical:

- Taxonomy and the permission matrix → owned by
  `agents/git-governance-advisor.md` only.
- A command's behavior → owned by that command's own file only.
- A script's contract → owned by that script's header comment only.

**This repository's own `.docgov.config.js` declares one `facts` entry**, not
the three `git-governance` pins: `docs-governance-guard-clauses`, for the CI
guard's clause count — the fact that drifted here once already, when this
repository's own `pr-checks.yml` guard was down to one clause while `CLAUDE.md`
still asserted three (this repo is the engine dogfooding its own rule, which
is precisely how that drift was caught). There is no `fragment_sync` entry and
no branch-prefix-taxonomy `facts` entry here: this repository doesn't
duplicate the branch-flow diagram or the taxonomy list across a source and a
destination file the way `git-governance` does between its `AGENTS.md` and
`README.md`, so there is nothing for those two pins to guard yet. If that
changes, add the entry then — don't restate a fact in a second file without a
pin to keep the copies honest.

## Replicating this setup into another repository

1. `claude plugin marketplace add licorsy/git-governance` then
   `claude plugin install git-governance@git-governance` in the target repo.
2. Run `/git-check` — it reports what's missing and, with confirmation,
   scaffolds this file plus `CLAUDE.md`, `.pre-commit-config.yaml`,
   `.github/workflows/pr-checks.yml`, and `.claude/settings.json` via
   `scripts/init-governance.sh`. It never overwrites a file that already
   exists in the target repo — which matters most for `.claude/settings.json`,
   since a repository that already declares its own `enabledPlugins` keeps
   them.
3. If the target repo doesn't have `develop`/`staging` yet, create them before
   running the protection script below.
4. `pre-commit install && pre-commit install --hook-type commit-msg`.
5. Ask Claude Code to run
   `${CLAUDE_PLUGIN_ROOT}/scripts/setup-branch-protection.sh <owner>/<repo>`
   for you (`/git-check` already offers to, once confirmed) — don't paste
   that path into a bare terminal yourself: `scripts/` is never copied into
   the target repo (see step 2's file list), and `${CLAUDE_PLUGIN_ROOT}` only
   resolves inside a Claude Code session in the first place. This is also what
   applies the merge-method and branch-lifecycle settings above.
6. Review the scaffolded pre-commit hooks — they're stack-agnostic by design;
   add language-specific linters by hand per repo.

See <https://github.com/licorsy/git-governance#readme> for the full walkthrough
(this file's own `README.md` reference won't resolve once this file is
scaffolded into a repo that doesn't have this plugin's README) and
`agents/git-governance-advisor.md` for the branch taxonomy, permission
matrix, and validation vocabulary — that one resolves anywhere the plugin is
installed, since agents are registered by Claude Code, not read off disk.
