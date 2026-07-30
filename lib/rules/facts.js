'use strict';

// Um "fact" é um valor atômico que o repositório afirma em prosa em mais de
// um lugar, sem fonte única — "5 rotinas", "05h00", "~2.867 tokens". Nasce da
// causa C4 do diagnóstico `docgov` (`personal-os/local-notes/030`): o mesmo
// fato hard-coded em prosa em 10+ arquivos, sem nada que os mantenha em
// sincronia quando o fato muda.
//
// Duas checagens independentes por fact, cada uma opcional:
//
//   required_in  — o arquivo declara o valor ATUAL do fact? (lista fixa e
//                  pequena de arquivo+padrão — barato, sem falso positivo,
//                  porque o autor da config escolhe exatamente onde cobrar).
//   forbidden    — o valor ANTIGO do fact aparece em algum lugar do escopo,
//                  fora de contexto isento? (varredura ampla — rede
//                  secundária, mais propensa a falso positivo, por isso
//                  sempre sujeita ao predicado de isenção primeiro).
//
// Shadow mode — ver `bin/docgov.js`: nunca falha o processo sozinha.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

function checkRequired(fact, exemptCfg) {
  const findings = [];
  for (const { file, pattern } of fact.required_in || []) {
    if (!fs.existsSync(file)) {
      findings.push(`${file}: expected to state fact "${fact.id}" (${fact.value}) but the file does not exist`);
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const exempt = exemptLineSet(content, exemptCfg);
    const found = lines.some((line, i) => !exempt.has(i) && pattern.test(line));
    if (!found) {
      findings.push(`${file}: does not state fact "${fact.id}" (expected to match ${pattern})`);
    }
  }
  return findings;
}

function scopedFiles(scopeCfg) {
  const files = (scopeCfg.scope_dirs || []).reduce((acc, d) => acc.concat(walkScoped(toNative(d))), []);
  const excluded = (f) => (scopeCfg.exclude_prefixes || []).some((p) => underPrefix(f, p));
  return files
    .filter((f) => !excluded(f))
    .concat((scopeCfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

function checkForbidden(fact, files, exemptCfg) {
  const findings = [];
  for (const file of files) {
    if (isHistoricalPath(file, exemptCfg.historical_paths)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const exempt = exemptLineSet(content, exemptCfg);
    lines.forEach((line, i) => {
      if (exempt.has(i)) return;
      for (const pattern of fact.forbidden || []) {
        if (pattern.test(line)) {
          findings.push(`${file}:${i + 1}: matches forbidden (stale) form of fact "${fact.id}": "${line.trim()}"`);
        }
      }
    });
  }
  return findings;
}

function run(cfg) {
  const entries = cfg.entries || [];
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg);

  const messages = [];
  for (const fact of entries) {
    messages.push(...checkRequired(fact, exemptCfg));
    if (fact.forbidden && fact.forbidden.length) {
      messages.push(...checkForbidden(fact, files, exemptCfg));
    }
  }

  return {
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} fact violation(s) found.`,
    okSummary: `All ${entries.length} declared fact(s) check out.`,
  };
}

module.exports = { id: 'facts', run, checkRequired, checkForbidden, scopedFiles };
