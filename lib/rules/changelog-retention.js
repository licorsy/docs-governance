'use strict';

// Documentos vivos mantêm só as N entradas mais novas de changelog no corpo;
// o histórico completo vive no git.
//
// A regra só existe porque o oposto foi medido: um arquivo chegou a ter 28
// entradas de changelog ocupando ~31% do próprio arquivo — mais peso que o
// conteúdo que ele deveria carregar.
//
// A contagem é do marker até o fim da lista contígua. A linha fixa de
// fechamento ("- Entradas antigas: ...") é item de lista mas NÃO conta como
// entrada — só linhas que casam `- v<dígito>` contam. Isso importa: contar a
// linha de fechamento faria todo arquivo no limite falhar por um.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');

function countChangelogEntries(content, marker) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === marker);
  if (start === -1) return null;

  let count = 0;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('- ')) break;
    if (/^- v\d/.test(trimmed)) count += 1;
  }
  return count;
}

function scopedFiles(cfg) {
  const excludeFiles = new Set((cfg.exclude_files || []).map(toNative));
  const excluded = (f) =>
    excludeFiles.has(f) || (cfg.exclude_prefixes || []).some((p) => underPrefix(f, p));

  return (cfg.scope_dirs || [])
    .reduce((acc, d) => acc.concat(walkScoped(toNative(d))), [])
    .filter((f) => !excluded(f))
    .concat((cfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

function run(cfg) {
  const marker = cfg.marker || 'Changelog:';
  const max = cfg.max_entries == null ? 3 : cfg.max_entries;
  const files = scopedFiles(cfg);

  const findings = [];
  let checked = 0;

  for (const file of files) {
    const count = countChangelogEntries(fs.readFileSync(file, 'utf8'), marker);
    if (count === null) continue;
    checked += 1;
    if (count > max) {
      findings.push({
        file,
        messages: [
          `${count} changelog entries (retention cap is ${max}` +
          (cfg.why ? `, ${cfg.why}` : '') +
          ' - remove the oldest, removal-only)',
        ],
      });
    }
  }

  return {
    findings,
    failSummary: (n) => `${n} file(s) exceed the body-changelog retention cap.`,
    okSummary: `All ${checked} document(s) with a body changelog respect the newest-${max} retention cap.`,
  };
}

module.exports = { id: 'changelog-retention', run, countChangelogEntries, scopedFiles };
