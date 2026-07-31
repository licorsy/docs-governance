'use strict';

// Checks that a sum declared in prose ("20 + 13 + 2 + 2 = 37") actually adds
// up — redoing the math, never comparing text against text. Born from a real
// defect that survived 2 consecutive versions of the same file
// (`docs/prompts/009` v1.16 → v1.18): the total was fixed in one round and
// the breakdown wasn't, because no check ever redid the sum.
//
// Each entry declares ONE regex whose LAST capture group is the total and
// every PRECEDING group is a part — the same order in which "a + b + c =
// total" already reads. There's no ambiguity about which group is which
// because the convention is fixed.
//
// Shadow mode — see `bin/docgov.js`: never fails the process on its own.

const fs = require('fs');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

function checkLine(match) {
  const numbers = match.slice(1).map((g) => parseInt(g, 10));
  const total = numbers[numbers.length - 1];
  const parts = numbers.slice(0, -1);
  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum === total) return null;
  return `declared ${parts.join(' + ')} = ${total}, but ${parts.join(' + ')} = ${sum}`;
}

function checkEntry(entry, exemptCfg) {
  if (!fs.existsSync(entry.file)) return [];
  if (isHistoricalPath(entry.file, exemptCfg.historical_paths)) return [];

  const content = fs.readFileSync(entry.file, 'utf8');
  const lines = content.split(/\r?\n/);
  const exempt = exemptLineSet(content, exemptCfg);

  const findings = [];
  lines.forEach((line, i) => {
    if (exempt.has(i)) return;
    const m = entry.pattern.exec(line);
    entry.pattern.lastIndex = 0;
    if (!m || m.length < 3) return; // needs at least 2 parts + total
    const error = checkLine(m);
    if (error) findings.push(`${entry.file}:${i + 1}: ${error}`);
  });
  return findings;
}

function run(cfg) {
  const entries = cfg.entries || [];
  const exemptCfg = cfg.exempt || {};

  const messages = [];
  for (const entry of entries) messages.push(...checkEntry(entry, exemptCfg));

  return {
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} declared sum(s) do not add up.`,
    okSummary: `All ${entries.length} declared sum(s) added up correctly.`,
  };
}

module.exports = { id: 'sum_decomposition', run, checkEntry, checkLine };
