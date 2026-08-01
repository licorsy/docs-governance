# docs-governance

[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/licorsy/docs-governance/badge)](https://securityscorecards.dev/viewer/?uri=github.com/licorsy/docs-governance)

Mechanical documentation-consistency checks for Markdown repositories, plus the
two review subagents that handle only what a script structurally cannot.

Zero runtime dependencies. Node only.

## Why this exists

One repository accumulated **113 documentation-consistency findings across 11
audit rounds in 3 days** without converging, with roughly **a quarter of each
round's findings originating in the previous round's fixes**.

The diagnosis was not "not enough auditing". It was:

- The same fact lived in many files and was propagated by hand.
- The mechanical checks that existed covered only *form* — links resolve,
  frontmatter present, changelog trimmed — while the expensive findings were
  about *content*: declared counts, cited versions, arithmetic.
- Everything else was audited by a language model: slow, costly, and
  non-deterministic on exactly the class of defect a five-line function settles
  in milliseconds.
- And the checks themselves had been copied between repositories, where they
  promptly diverged. **The remedy for duplication had been distributed by
  duplication.**

So: one engine, many repositories, parameterised by data. The model stays for
judgement, and only for judgement.

## The cost ladder

Each layer is more expensive than the last and only receives what the previous
one cannot settle. **Layers 1–3 cost no tokens at all.**

| Layer | What | Cost |
|---|---|---|
| 1 | `docgov check --changed` in `pre-commit` | ~50 ms — catches drift before it exists |
| 2 | `docgov check` in CI | ~2 s, whole repository |
| 3 | `ctxlint` context-file hygiene scan | zero tokens — token/staleness analysis on context files |
| 4 | `doc-consistency-auditor` subagent | tokens — contradiction, ambiguity, description-vs-norm |
| 5 | `fix-verifier` subagent | tokens — regressions the fixes themselves introduced |

The ratchet that makes this cheaper over time: **any finding from layer 4 that
turns out to be mechanically detectable becomes a rule in layer 1.** Moved down,
that defect class never costs a token again.

This is the canonical numbering — `/docgov-audit` (the command that drives an
audit session) names its own steps against these same layer numbers, starting
at 2 since layer 1 is a `pre-commit` hook and not part of a manual session.

## Install

### As a CI check

A minimal workflow wrapping this action:

```yaml
name: Docs governance

on:
  pull_request:
    branches: [main]        # restrict to your repo's promotion branch(es) —
                             # e.g. [staging, main] under a taxonomy like git-governance's
    paths:
      - "**/*.md"
      - ".docgov.config.js"
      - ".github/workflows/docs-governance.yml"
  workflow_dispatch: {}

jobs:
  docgov:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }        # the version-bump rule needs history
      - uses: licorsy/docs-governance/action@v1
        with:
          base-sha: ${{ github.event.pull_request.base.sha }}
```

Scope `pull_request.branches` to wherever this repo already does remote CI —
usually its promotion point(s), not every branch. This action checks the
*whole* repository, not just changed files (pair it with `docgov check
--changed` in `pre-commit` for the changed-files-only, zero-token layer — see
"The cost ladder" above), so there's rarely a reason to also run it on every
`push`: a `pull_request` at the branches that matter is normally enough, and
it avoids firing on every merge into a fast-moving, frequently-merged branch.

If you do add a `push:` trigger anyway, leave `base-sha` empty on it — the
version-bump rule abstains rather than failing when there is no base to
compare against.

### As a Claude Code plugin

```
/plugin marketplace add licorsy/docs-governance
/plugin install docs-governance@docs-governance
```

Ships the `/docgov-audit` command and its two subagents: `doc-consistency-auditor`
is read-only by tool grant, `fix-verifier` holds `Bash` for read-only inspection
and non-mutating verification (e.g. running the existing test suite) and is
read-only by instruction — never to write files, install anything, or change
repository state.

### In a repository

```bash
node path/to/docs-governance/bin/docgov.js init --hook
```

`init` **discovers** rather than asks: it walks the Markdown tree, infers scope
from where frontmatter is actually used, detects which changelog marker the
repository uses, and proposes frozen-history directories from git history. It
writes a commented `.docgov.config.js` you then edit. No tokens involved — it is
`fs` and `git log`.

## Rules

| id | Checks |
|---|---|
| `frontmatter` | Required fields, `status`/`doc_type` enums, date format, and **cross-file `related:` id resolution** — an id only resolves if some other document declares it |
| `internal-links` | Every relative Markdown link resolves. Fenced code blocks are stripped first (nested fences included), so example placeholders are not flagged |
| `changelog-retention` | At most N entries in a document's body changelog; full history lives in git |
| `version-bump` | A modified versioned document must bump `version:`, monotonically. Additions, renames, and deletions are out of scope |
| `declared_counts` *(shadow)* | A prose count ("N files") matches a real directory listing, not another string |
| `sum_decomposition` *(shadow)* | A declared sum ("20 + 13 + 2 + 2 = 37") is recomputed, not string-compared |
| `facts` *(shadow)* | An atomic fact ("5 scheduled routines") is present where it's supposed to be (`required_in`), and its stale form doesn't survive outside exempt context (`forbidden`) |
| `version_citations` *(shadow)* | A citation like `` `path.md` v1.9 `` is checked against that file's real `version:` frontmatter |
| `sync_destinations` | A self-contained "destination" document (e.g. a duplicated paste target) declares `covers: { id: "X.Y" }` in its own frontmatter; checked against the source's real version — see `docgov sync-status` |

**Shadow rules** (`shadow: true` by default in `lib/config.js` — `docgov init`
doesn't write the field explicitly, so don't expect to find it in a generated
config) never fail `check`/CI and never run under `--changed` (pre-commit) —
findings print prefixed `[shadow]`. They start here because they are heuristic
(regex over prose) and the dominant measured risk in this engine is false
positives training people to reach for `--no-verify`. Promote a shadow rule to
blocking only by setting `shadow: false` in your config, and only after
measuring precision on a real corpus — see `lib/exempt.js` for the
historical/self-qualifying/fenced-code exemption predicate every content rule
runs through first, except
`facts.required_in`, deliberately — see `lib/rules/facts.js` for why asking
"does this file state X anywhere?" doesn't carry the same false-positive risk
that the predicate exists to guard against.

## Configuration

`.docgov.config.js` is CommonJS, not JSON — so it can hold real regex literals,
comments, and composed lists.

**The config declares data. It never declares logic.** If two repositories need
the same new construct, that construct goes into `lib/`, not into both configs.
This is the rule that keeps the engine from being forked by configuration, which
is precisely how the original problem started.

Each rule accepts a `why` field, printed when it fails. Fill it with the *real*
defect that motivated the rule. A rule with no real defect behind it should not
exist — and a rule that has not caught a true positive in weeks should be
deleted, not kept "just in case". A dead rule costs attention every time
someone reads the output.

Scope is per rule, not global. That is deliberate: link checking wants the whole
tree pruned by directory name at any depth, while frontmatter validation wants
an explicit list of directories. Collapsing them into one scope would have
broken parity with the checks this engine replaced.

## Development

```bash
node --test
```

No path argument — Node's own default test discovery already finds every
`*.test.js` file under `test/`. This is the form CI actually enforces (see the
`node-version` matrix in `.github/workflows/tests.yml`) rather than a claim
made only in prose. Two forms that look equivalent aren't, on Node 20 (still
widely deployed): a literal `test/*.test.js` glob only resolves if the shell
expands it first (bash does; the test runner itself gained native glob support
for file arguments in Node 22), and pointing `--test` at the bare directory
name (`node --test test`) is treated as a single module argument on Node 24
and fails, even though it happens to work on Node 20. `node --test` with no
argument sidesteps both.

## Non-goals

- **Not a Markdown style linter.** `markdownlint` does that, and formatting was
  not the problem.
- **Not a prose linter.** `Vale` does that. The problem here is *fact*, not voice
   — and Vale's exception model cannot express "except inside a changelog block,
  except in frozen-history directories, except on self-qualifying lines", which
  is most of the requirement.
- **Not a code-to-docs drift detector.** `fiberplane/drift` aims at that. This
  aims at document-to-document consistency.
- **Not an external link checker.** `lychee` does that well; external rot was
  not among the observed defects.

## License

MIT.
