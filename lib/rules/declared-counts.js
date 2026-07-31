'use strict';

// Compares a count declared in prose ("there are N files") against a real
// count obtained by scanning an actual directory — never comparing text
// against text. Born from the real "35 vs 36" defect in `docs/prompts/009`
// (two consecutive versions of the same file with the total and the
// breakdown out of sync with each other and with disk).
//
// Runs in shadow mode (see `bin/docgov.js`): the CLI prints the finding
// prefixed with `[shadow]` and never fails the process because of it.
// Promotion to blocking is a human decision, made after measuring precision
// on a real corpus — see `personal-os`'s `local-notes/030`, Phase 2 criteria.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

function realCount(entry) {
  const excluded = new Set((entry.exclude_files || []).map(toNative));
  const files = walkScoped(toNative(entry.dir))
    .filter((f) => !excluded.has(f))
    .filter((f) => !(entry.exclude_prefixes || []).some((p) => underPrefix(f, p)));
  return entry.filter ? files.filter((f) => entry.filter.test(f)).length : files.length;
}

function checkEntry(entry, exemptCfg) {
  if (!fs.existsSync(entry.file)) return [];
  if (isHistoricalPath(entry.file, exemptCfg.historical_paths)) return [];

  const content = fs.readFileSync(entry.file, 'utf8');
  const lines = content.split(/\r?\n/);
  const exempt = exemptLineSet(content, exemptCfg);
  const expected = realCount(entry);

  const findings = [];
  lines.forEach((line, i) => {
    if (exempt.has(i)) return;
    const m = entry.pattern.exec(line);
    entry.pattern.lastIndex = 0; // pattern may carry the "g" flag between calls
    if (!m) return;
    const declared = parseInt(m[1], 10);
    if (declared !== expected) {
      findings.push(
        `${entry.file}:${i + 1}: declares ${declared} but ${entry.dir} actually has ${expected} ` +
        `(pattern "${entry.pattern.source}")`,
      );
    }
  });
  return findings;
}

function run(cfg) {
  const entries = cfg.entries || [];
  const exemptCfg = cfg.exempt || {};

  const messages = [];
  for (const entry of entries) {
    messages.push(...checkEntry(entry, exemptCfg));
  }

  return {
    // One "finding" per message — not grouped by file, because the `why`
    // footer is already printed once by the CLI, and each message already
    // carries `file:line`, so grouping wouldn't gain readability.
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} declared count(s) disagree with the real count.`,
    okSummary: `All ${entries.length} declared count(s) matched the real count.`,
  };
}

module.exports = { id: 'declared_counts', run, checkEntry, realCount };
