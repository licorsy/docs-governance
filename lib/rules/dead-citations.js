'use strict';

const fs = require('fs');
const path = require('path');
const { scopedFiles, resolveCitedPath, walkScoped } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `filename` kind: any bare inline-code file citation, no version suffix
// required (unlike version-citations.js's CITATION_RE, which does require
// one — that's the exact gap this kind fills).
const FILENAME_RE = /`([\w./-]+\.md)`/g;

function buildPrefixIndex(pattern) {
  const index = new Map();
  if (!fs.existsSync(pattern.dir)) return index;
  const re = new RegExp(`^(\\d{${pattern.digits}})-`);
  for (const file of walkScoped(pattern.dir)) {
    const m = re.exec(path.basename(file));
    if (m) index.set(m[1], file);
  }
  return index;
}

function checkFilenamePattern(pattern, file, line, lineIndex, findings) {
  let m;
  FILENAME_RE.lastIndex = 0;
  while ((m = FILENAME_RE.exec(line)) !== null) {
    const citedPath = m[1];
    const resolved = resolveCitedPath(file, citedPath);
    if (resolved === file) continue; // a file citing itself is not a dead citation
    if (!fs.existsSync(resolved)) {
      findings.push(`${file}:${lineIndex + 1}: cites \`${citedPath}\`, but no file resolves it (pattern "${pattern.id}")`);
    }
  }
}

function checkPrefixIdPattern(pattern, index, file, line, lineIndex, findings) {
  const re = new RegExp('`' + escapeRegExp(pattern.prefix) + `-(\\d{${pattern.digits}})` + '`', 'g');
  let m;
  while ((m = re.exec(line)) !== null) {
    if (!index.has(m[1])) {
      findings.push(`${file}:${lineIndex + 1}: cites \`${pattern.prefix}-${m[1]}\`, but no file resolves it (pattern "${pattern.id}")`);
    }
  }
}

function run(cfg) {
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg).filter((f) => !isHistoricalPath(f, exemptCfg.historical_paths));
  const patterns = cfg.patterns || [];

  const prefixIndexes = new Map();
  for (const pattern of patterns) {
    if (pattern.kind === 'prefix-id') prefixIndexes.set(pattern.id, buildPrefixIndex(pattern));
  }

  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const exempt = exemptLineSet(content, exemptCfg);

    lines.forEach((line, i) => {
      if (exempt.has(i)) return;
      for (const pattern of patterns) {
        if (pattern.kind === 'filename') {
          checkFilenamePattern(pattern, file, line, i, findings);
        } else if (pattern.kind === 'prefix-id') {
          checkPrefixIdPattern(pattern, prefixIndexes.get(pattern.id), file, line, i, findings);
        }
      }
    });
  }

  return {
    findings: findings.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} dead citation(s) found.`,
    okSummary: `All inline-code citations in ${files.length} file(s) resolved.`,
  };
}

module.exports = { id: 'dead_citations', run, checkFilenamePattern, checkPrefixIdPattern, buildPrefixIndex, escapeRegExp };
