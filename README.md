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

This is the canonical numbering — `/docgov-audit` (the command that drives an
audit session) names its own steps against these same layer numbers, starting
at 2 since layer 1 is a `pre-commit` hook and not part of a manual session.

### The ratchet

The ratchet that makes this cheaper over time: **any finding from layer 4 that
turns out to be mechanically detectable becomes a rule.** For rule types that
default to shadow mode — `declared_counts`, `sum_decomposition`, `facts`,
`version_citations`, `dead_citations`, `numbered_reference_consistency` (see
the note under the Rules table below) — that rule reports only, and never
fails `check`/CI or runs under `--changed`, until a config explicitly sets
`shadow: false` on it. `fragment_sync` is not a shadow-gated rule type at all:
once a repository configures it, the check blocks immediately.
`git-governance`'s own `AGENTS.md`/`README.md` pairing is the worked, blocking
example (see "Adopting the new rules" below) — this engine's own docs don't
configure `fragment_sync`, `dead_citations`, or `numbered_reference_consistency`
at all yet, only `facts`, already `shadow: false` (see `.docgov.config.js`).

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
| `fragment_sync` | A canonical block, delimited by `<!-- fragment:id:start/end -->` markers in a source file, must exact-byte-match the same-id block in one or more destination files; an optional `anchor` also asserts that the heading the block restates still exists |
| `dead_citations` *(shadow)* | An inline-code citation (`` `prompt-042` ``, `` `012-slug.md` ``) resolves to a real file — fills the gap `internal-links` leaves for citations that aren't real Markdown link syntax. Optional `exempt.target_allowlist` (exact strings or `RegExp`) exempts specific citation *targets*, checked per match rather than per line |
| `numbered_reference_consistency` *(shadow)* | A `layer N`/`step N` style citation resolves to a number in a config-declared canonical sequence |

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

## Adopting the new rules

Three rules exist specifically to replace a class of LLM-auditor finding
with a mechanical one (see "The ratchet" above). Each is inert until a
repository declares what to check.

**`fragment_sync`** — for prose duplicated verbatim across files with
nothing keeping the copies in sync. Worked example, already shipped in
`licorsy/git-governance`: its `AGENTS.md` and `README.md` both contain the
byte-identical line `feat/* (also fix/, refactor/, docs/, chore/, hotfix/)  ->  develop  ->  staging  ->  main`.
The line is wrapped in `<!-- fragment:branch-flow:start/end -->` markers in
both files (source `AGENTS.md`, destination `README.md`), and that repo's
`.docgov.config.js` configures:

```js
fragment_sync: {
  fragments: [
    { id: 'branch-flow', source: 'AGENTS.md', destinations: ['README.md'] },
  ],
},
```

which turns any future silent drift between those two files into a `docgov
check` failure instead of another LLM-audit finding. In that real repository
the line sits inside a fenced (` ```text `) diagram, so the markers wrap the
fence itself rather than sit inside it — an HTML comment placed inside a
fenced code block renders as literal text, not a comment, and
`markedBlockLines` doesn't care either way as long as the markers themselves
are outside the fence.

`fragment_sync` findings are attributed to the destination file, not the
source, so editing only the source and forgetting to update a destination
is caught by a full `docgov check` (CI, layer 2) but **not** by `docgov
check --changed` (pre-commit, layer 1) unless that destination is also
staged in the same commit — worth knowing before relying on pre-commit
alone to catch fragment drift.

A fragment may also declare an optional **`anchor`**, when the synced block is a
*restatement* of a rule whose full text lives elsewhere under a specific
heading:

```js
fragment_sync: {
  fragments: [
    {
      id: 'always-on-rule',
      source: 'AGENTS.md',
      destinations: ['CLAUDE.md'],
      anchor: { file: 'docs/manuals/operation-manual.md', text: '## Step 10' },
    },
  ],
},
```

Byte-matching the copies against each other says nothing about whether the thing
they quote still exists: renumber `## Step 10` in the manual and every copy stays
perfectly in sync while all of them now cite a heading that is gone. The anchor
is checked independently of the destination comparison, so a fragment that is
both diverged *and* citing a dead heading reports two findings rather than
hiding one behind the other.

The anchor is declared in config rather than parsed out of the marker comment,
because this config declares data — reading `source=`/`anchor=` attributes off
the markers would put a second, undocumented schema in the markup and make the
engine parse it.

**`numbered_reference_consistency`** — for a canonical ordered sequence
("Layer N") cited by number in prose. This repository's own README cost
ladder above and `commands/docgov-audit.md`'s `## Layer 2`–`## Layer 5`
headings are exactly the corpus that had to be hand-renumbered when
`ctxlint` was inserted as a new layer. Configuring:

```js
numbered_reference_consistency: {
  root_files: ['README.md', 'commands/docgov-audit.md'],
  sequences: [{ id: 'layer', word: 'layer', valid: [1, 2, 3, 4, 5] }],
},
```

would not have caught that exact historical bug (both the old and new
layer numbers stayed in-range throughout the rename), but it does catch
the more common failure mode of the same class of edit — one file's
citation getting bumped one number ahead of the other's, before the
canonical `valid` list itself is updated. For the stronger guarantee (the same
conceptual step must carry the same number in every file), the existing
`facts` rule's `required_in` can already pin an exact heading string to an
exact file — no new rule needed for that case.

**`dead_citations`** — for inline-code citations (`` `prompt-042` ``,
`` `012-slug.md` ``) that `internal-links` can't see because they aren't
real Markdown link syntax. Unlike the `fragment_sync` and
`numbered_reference_consistency` examples above, this one is syntax-illustrative
only: it demonstrates the two supported pattern kinds (`filename`,
`prefix-id`), not a verified finding against a specific repository's real
citation convention.

```js
dead_citations: {
  scope_dirs: ['docs'],
  patterns: [
    { id: 'md-files', kind: 'filename' },
    { id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 },
  ],
},
```

What this buys you: a mechanical resolve/no-resolve check in place of a
manual per-round LLM sweep for dangling inline-code references.

Some citations are dead by design and always will be — a generated project's
own future paths, a third-party tool's own output filenames, or this
repository's own renamed/historical paths kept only as citations. Flagging
those every run trains people to ignore `dead_citations` output entirely.
`exempt.target_allowlist` exempts those, by citation *target* rather than by
line:

```js
dead_citations: {
  scope_dirs: ['docs'],
  patterns: [
    { id: 'md-files', kind: 'filename' },
    { id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 },
  ],
  exempt: {
    target_allowlist: ['scaffold/future-module.md', /^prompt-9\d\d$/],
  },
},
```

This is a third exemption granularity alongside the file-level
(`historical_paths`) and line-level (`fenced_code`, `self_qualifying`, …)
predicates every content rule shares via `lib/exempt.js` — and it is
deliberately `dead_citations`-specific, not a fourth general predicate, because
only this rule resolves an external citation target in the first place. The
distinction matters on a line that carries two unrelated citations, one that
should stay exempt and one that should not — for example a line citing both
`` `scaffold/future-module.md` `` (allowlisted) and `` `docs/missing.md` ``
(not). With `target_allowlist` as above, that line still reports the second
citation, because the check runs per match against the cited target, not per
line. A line-level exemption could not make that distinction — allowlisting
the line would silently mask the unrelated dead citation sharing it.

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
