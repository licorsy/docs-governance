'use strict';

const fs = require('fs');
const { scopedFiles } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkSequence(sequence, file, line, lineIndex, findings) {
  const re = new RegExp('\\b' + escapeRegExp(sequence.word) + '\\s+(\\d+)\\b', 'gi');
  const valid = new Set(sequence.valid || []);
  let m;
  while ((m = re.exec(line)) !== null) {
    const n = parseInt(m[1], 10);
    if (!valid.has(n)) {
      findings.push(
        `${file}:${lineIndex + 1}: cites "${sequence.word} ${n}", but the canonical sequence "${sequence.id}" only has these valid numbers: ${[...valid].join(', ')}`,
      );
    }
  }
}

function run(cfg) {
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg).filter((f) => !isHistoricalPath(f, exemptCfg.historical_paths));
  const sequences = cfg.sequences || [];

  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const exempt = exemptLineSet(content, exemptCfg);

    lines.forEach((line, i) => {
      if (exempt.has(i)) return;
      for (const sequence of sequences) checkSequence(sequence, file, line, i, findings);
    });
  }

  return {
    findings: findings.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} numbered reference(s) cite an invalid number.`,
    okSummary: `All numbered references in ${files.length} file(s) resolved to a valid number in their canonical sequence.`,
  };
}

module.exports = { id: 'numbered_reference_consistency', run, checkSequence, escapeRegExp };
