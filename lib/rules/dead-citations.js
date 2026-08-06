'use strict';

const fs = require('fs');
const path = require('path');
const { scopedFiles, resolveCitedPath, walkScoped } = require('../walk');
const { isHistoricalPath, exemptLineSet, isExemptTarget } = require('../exempt');
const { escapeRegExp } = require('../text');

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

function checkFilenamePattern(pattern, file, line, lineIndex, findings, targetAllowlist) {
  let m;
  FILENAME_RE.lastIndex = 0;
  while ((m = FILENAME_RE.exec(line)) !== null) {
    const citedPath = m[1];
    if (isExemptTarget(citedPath, targetAllowlist)) continue;
    const resolved = resolveCitedPath(file, citedPath);
    if (resolved === file) continue; // a file citing itself is not a dead citation
    if (!fs.existsSync(resolved)) {
      findings.push(`${file}:${lineIndex + 1}: cites \`${citedPath}\`, but no file resolves it (pattern "${pattern.id}")`);
    }
  }
}

// Built once per pattern (see `run()`) instead of once per line — the regex
// only depends on `pattern.prefix`/`pattern.digits`, never on the line or
// file being scanned, and this runs once per line for every file.
function buildPrefixPattern(pattern) {
  return new RegExp('`' + escapeRegExp(pattern.prefix) + `-(\\d{${pattern.digits}})` + '`', 'g');
}

function checkPrefixIdPattern(pattern, re, index, file, line, lineIndex, findings, targetAllowlist) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(line)) !== null) {
    const target = `${pattern.prefix}-${m[1]}`;
    if (isExemptTarget(target, targetAllowlist)) continue;
    if (!index.has(m[1])) {
      findings.push(`${file}:${lineIndex + 1}: cites \`${target}\`, but no file resolves it (pattern "${pattern.id}")`);
    }
  }
}

// Validates every configured pattern once, up front — before any file is
// read — so a typo'd `kind` or a missing `digits` fails loudly and exactly
// once, instead of being silently ignored per-line (an unrecognized `kind`
// matched no branch below and produced zero findings) or matching nothing
// via a literal `\d{undefined}` regex.
function validatePatterns(patterns) {
  for (const pattern of patterns) {
    if (pattern.kind === 'filename') continue;
    if (pattern.kind === 'prefix-id') {
      if (typeof pattern.digits !== 'number' || !Number.isFinite(pattern.digits)) {
        throw new Error(
          `dead_citations: pattern "${pattern.id}" has kind "prefix-id" but "digits" is missing or not a number`,
        );
      }
      continue;
    }
    throw new Error(
      `dead_citations: unknown pattern kind "${pattern.kind}" (pattern "${pattern.id}") — expected "filename" or "prefix-id"`,
    );
  }
}

function run(cfg) {
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg).filter((f) => !isHistoricalPath(f, exemptCfg.historical_paths));
  const patterns = cfg.patterns || [];
  validatePatterns(patterns);
  const targetAllowlist = exemptCfg.target_allowlist || [];

  const prefixIndexes = new Map();
  const prefixRegexes = new Map();
  for (const pattern of patterns) {
    if (pattern.kind === 'prefix-id') {
      prefixIndexes.set(pattern.id, buildPrefixIndex(pattern));
      prefixRegexes.set(pattern.id, buildPrefixPattern(pattern));
    }
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
          checkFilenamePattern(pattern, file, line, i, findings, targetAllowlist);
        } else if (pattern.kind === 'prefix-id') {
          checkPrefixIdPattern(pattern, prefixRegexes.get(pattern.id), prefixIndexes.get(pattern.id), file, line, i, findings, targetAllowlist);
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
