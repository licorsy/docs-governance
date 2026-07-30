'use strict';

// Confere que uma soma declarada em prosa ("20 + 13 + 2 + 2 = 37") bate de
// verdade — refazendo a conta, nunca comparando texto contra texto. Nasce do
// defeito real que sobreviveu a 2 versões seguidas do mesmo arquivo
// (`docs/prompts/009` v1.16 → v1.18): o total foi corrigido numa rodada e a
// decomposição não, porque nenhuma checagem refazia a soma.
//
// Cada entrada declara UM regex cujo ÚLTIMO grupo de captura é o total e todo
// grupo ANTERIOR é uma parcela — a mesma ordem em que "a + b + c = total" já
// se lê. Não há ambiguidade de qual grupo é o quê porque a convenção é fixa.
//
// Shadow mode — ver `bin/docgov.js`: nunca falha o processo sozinha.

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
    if (!m || m.length < 3) return; // precisa de pelo menos 2 parcelas + total
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
