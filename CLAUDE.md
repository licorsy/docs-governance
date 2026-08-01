# git-governance

Portable Git branch/merge/commit governance for a solo maintainer working with
Claude Code. This file is both the policy for *this* repository and the
literal file scaffolded into any repository this plugin is installed into
(`scripts/init-governance.sh` copies it as-is — see "Replicating this setup"
below). Do not add project-specific detail here that wouldn't make sense
verbatim in another repo.

## Branch flow

```text
feature/* (also fix/, docs/, chore/, hotfix/)  ->  develop  ->  staging  ->  main
```

- Work branches are created from an up-to-date `develop`.
- `develop -> staging` and `staging -> main` are promotions, never a starting point
  for new work.
- Naming: `<prefix>/<id>-<short-description>`, prefixes `feat`, `fix`,
  `docs`, `chore`, `hotfix`. Full taxonomy and the permission matrix live in
  `agents/git-governance-advisor.md`.

## Commit policy

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`,
  types `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `perf`, `build`, `ci`.
  Use a `BREAKING CHANGE:` footer for breaking changes.
- Small, frequent commits over large batched ones.
- `pre-commit` must run and pass **before every commit**, not just before a
  merge — see "Local validation layer" below.

## Merge policy

- **Never push directly to a protected branch.** `staging` and `main` are
  protected server-side (see `scripts/setup-branch-protection.sh`); `develop`
  is treated as *logically* protected too — direct push is technically
  possible but should be avoided in favor of a PR even inside the autonomous
  zone, since the git host can't tell an agent's push from a human's.
- Merging into `develop` is autonomous: Claude Code opens the PR and merges
  it once `pre-commit` and commit-message checks pass. No pause is needed —
  `develop` has no required reviewers and errors there are cheap to revert.
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
plugin (e.g. [docs-governance](https://github.com/licorsy/docs-governance),
which checks Markdown consistency) may bring its own `.github/workflows/*.yml`
if it's narrowly scoped to what it actually checks (for example, path-filtered
to `**/*.md` and its own config file). What to avoid is a companion plugin
duplicating a check `pr-checks.yml` already runs broadly: if a repo already
has its own path-filtered `docs-governance.yml`, don't also enable the
optional `docs-governance` step in `pr-checks.yml` (guarded by
`hashFiles('.docgov.config.js')`) — that would run the same check twice on
any PR into `staging`/`main` that touches docs. Enable that step only in repos
where docs-governance has no separate workflow of its own.

A companion's own workflow file should also match this repo's *branch*
scope, not just its path scope: `pull_request: branches: [staging, main]` plus
`workflow_dispatch: {}`, no `push:` trigger — the same reason `pr-checks.yml`
itself stays off `develop`/`push` (see "Remote validation layer" above).
This is not enforced by any code link between the two plugins —
docs-governance ships no template and has no notion of `staging`/`main`; it's a
convention this repo's owner (or `/git-check`) applies by hand to whatever
workflow file a companion brings, exactly the way path-narrowness already is.

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
5. `./scripts/setup-branch-protection.sh <owner>/<repo>`.
6. Review the scaffolded pre-commit hooks — they're stack-agnostic by design;
   add language-specific linters by hand per repo.

See `README.md` for the full walkthrough and `agents/git-governance-advisor.md`
for the branch taxonomy, permission matrix, and validation vocabulary.
