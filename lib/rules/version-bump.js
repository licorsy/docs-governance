'use strict';

// Every .md modified in a PR that has `version:` in its frontmatter must have
// its version bumped relative to the base — and the version is monotonic,
// never equal or lower.
//
// Born from 2 real violations of the rule on the same day, caught by another
// check: mechanical enforcement > a promise.
//
// Only status "M" (modified) is checked. Additions, renames, and deletions
// are excluded: a new file is born with whatever version it wants, and a pure
// rename doesn't change content. Checking renames would produce false
// positives on every reorganization.
//
// This is the only rule that needs git and a comparison base. Without a base
// (a direct push, a loose local run), it ABSTAINS — it doesn't fail.

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
      continue; // didn't exist at the base (rename/force edge case) — not checked
    }
    const newContent = fs.readFileSync(file, 'utf8');
    if (extractVersion(oldContent) === null || extractVersion(newContent) === null) continue;
    checked += 1;
    const error = evaluate(oldContent, newContent, file);
    if (error) findings.push({ file, messages: [error] });
  }

  return {
    findings,
    // The message already carries the path; printing the file as a header
    // would duplicate it.
    inlineMessages: true,
    failSummary: (n) => `${n} modified file(s) missing a proper version bump.`,
    okSummary: `All ${checked} modified versioned document(s) have a proper version bump.`,
  };
}

module.exports = { id: 'version-bump', run, evaluate, changedMarkdownFiles };
