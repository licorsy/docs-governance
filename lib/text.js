'use strict';

// Utilidades de texto compartilhadas por mais de uma regra. Construção comum
// sobe para cá em vez de ser duplicada em cada regra — é o mesmo princípio que
// já vale para `.docgov.config.js` (dados, não lógica), uma camada abaixo.

// Índices de linha (0-based) que caem dentro de um bloco de código cercado
// (``` ou ~~~, 3+ caracteres), incluindo as linhas de fence em si. Suporta
// fences aninhados: só fecha com o mesmo caractere e comprimento >= o da
// abertura (regra do CommonMark) — necessário porque texto de exemplo às
// vezes usa ``````` por fora com ``` por dentro.
function fencedLineIndices(lines) {
  const fenced = new Set();
  let open = null; // { ch, len } do fence aberto
  lines.forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      const ch = m[1][0];
      const len = m[1].length;
      fenced.add(i);
      if (!open) { open = { ch, len }; return; }
      if (ch === open.ch && len >= open.len) { open = null; }
      return;
    }
    if (open) fenced.add(i);
  });
  return fenced;
}

// Remove blocos de código cercados do conteúdo, preservando as demais linhas.
//
// Extraído de `lib/rules/internal-links.js` (onde nasceu) para reuso por
// qualquer regra que precise ignorar texto de exemplo/template dentro de
// blocos de código — um placeholder como `[artefatos](caminho)` ou "são N
// arquivos" dentro de um bloco de exemplo não é uma afirmação real sobre o
// repositório.
function stripFencedBlocks(content) {
  const lines = content.split(/\r?\n/);
  const fenced = fencedLineIndices(lines);
  return lines.filter((_, i) => !fenced.has(i)).join('\n');
}

// Índices de linha (0-based, inclusive) do bloco de changelog contíguo a
// partir do marcador — mesma regra de parada de `countChangelogEntries`
// (linha em branco não fecha; primeira linha que não começa com "- " fecha).
// Retorna null se o marcador não existir. Usada pelo predicado de isenção:
// uma entrada de changelog antiga é registro do momento, não afirmação vigente
// (ADR-0009), então não deveria disparar as regras de conteúdo.
function changelogBlockRange(content, marker) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === marker);
  if (start === -1) return null;

  let end = start;
  for (let i = start + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '') { end = i; continue; }
    if (!trimmed.startsWith('- ')) break;
    end = i;
  }
  return { start, end };
}

module.exports = { stripFencedBlocks, fencedLineIndices, changelogBlockRange };
