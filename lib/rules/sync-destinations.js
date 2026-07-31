'use strict';

// A "destination" document (e.g. a claude.ai Project paste, self-contained by
// design, loading no file on its own) declares in its own frontmatter what it
// claims to cover: `covers: { agent: "2.36", agent-identity: "1.6" }`. This
// rule resolves each id against the source's real `version:` (`lib/corpus.js`)
// and checks whether the destination is actually in sync — replacing prose
// judgement ("do the 3 Projects look in sync?") with a string comparison.
//
// Born from cause C1+C7 of the `docgov` diagnosis
// (`personal-os/local-notes/030`) and that repository's ADR-0011: the pair
// that actually duplicates (~38 KB) had no mechanism at all — day-level
// granularity didn't distinguish "re-pasted" from "changed hours later", and
// produced a real false "✅ in sync".
//
// Not shadow mode: it's a string comparison, not a heuristic — the
// false-positive risk that justifies shadow mode in the Phase 2 rules doesn't
// exist here. With no `covers:` declared in any file, the rule finds nothing
// (missing data, not an error).

const fs = require('fs');
const { parseFrontmatter, parseCovers } = require('../frontmatter');
const { buildIdIndex } = require('../corpus');

function checkTarget(file, idIndex) {
  if (!fs.existsSync(file)) return [{ id: null, ok: false, message: `${file}: target does not exist` }];

  const fields = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const covers = parseCovers(fields);
  const ids = Object.keys(covers);

  if (ids.length === 0) return [];

  return ids.map((id) => {
    const source = idIndex.get(id);
    if (!source) {
      return { id, ok: false, message: `${file}: covers unknown id "${id}" (no document in scope declares it)` };
    }
    if (source.version === null) {
      return { id, ok: false, message: `${file}: covers "${id}" (${source.file}), which has no version: field` };
    }
    if (source.version !== covers[id]) {
      return {
        id,
        ok: false,
        message: `${file}: declares covers.${id} = "${covers[id]}", but ${source.file} is at "${source.version}"`,
      };
    }
    return { id, ok: true, message: `${file}: covers.${id} matches ${source.file} v${source.version}` };
  });
}

function run(cfg) {
  const targets = cfg.targets || [];
  const idIndex = buildIdIndex(cfg);

  const results = targets.flatMap((file) => checkTarget(file, idIndex));
  const findings = results.filter((r) => !r.ok);

  return {
    findings: findings.map((f) => ({ file: '', messages: [f.message] })),
    inlineMessages: true,
    failSummary: (n) => `${n} sync destination(s) out of sync.`,
    okSummary: `All configured sync destinations (${targets.length} target file(s)) are in sync.`,
    // used by `docgov sync-status`, which wants the full detail (including
    // what's OK), not just what failed
    all: results,
  };
}

module.exports = { id: 'sync_destinations', run, checkTarget };
