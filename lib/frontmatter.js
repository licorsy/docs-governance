'use strict';

// Parsing de frontmatter e de versão. Deliberadamente ingênuo e sem
// dependência: lê `chave: valor` linha a linha, primeira ocorrência vence.
// Não é um parser YAML e não pretende ser — o schema é raso por convenção, e
// trocar isto por uma dependência custaria mais do que resolve.

function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = content.slice(0, end);
  const fields = {};
  for (const line of block.split(/\r?\n/).slice(1)) {
    const match = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (match) {
      const key = match[1];
      if (!(key in fields)) fields[key] = match[2].trim();
    }
  }
  return fields;
}

// `related: [a, b, c]` -> ['a','b','c']. Formato de bloco YAML não é suportado
// de propósito: nenhum repositório-alvo usa, e suportar sem parser YAML
// convidaria a falso negativo silencioso.
function parseRelated(fields) {
  if (!fields || !fields.related) return [];
  const match = /^\[(.*)\]$/.exec(fields.related);
  if (!match) return [];
  return match[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// `covers: { agent: "2.36", agent-identity: "1.6" }` -> { agent: '2.36', 'agent-identity': '1.6' }.
// Mesmo espírito de `parseRelated`: parser propositalmente ingênuo, sem
// suportar YAML de bloco — nenhum repositório-alvo precisa disso, e um parser
// completo convidaria a falso negativo silencioso em algo que ninguém testou.
function parseCovers(fields) {
  if (!fields || !fields.covers) return {};
  const match = /^\{(.*)\}$/.exec(fields.covers);
  if (!match) return {};
  const out = {};
  const pairRe = /([\w-]+)\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = pairRe.exec(match[1])) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

// null = fora de escopo (sem frontmatter ou sem campo version).
function extractVersion(content) {
  const fields = parseFrontmatter(content);
  if (!fields || !fields.version) return null;
  return fields.version.replace(/^["']|["']$/g, '');
}

// Compara versões pontuadas ("3.10" > "3.9"). Retorna 1/0/-1, ou null quando
// não dá para ordenar.
//
// CUIDADO, e isto contradiz o comentário do script original de onde veio: o
// null NÃO acontece sempre que a versão tem sufixo não numérico. `parseInt`
// consome os dígitos iniciais, então "1.0-rc" vira [1, 0] — igual a "1.0-beta"
// e a "1.0". Só dá null quando um segmento começa sem dígito ("beta").
//
// Consequência prática: um esquema de versão com sufixo (1.0-beta -> 1.0-rc) é
// lido como "sem bump" e reprovado. Isso é aceitável para os repositórios-alvo,
// que usam versão puramente numérica — mas seria um falso positivo em qualquer
// repositório que use pré-lançamento, e é por isso que está escrito aqui.
function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

module.exports = { parseFrontmatter, parseRelated, parseCovers, extractVersion, compareVersions };
