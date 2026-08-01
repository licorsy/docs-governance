'use strict';

const fs = require('fs');
const { scopedFiles } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');
const { escapeRegExp } = require('../text');

// Builds the per-line regex and the valid-number Set once per configured
// sequence — these only depend on `sequence`, never on the line or file being
// scanned, but `checkSequence` runs once per line for every file. Rebuilding
// a `RegExp`/`Set` on every line (as this used to do) is wasted work at
// corpus scale; hoisting it up to one build per sequence keeps the per-line
// loop allocation-free.
function buildSequence(sequence) {
  return {
    id: sequence.id,
    word: sequence.word,
    re: new RegExp('\\b' + escapeRegExp(sequence.word) + '\\s+(\\d+)\\b', 'gi'),
    valid: new Set(sequence.valid || []),
  };
}

function checkSequence(sequence, file, line, lineIndex, findings) {
  const { re, valid } = sequence;
  re.lastIndex = 0;
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
  const sequences = (cfg.sequences || []).map(buildSequence);

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
