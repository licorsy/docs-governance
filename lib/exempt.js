'use strict';

// "Historical record ≠ current claim" predicate — applied BEFORE any content
// rule (declared_counts, sum_decomposition, facts, version_citations), except
// `facts.required_in`, deliberately — see `lib/rules/facts.js`.
// Without it, every content rule rediscovers the same dominant false positive
// measured twice before this engine existed: 6 false positives out of 7
// findings in the first version of note 029's adversarial checker, and 12
// false positives out of 12 errors from `ctxlint` on a Portuguese-language
// corpus. An old changelog entry citing "35 files" is not a claim that the
// corpus has 35 files today — it's a record of what was true at the time
// (personal-os ADR-0009: old entries are never rewritten). A line inside a
// fenced code block is an example, not a claim. Exemption is always per LINE
// (or per whole file, for `historical_paths`), never for the entire
// document — a file can have a frozen changelog and a live body in the same
// breath.
//
// `personal-os` and its ADRs/notes are the private upstream repository this
// engine was extracted from — not part of this repo, and not resolvable from
// here. Citations to it document provenance, not a path you can follow.

const { underPrefix } = require('./walk');
const { fencedLineIndices, changelogBlockRange } = require('./text');

// A whole path is exempt when it falls under one of the declared prefixes
// (`historical_paths`) — `logs/sessions/`, `docs/reports/`, `archive/`, etc.
// Content there is frozen by the repository's own convention (personal-os
// ADR-0009).
function isHistoricalPath(file, historicalPaths) {
  return (historicalPaths || []).some((p) => underPrefix(file, p));
}

// Marks, by line index, which lines of `content` are exempt — combines the
// three sources of exemption that apply within a non-historical file:
//
//   - `inside_changelog_block`: lines inside the contiguous changelog block
//     (same range that `countChangelogEntries` uses to stop counting).
//   - `fenced_code`: lines inside ``` or ~~~ blocks (example text).
//   - `self_qualifying` / `completed_items`: regex that, when it matches the
//     line, marks it as aware of its own historical context (e.g. "at the
//     time", "in v3", an item already `[x]`/✅) — the line self-qualifies as
//     not being a current claim, even outside a changelog.
//
// Returns a `Set<number>` of exempt line indices (0-based). Rules call this
// once per file and look up the Set per line, instead of each reimplementing
// the same scan.
function exemptLineSet(content, cfg) {
  const lines = content.split(/\r?\n/);
  const exempt = new Set();

  if (cfg.inside_changelog_block) {
    const range = changelogBlockRange(content, cfg.changelog_marker || 'Changelog:');
    if (range) {
      for (let i = range.start; i <= range.end; i += 1) exempt.add(i);
    }
  }

  if (cfg.fenced_code) {
    for (const i of fencedLineIndices(lines)) exempt.add(i);
  }

  const selfQualifying = cfg.self_qualifying;
  const completedItems = cfg.completed_items;
  lines.forEach((line, i) => {
    if (selfQualifying && selfQualifying.test(line)) exempt.add(i);
    if (completedItems && completedItems.test(line)) exempt.add(i);
  });

  return exempt;
}

// A third exemption granularity, alongside file (`isHistoricalPath`) and line
// (`exemptLineSet`): by citation TARGET — the string inside the backticks
// itself, independent of which line or file cites it. This is deliberately
// `dead_citations`-specific rather than a general predicate every content
// rule runs through: only that rule resolves an external citation target
// (a path, a prefix-id) against something outside the line's own text, so
// only it has a "target" to exempt in the first place. A line can carry two
// unrelated citations — one that should never resolve by design, one that
// should still be reported — and a line-level predicate would exempt both or
// neither; this one is checked per match, not per line.
function isExemptTarget(target, targetAllowlist) {
  return (targetAllowlist || []).some((entry) => (entry instanceof RegExp ? entry.test(target) : entry === target));
}

module.exports = { isHistoricalPath, exemptLineSet, isExemptTarget };
