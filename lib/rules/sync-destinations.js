'use strict';

// Um documento "destino" (ex.: um paste de Project do claude.ai, self-contained
// por desenho, sem carregar arquivo nenhum sozinho) declara no próprio
// frontmatter o que ele diz cobrir: `covers: { agent: "2.36", agent-identity:
// "1.6" }`. Esta regra resolve cada id contra o `version:` real da fonte
// (`lib/corpus.js`) e confere se o destino está de fato sincronizado —
// substitui julgamento de prosa ("os 3 Projects parecem sincronizados?") por
// comparação de string.
//
// Nasce da causa C1+C7 do diagnóstico `docgov` (`personal-os/local-notes/030`)
// e da ADR-0011 daquele repositório: o par que duplica de verdade (~38 KB)
// não tinha mecanismo nenhum — granularidade de dia não distinguia "recolei"
// de "mudou horas depois", e produziu um falso "✅ sincronizado" real.
//
// Não é shadow: é uma comparação de string, não uma heurística — o risco de
// falso positivo que justifica shadow mode nas regras da Fase 2 não existe
// aqui. Sem `covers:` declarado em nenhum arquivo, a regra não acha nada (dado
// ausente, não erro).

const fs = require('fs');
const { parseFrontmatter, parseCovers } = require('../frontmatter');
const { buildIdIndex } = require('../corpus');

function checkTarget(file, idIndex) {
  if (!fs.existsSync(file)) return [{ id: null, ok: false, message: `${file}: target does not exist` }];

  const fields = parseFrontmatter(fs.readFileSync(file, 'utf8'));
  const covers = parseCovers(fields);
  const ids = Object.keys(covers);

  if (ids.length === 0) return [];

  return ids.map((id) => {
    const source = idIndex.get(id);
    if (!source) {
      return { id, ok: false, message: `${file}: covers unknown id "${id}" (no document in scope declares it)` };
    }
    if (source.version === null) {
      return { id, ok: false, message: `${file}: covers "${id}" (${source.file}), which has no version: field` };
    }
    if (source.version !== covers[id]) {
      return {
        id,
        ok: false,
        message: `${file}: declares covers.${id} = "${covers[id]}", but ${source.file} is at "${source.version}"`,
      };
    }
    return { id, ok: true, message: `${file}: covers.${id} matches ${source.file} v${source.version}` };
  });
}

function run(cfg) {
  const targets = cfg.targets || [];
  const idIndex = buildIdIndex(cfg);

  const results = targets.flatMap((file) => checkTarget(file, idIndex));
  const findings = results.filter((r) => !r.ok);

  return {
    findings: findings.map((f) => ({ file: '', messages: [f.message] })),
    inlineMessages: true,
    failSummary: (n) => `${n} sync destination(s) out of sync.`,
    okSummary: `All configured sync destinations (${targets.length} target file(s)) are in sync.`,
    // usado por `docgov sync-status`, que quer o detalhe completo (inclusive
    // o que está OK), não só o que falhou
    all: results,
  };
}

module.exports = { id: 'sync_destinations', run, checkTarget };
