'use strict';

// Compara uma contagem declarada em prosa ("são N arquivos") contra uma
// contagem real, obtida varrendo um diretório de verdade — nunca comparando
// texto contra texto. Nasce do defeito real "35 vs 36" de `docs/prompts/009`
// (duas versões seguidas do mesmo arquivo com o total e a decomposição fora
// de sincronia um do outro e do disco).
//
// Roda em shadow mode (ver `bin/docgov.js`): a CLI imprime o achado prefixado
// com `[shadow]` e nunca falha o processo por causa dele. Promoção a
// bloqueante é decisão humana, depois de medir precisão num corpus real — ver
// `local-notes/030` do `personal-os`, critério da Fase 2.

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
    entry.pattern.lastIndex = 0; // pattern pode ter a flag "g" entre chamadas
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
    // Uma "finding" por mensagem — sem agrupar por arquivo, porque o rodapé
    // `why` já é impresso uma vez pela CLI, e cada mensagem já carrega
    // `arquivo:linha`, então agrupar não ganharia legibilidade.
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} declared count(s) disagree with the real count.`,
    okSummary: `All ${entries.length} declared count(s) matched the real count.`,
  };
}

module.exports = { id: 'declared_counts', run, checkEntry, realCount };
