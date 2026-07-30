'use strict';

// Predicado "registro histórico ≠ afirmação vigente" — aplicado ANTES de
// qualquer regra de conteúdo (declared_counts, sum_decomposition, facts,
// version_citations). Sem ele, toda regra de conteúdo reencontra o mesmo
// falso positivo dominante medido duas vezes antes deste motor existir: 6
// falsos em 7 achados na primeira versão do verificador adversarial da nota
// 029, e 12 falsos em 12 erros do `ctxlint` num corpus em português. Uma
// entrada de changelog antiga citando "35 arquivos" não é uma afirmação de
// que o corpus tem 35 arquivos hoje — é registro do que era verdade na época
// (ADR-0009: entradas antigas não se reescrevem). Uma linha dentro de um bloco
// de código cercado é exemplo, não afirmação. Isenção é sempre por LINHA (ou
// por arquivo inteiro, para `historical_paths`), nunca pelo documento todo —
// um arquivo pode ter um changelog congelado e um corpo vigente na mesma
// respiração.

const { underPrefix } = require('./walk');
const { fencedLineIndices, changelogBlockRange } = require('./text');

// Um caminho inteiro é isento quando cai sob um dos prefixos declarados
// (`historical_paths`) — `logs/sessions/`, `docs/reports/`, `archive/`, etc.
// Conteúdo ali é congelado por convenção do próprio repositório (ADR-0009).
function isHistoricalPath(file, historicalPaths) {
  return (historicalPaths || []).some((p) => underPrefix(file, p));
}

// Marca, por índice de linha, quais linhas de `content` são isentas — combina
// as três fontes de isenção que atuam dentro de um arquivo não-histórico:
//
//   - `inside_changelog_block`: linhas dentro do bloco de changelog contíguo
//     (mesmo alcance que `countChangelogEntries` usa para parar de contar).
//   - `fenced_code`: linhas dentro de blocos ``` ou ~~~ (texto de exemplo).
//   - `self_qualifying` / `completed_items`: regex que, ao casar a linha,
//     marca-a como consciente do próprio contexto histórico (ex.: "à época",
//     "na v3", um item já `[x]`/✅) — a linha se autoqualifica como não sendo
//     uma afirmação vigente, mesmo fora de um changelog.
//
// Retorna um `Set<number>` de índices de linha (0-based) isentos. Regras
// chamam isto uma vez por arquivo e consultam o Set por linha, em vez de cada
// uma reimplementar a mesma varredura.
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

module.exports = { isHistoricalPath, exemptLineSet };
