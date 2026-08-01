'use strict';

// Text utilities shared by more than one rule. Common logic moves up here
// instead of being duplicated in each rule — the same principle that already
// applies to `.docgov.config.js` (data, not logic), one layer down.

// Line indices (0-based) that fall inside a fenced code block (``` or ~~~,
// 3+ characters), including the fence lines themselves. Supports nested
// fences: only closes with the same character and length >= the opening's
// (CommonMark rule) — needed because example text sometimes uses ``````` on
// the outside with ``` inside.
function fencedLineIndices(lines) {
  const fenced = new Set();
  let open = null; // { ch, len } of the open fence
  lines.forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const ch = m[1][0];
      const len = m[1].length;
      fenced.add(i);
      if (!open) { open = { ch, len }; return; }
      if (ch === open.ch && len >= open.len) { open = null; }
      return;
    }
    if (open) fenced.add(i);
  });
  return fenced;
}

// Removes fenced code blocks from the content, preserving the other lines.
//
// Extracted from `lib/rules/internal-links.js` (where it originated) for
// reuse by any rule that needs to ignore example/template text inside code
// blocks — a placeholder like `[artifacts](path)` or "there are N files"
// inside an example block isn't a real claim about the repository.
function stripFencedBlocks(content) {
  const lines = content.split(/\r?\n/);
  const fenced = fencedLineIndices(lines);
  return lines.filter((_, i) => !fenced.has(i)).join('\n');
}

// Line indices (0-based, inclusive) of the contiguous changelog block
// starting at the marker — same stopping rule as `countChangelogEntries`
// (a blank line doesn't close it; the first line that doesn't start with
// "- " does). Returns null if the marker doesn't exist. Used by the
// exemption predicate: an old changelog entry is a record of the moment, not
// a current claim (personal-os ADR-0009), so it shouldn't trigger the content
// rules.
function changelogBlockRange(content, marker) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === marker);
  if (start === -1) return null;

  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '') { end = i; continue; }
    if (!trimmed.startsWith('- ')) break;
    end = i;
  }
  return { start, end };
}

// Interior lines between a pair of `<!-- fragment:{id}:start -->` /
// `<!-- fragment:{id}:end -->` markers. Unlike `changelogBlockRange` above
// (a single-marker, greedy-until-stopping-condition scan specific to
// bullet-list changelogs), this is a plain two-marker range extractor with
// no stopping heuristics — used by fragment-sync to compare a block's
// content against its source of truth. Returns null if either marker is
// missing; the marker lines themselves are excluded from `text`.
function markedBlockLines(content, id) {
  const startMarker = `<!-- fragment:${id}:start -->`;
  const endMarker = `<!-- fragment:${id}:end -->`;
  // split(/\r?\n/) matches every other line-based function in this file —
  // comparison below is exact only after \r\n -> \n normalization.
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === startMarker);
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && l.trim() === endMarker);
  if (end === -1) return null;
  return { start, end, text: lines.slice(start + 1, end).join('\n') };
}

module.exports = { stripFencedBlocks, fencedLineIndices, changelogBlockRange, markedBlockLines };
