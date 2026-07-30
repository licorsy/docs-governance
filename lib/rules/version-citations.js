'use strict';

// Quando um documento cita a versão de outro ("`docs/prompts/009-...` v1.19"),
// confere contra o `version:` real do frontmatter do arquivo citado — nunca
// deixando essa afirmação sem checagem até a próxima varredura por modelo.
//
// Escopo deliberadamente conservador: só casa UMA citação de UM arquivo por
// vez (`` `caminho.md` vX.Y[.Z] ``, direto após o fecha-crase). Citações de
// intervalo ("`docs/prompts/006-008` v1.9/v1.9/v1.10", 3 versões pra 3
// arquivos numa notação compacta) ficam de fora nesta primeira versão — o
// custo de acertar o parsing delas hoje é maior que o retorno, e um regex
// frouxo demais para pegá-las reintroduziria falso positivo, o risco
// dominante medido neste motor (ver `lib/exempt.js`).
//
// Resolução de caminho: começa com "./" ou "../" -> relativo ao diretório do
// arquivo que cita (como um link markdown); caso contrário -> relativo à raiz
// do repositório (`process.cwd()`) — os dois estilos aparecem de fato no
// corpus-alvo (`personal-os`).
//
// Shadow mode — ver `bin/docgov.js`: nunca falha o processo sozinha.

const fs = require('fs');
const path = require('path');
const { walkScoped, underPrefix, toNative } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');
const { extractVersion } = require('../frontmatter');

// `(?!\+)` depois da versão exclui "v4.0+" — convenção de limiar aberto
// ("desde v4.0", não "está em v4.0") medida no corpus-alvo (`personal-os`,
// `state/metrics-targets.md`): sem essa exclusão, todo "v4.0+" seria lido
// como citação de versão exata e ficaria "stale" para sempre, porque o texto
// nunca pretendeu apontar uma versão exata.
const CITATION_RE = /`([\w./-]+\.md)`\s+v(\d+(?:\.\d+){1,2})(?!\+)\b/g;

function resolveCitedPath(citingFile, citedPath) {
  if (citedPath.startsWith('./') || citedPath.startsWith('../')) {
    return path.relative(process.cwd(), path.resolve(path.dirname(citingFile), citedPath));
  }
  return citedPath.split('/').join(path.sep);
}

function checkFile(file, exemptCfg) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const exempt = exemptLineSet(content, exemptCfg);

  const findings = [];
  lines.forEach((line, i) => {
    if (exempt.has(i)) return;
    let m;
    CITATION_RE.lastIndex = 0;
    while ((m = CITATION_RE.exec(line)) !== null) {
      const [, citedPath, citedVersion] = m;
      const resolved = resolveCitedPath(file, citedPath);
      if (resolved === file || !fs.existsSync(resolved)) continue; // não é o alvo desta regra
      const actual = extractVersion(fs.readFileSync(resolved, 'utf8'));
      if (actual === null || actual === citedVersion) continue;
      findings.push(
        `${file}:${i + 1}: cites ${citedPath} as v${citedVersion}, but its real version is v${actual}`,
      );
    }
  });
  return findings;
}

function scopedFiles(cfg) {
  const files = (cfg.scope_dirs || []).reduce((acc, d) => acc.concat(walkScoped(toNative(d))), []);
  const excluded = (f) => (cfg.exclude_prefixes || []).some((p) => underPrefix(f, p));
  return files
    .filter((f) => !excluded(f))
    .concat((cfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

function run(cfg) {
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg).filter((f) => !isHistoricalPath(f, exemptCfg.historical_paths));

  const messages = [];
  for (const file of files) messages.push(...checkFile(file, exemptCfg));

  return {
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} version citation(s) are stale.`,
    okSummary: `All version citations in ${files.length} file(s) matched the cited document's real version.`,
  };
}

module.exports = { id: 'version_citations', run, checkFile, resolveCitedPath, scopedFiles, CITATION_RE };
