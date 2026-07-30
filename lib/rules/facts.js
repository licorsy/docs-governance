'use strict';

// Um "fact" é um valor atômico que o repositório afirma em prosa em mais de
// um lugar, sem fonte única — "5 rotinas", "05h00", "~2.867 tokens". Nasce da
// causa C4 do diagnóstico `docgov` (`personal-os/local-notes/030`): o mesmo
// fato hard-coded em prosa em 10+ arquivos, sem nada que os mantenha em
// sincronia quando o fato muda.
//
// Duas checagens independentes por fact, cada uma opcional:
//
//   required_in  — o arquivo declara o valor ATUAL do fact, em qualquer lugar
//                  do próprio arquivo (não passa pelo predicado de isenção —
//                  ver o comentário de `checkRequired`)? Lista fixa e pequena
//                  de arquivo+padrão — barato, sem falso positivo, porque o
//                  autor da config escolhe exatamente onde cobrar.
//   forbidden    — o valor ANTIGO do fact aparece em algum lugar do escopo,
//                  fora de contexto isento? (varredura ampla — rede
//                  secundária, mais propensa a falso positivo, por isso
//                  sempre sujeita ao predicado de isenção primeiro).
//
// Shadow mode — ver `bin/docgov.js`: nunca falha o processo sozinha.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

// `required_in` NÃO passa pelo predicado de isenção — de propósito, e ao
// contrário de `checkForbidden` abaixo. Achado real ao validar contra o
// corpus do `personal-os` (29/07): `AGENTS.md` afirma "são 4 rotinas... que
// existiam então" e, na MESMA frase, "são 5 rotinas... hoje" — isenção por
// LINHA marcou a linha inteira como histórica (por causa da primeira parte)
// e escondeu a segunda, produzindo um falso "o arquivo não afirma o fato
// atual" quando ele afirma, sim. Perguntar "este arquivo menciona X em algum
// lugar?" não tem o mesmo risco de falso positivo que perguntar "todo lugar
// que menciona algo parecido com X é uma afirmação vigente?" — a isenção
// existe para a segunda pergunta (`checkForbidden`), não para a primeira.
function checkRequired(fact) {
  const findings = [];
  for (const { file, pattern } of fact.required_in || []) {
    if (!fs.existsSync(file)) {
      findings.push(`${file}: expected to state fact "${fact.id}" (${fact.value}) but the file does not exist`);
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    if (!pattern.test(content)) {
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
    messages.push(...checkRequired(fact));
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
