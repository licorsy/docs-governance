'use strict';

// Verifica que todo link markdown relativo resolve para um arquivo existente.
//
// Duas sutilezas que não são óbvias e que já custaram achado real:
//
// 1. Blocos de código cercados são removidos antes da varredura. Templates de
//    exemplo usam `[artefatos](caminho)` como placeholder — link que nunca
//    existiu e nunca deveria existir. O stripper suporta fences aninhados
//    (fecha só com o mesmo caractere e comprimento >= o da abertura, como no
//    CommonMark), porque prompts de Project usam ``````` com ``` dentro.
//
// 2. A poda de diretórios é por NOME, em qualquer profundidade — não por
//    prefixo de caminho. É assim que `reports`/`sessions` saem do escopo onde
//    quer que estejam.

const fs = require('fs');
const path = require('path');
const { walkTree } = require('../walk');

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

function isExternalOrSkippable(link, skipPatterns) {
  if (
    link.startsWith('http://') ||
    link.startsWith('https://') ||
    link.startsWith('mailto:') ||
    link.startsWith('#')
  ) {
    return true;
  }
  return (skipPatterns || []).some((re) => re.test(link));
}

function stripFencedBlocks(content) {
  const out = [];
  let open = null; // { ch, len } do fence aberto
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const ch = m[1][0];
      const len = m[1].length;
      if (!open) { open = { ch, len }; continue; }
      if (ch === open.ch && len >= open.len) { open = null; }
      continue; // linha de fence interna: conteúdo do bloco, fica de fora
    }
    if (!open) out.push(line);
  }
  return out.join('\n');
}

function checkFile(file, skipPatterns) {
  const errors = [];
  const content = stripFencedBlocks(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  let match;

  LINK_RE.lastIndex = 0;
  while ((match = LINK_RE.exec(content)) !== null) {
    const rawLink = match[1].trim();
    if (isExternalOrSkippable(rawLink, skipPatterns)) continue;

    const linkPath = rawLink.split('#')[0].split('?')[0];
    if (!linkPath) continue;

    const resolved = path.resolve(dir, linkPath);
    if (!fs.existsSync(resolved)) {
      errors.push('broken link "' + rawLink + '" -> ' + path.relative(process.cwd(), resolved));
    }
  }

  return errors;
}

function run(cfg) {
  const files = walkTree(cfg.walk_root || process.cwd(), cfg.exclude_dir_names || []);
  const skip = (cfg.skip_link_patterns || []).map((p) => (p instanceof RegExp ? p : new RegExp(p)));

  const findings = [];
  for (const file of files) {
    const errors = checkFile(file, skip);
    if (errors.length > 0) findings.push({ file, messages: errors });
  }

  return {
    findings,
    failSummary: (n) => `${n} file(s) contain broken internal links.`,
    okSummary: `All internal links in ${files.length} Markdown file(s) resolved.`,
  };
}

module.exports = { id: 'internal-links', run, checkFile, isExternalOrSkippable, stripFencedBlocks };
