'use strict';

// Duas estratégias de varredura, porque os checks originais do personal-os
// usavam duas — e paridade exata era o critério de aceite da extração.
//
//   walkScoped  — usada por frontmatter e changelog-retention. Recebe caminhos
//                 declarados; aceita arquivo, diretório ou caminho inexistente
//                 (retorna vazio). NÃO exclui por nome de diretório.
//   walkTree    — usada por internal-links. Varre a árvore inteira a partir de
//                 uma raiz, podando por NOME de diretório em qualquer nível
//                 (é assim que `reports`/`sessions` saíam do escopo de links,
//                 em qualquer profundidade).
//
// Os dois normalizam para separador nativo via path.join, então config escrita
// com `/` funciona no Windows.

const fs = require('fs');
const path = require('path');

function walkScoped(target, out) {
  out = out || [];
  if (!fs.existsSync(target)) return out;
  if (fs.statSync(target).isFile()) {
    if (target.endsWith('.md')) out.push(target);
    return out;
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      walkScoped(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function walkTree(root, excludeNames, out) {
  out = out || [];
  const excluded = excludeNames instanceof Set ? excludeNames : new Set(excludeNames || []);
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkTree(full, excluded, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// Normaliza um prefixo escrito com `/` na config para o separador nativo, e
// testa se `file` está sob ele. Prefixo casa o próprio caminho também.
function underPrefix(file, prefix) {
  const native = prefix.split('/').join(path.sep);
  return file === native || file.startsWith(native + path.sep);
}

function toNative(p) {
  return p.split('/').join(path.sep);
}

module.exports = { walkScoped, walkTree, underPrefix, toNative };
