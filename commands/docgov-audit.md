---
description: Audit this repository's documents for consistency, cheapest layer first — deterministic checks before any model work.
argument-hint: "[scope or focus, optional]"
---

Audit this repository for documentation drift. **Work in order of cost. Do not skip ahead.**

The whole point of this command is that model time is the expensive layer. Most
drift is countable — a wrong total, a stale version citation, a broken link —
and a script settles it in milliseconds, identically every time. Spending a
model on that is waste, and it is also *worse*: the script never gets tired on
the tenth round.

## Layer 1 — deterministic, zero tokens

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/docgov.js" check
```

Quote the aspas — plugin paths routinely contain spaces.

- **Findings?** Fix them first, then re-run until clean. Do not proceed to
  layer 2 with known mechanical findings outstanding: they generate noise that
  makes the semantic pass harder to read.
- **No config?** Run `node "${CLAUDE_PLUGIN_ROOT}/bin/docgov.js" init` and
  review what it generated before committing it.

## Layer 2 — context-file hygiene, zero tokens

```bash
npx -y @yawlabs/ctxlint@latest
```

**Read its token analysis; be sceptical of its path errors.** Its path
heuristic treats anything with a slash or hyphen as a file path, so in a
non-English corpus it flags dates (`14/07/2026`), range notation
(`docs/prompts/006-008`), rule references and section names. Measured on one
real repository: 12 of 12 errors were false positives. The token and staleness
figures, however, are correct and are often the highest-value output here.

## Layer 3 — semantic audit, costs tokens

Only now, and only for what layers 1–2 structurally cannot see: contradiction
requiring judgement, ambiguity, *description vs. norm*, *artefact vs. generator*.

Launch the `doc-consistency-auditor` subagent. If the user named a scope in the
arguments, pass it through; otherwise ask for the full corpus scan.

## Layer 4 — after you fix anything

Launch the `fix-verifier` subagent with the list of what you changed. Its
working premise is that fixes introduce defects — measured at roughly a quarter
of each round's findings originating in the previous round's fixes. Skipping
this step is how an audit loop fails to converge.

## The rule that makes this get cheaper over time

**Every finding from layer 3 that turns out to be mechanically detectable must
become a rule in layer 1.** Report it to the user as such and propose the
config entry. A defect class that stays in the model layer costs tokens forever;
moved down, it costs nothing again, permanently.

Never edit documents from inside layers 3–4 — both subagents are read-only by
construction. You, the invoking session, apply the fixes.
