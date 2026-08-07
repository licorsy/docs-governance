---
description: Audit this repository's documents for consistency, cheapest layer first — deterministic checks before any model work.
argument-hint: "[--full | scope or focus, optional]"
---

Audit this repository for documentation drift. **Work in order of cost. Do not skip ahead.**

The whole point of this command is that model time is the expensive layer. Most
drift is countable — a wrong total, a stale version citation, a broken link —
and a script settles it in milliseconds, identically every time. Spending a
model on that is waste, and it is also *worse*: the script never gets tired on
the tenth round.

This command's steps are numbered against the engine's canonical cost ladder
(see the main README's "The cost ladder"), starting at layer 2 — layer 1 is
the `pre-commit` hook and isn't part of a manual audit session.

## Layer 2 — deterministic, zero tokens

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/docgov.js" check
```

Keep the quotes — plugin paths routinely contain spaces.

- **Findings?** Fix them first, then re-run until clean. Do not proceed to
  layer 4 (the semantic pass) with known mechanical findings outstanding: they
  generate noise that makes that pass harder to read.
- **No config?** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/docgov.js" init` and
  review what it generated before committing it.

## Layer 3 — context-file hygiene, zero tokens

```bash
npx -y @yawlabs/ctxlint@latest
```

**Read its token analysis; be sceptical of its path errors.** Its path
heuristic treats anything with a slash or hyphen as a file path, so in a
non-English corpus it flags dates (`14/07/2026`), range notation
(`docs/prompts/006-008`), rule references and section names. Measured on one
real repository: 12 of 12 errors were false positives. The token and staleness
figures, however, are correct and are often the highest-value output here.

## Layer 4 — semantic audit, costs tokens

Only now, and only for what layers 2–3 structurally cannot see: contradiction
requiring judgement, ambiguity, *description vs. norm*, *artefact vs. generator*.

**Default: incremental.** Run
`node "${CLAUDE_PLUGIN_ROOT}/bin/docgov.js" changed-scope --base-sha develop`
(swap in whatever the repository's integration branch actually is, if not
`develop`) and pass its JSON output to the `doc-consistency-auditor` subagent
as its explicit scope — the files changed since this branch forked, plus
whoever directly references one of them. This is the day-to-day path: most
work touches a narrow slice of the corpus, and re-reading everything on every
audit is exactly the cost this layer exists to avoid paying twice.

**`--full` (or the user names a scope in the arguments): full corpus scan.**
Skip `changed-scope` and launch the `doc-consistency-auditor` subagent with no
explicit list — its own Step 1 then globs the whole corpus, same as before
this incremental mode existed. Reserve this for before a `staging`/`main`
promotion, or a periodic manual pass — the safety net that catches drift
between documents neither side directly cites, which the one-hop incremental
scope structurally can't reach. If the user named a scope in the arguments
instead, pass that through unchanged and skip `changed-scope` too — an
explicit user-named scope always wins over the default.

## Layer 5 — after you fix anything

Launch the `fix-verifier` subagent with the list of what you changed. Its
working premise is that fixes introduce defects — measured at roughly a quarter
of each round's findings originating in the previous round's fixes. Skipping
this step is how an audit loop fails to converge.

## The rule that makes this get cheaper over time

**Every finding from layer 4 that turns out to be mechanically detectable must
become a rule.** Report it to the user as such and propose the config entry.
A defect class that stays in the model layer costs tokens forever; moved to a
rule, most rule types still need `shadow: false` set explicitly before they
stop costing tokens — see "The ratchet" in the main README. `fragment_sync`,
`dead_citations`, and `numbered_reference_consistency` are three such
promotions already in the engine (`fragment_sync` isn't shadow-gated at all;
the other two default to shadow like most content rules) — check whether a
new finding fits one of them before proposing a new rule.

Never edit documents from inside layers 4–5 — the auditor is read-only by tool
grant (`Read, Grep, Glob` only); the verifier is read-only by instruction and
holds `Bash` only for read-only inspection and non-mutating verification (e.g.
running the existing test suite to check a fixed claim), never to write files,
install anything, or change repository state. You, the invoking session, apply
the fixes.
