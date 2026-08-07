'use strict';

// Verifies that every relative markdown link resolves to an existing file.
//
// Two subtleties that aren't obvious and have already cost a real finding:
//
// 1. Fenced code blocks are stripped before scanning. Example templates use
//    `[artifacts](path)` as a placeholder — a link that never existed and
//    never should. The stripper supports nested fences (closes only with the
//    same character and length >= the opening's, as in CommonMark), because
//    Project prompts use ``````` on the outside with ``` inside.
//
// 2. Directory pruning is by NAME, at any depth — not by path prefix. This is
//    how `reports`/`sessions` stay out of scope wherever they appear.

const fs = require('fs');
const path = require('path');
const { walkTree } = require('../walk');
const { stripFencedBlocks } = require('../text');

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

// Same scan as checkFile, inverted: instead of the links that don't resolve,
// the links that DO — as paths relative to cwd, the same shape walkScoped's
// file lists use. Used by lib/references.js to build the reference graph;
// kept here rather than duplicated because LINK_RE/isExternalOrSkippable are
// this module's own.
function resolvedLinks(file, skipPatterns) {
  const links = [];
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
    if (fs.existsSync(resolved)) links.push(path.relative(process.cwd(), resolved));
  }

  return links;
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

module.exports = { id: 'internal-links', run, checkFile, isExternalOrSkippable, stripFencedBlocks, resolvedLinks };
