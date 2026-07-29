'use strict';

// Todo .md modificado num PR que tenha `version:` no frontmatter precisa ter a
// versão bumpada em relação à base — e a versão é monotônica, nunca igual nem
// menor.
//
// Nasceu de 2 violações reais da regra no mesmo dia, pegas por outro check:
// enforcement mecânico > promessa.
//
// Só status "M" (modificado) é cobrado. Adição, rename e deleção ficam de
// fora: arquivo novo nasce com a versão que quiser, e rename puro não muda
// conteúdo. Cobrar rename produziria falso positivo em toda reorganização.
//
// Esta é a única regra que precisa de git e de uma base de comparação. Sem
// base (push direto, execução local solta), ela se ABSTÉM — não falha.

const fs = require('fs');
const { execFileSync } = require('child_process');
const { extractVersion, compareVersions } = require('../frontmatter');

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function evaluate(oldContent, newContent, file) {
  const oldVersion = extractVersion(oldContent);
  const newVersion = extractVersion(newContent);
  if (oldVersion === null || newVersion === null) return null;
  if (oldVersion === newVersion) {
    return `${file}: modified without a version bump (still "${oldVersion}") - ` +
      'every edit to a versioned doc bumps version: and adds a changelog entry';
  }
  const cmp = compareVersions(newVersion, oldVersion);
  if (cmp !== null && cmp <= 0) {
    return `${file}: version "${newVersion}" is not greater than base "${oldVersion}" ` +
      '(version is monotonic - never reset or lower it)';
  }
  return null;
}

function changedMarkdownFiles(mergeBase) {
  return git(['diff', '--name-status', mergeBase, 'HEAD'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([status, file]) => status === 'M' && file && file.endsWith('.md'))
    .map(([, file]) => file);
}

function run(cfg, ctx) {
  const baseSha = (ctx && ctx.baseSha) || process.env.BASE_SHA;
  if (!baseSha) {
    return { skipped: true, reason: 'no base sha (set BASE_SHA or pass --base-sha)', findings: [] };
  }

  const mergeBase = git(['merge-base', baseSha, 'HEAD']).trim();
  const findings = [];
  let checked = 0;

  for (const file of changedMarkdownFiles(mergeBase)) {
    let oldContent;
    try {
      oldContent = git(['show', `${mergeBase}:${file}`]);
    } catch {
      continue; // não existia na base (borda de rename/força) — sem cobrança
    }
    const newContent = fs.readFileSync(file, 'utf8');
    if (extractVersion(oldContent) === null || extractVersion(newContent) === null) continue;
    checked += 1;
    const error = evaluate(oldContent, newContent, file);
    if (error) findings.push({ file, messages: [error] });
  }

  return {
    findings,
    // A mensagem já traz o caminho; imprimir o arquivo como cabeçalho duplicaria.
    inlineMessages: true,
    failSummary: (n) => `${n} modified file(s) missing a proper version bump.`,
    okSummary: `All ${checked} modified versioned document(s) have a proper version bump.`,
  };
}

module.exports = { id: 'version-bump', run, evaluate, changedMarkdownFiles };
