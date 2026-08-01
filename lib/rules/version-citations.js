'use strict';

// When a document cites another one's version ("`docs/prompts/009-...` v1.19"),
// checks it against the cited file's real frontmatter `version:` — never
// leaving that claim unchecked until the next model-driven scan.
//
// Deliberately conservative scope: only matches ONE citation of ONE file at a
// time (`` `path.md` vX.Y[.Z] ``, right after the closing backtick). Range
// citations ("`docs/prompts/006-008` v1.9/v1.9/v1.10", 3 versions for 3 files
// in a compact notation) are excluded in this first version — the cost of
// getting their parsing right today is greater than the payoff, and a regex
// loose enough to catch them would reintroduce false positives, the dominant
// risk measured in this engine (see `lib/exempt.js`).
//
// Path resolution: starts with "./" or "../" -> relative to the citing file's
// directory (like a markdown link); otherwise -> relative to the repository
// root (`process.cwd()`) — both styles actually appear in the target corpus
// (`personal-os`).

const fs = require('fs');
const { scopedFiles, resolveCitedPath } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');
const { extractVersion } = require('../frontmatter');

// `(?!\+)` after the version excludes "v4.0+" — an open-threshold convention
// ("since v4.0", not "is at v4.0") measured in the target corpus
// (`personal-os`, `state/metrics-targets.md`): without this exclusion, every
// "v4.0+" would read as an exact-version citation and stay "stale" forever,
// because the text never meant to point at an exact version.
//
// `(?!\/v\d)` excludes a historical enumeration like "v1.6/v1.9/v1.17"
// (several PAST versions of the same file, cited together as a record of when
// each one applied) — measured in the same corpus (`docs/RUNBOOK.md`): it's a
// range/series citation, the same class as the "006-008 v1.9/v1.9/v1.10"
// notation already excluded by design, just for 1 file instead of several.
const CITATION_RE = /`([\w./-]+\.md)`\s+v(\d+(?:\.\d+){1,2})(?!\+)(?!\/v\d)\b/g;

function checkFile(file, exemptCfg) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  const exempt = exemptLineSet(content, exemptCfg);

  const findings = [];
  lines.forEach((line, i) => {
    if (exempt.has(i)) return;
    let m;
    CITATION_RE.lastIndex = 0;
    while ((m = CITATION_RE.exec(line)) !== null) {
      const [, citedPath, citedVersion] = m;
      const resolved = resolveCitedPath(file, citedPath);
      if (resolved === file || !fs.existsSync(resolved)) continue; // not what this rule targets
      const actual = extractVersion(fs.readFileSync(resolved, 'utf8'));
      if (actual === null || actual === citedVersion) continue;
      findings.push(
        `${file}:${i + 1}: cites ${citedPath} as v${citedVersion}, but its real version is v${actual}`,
      );
    }
  });
  return findings;
}

function run(cfg) {
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg).filter((f) => !isHistoricalPath(f, exemptCfg.historical_paths));

  const messages = [];
  for (const file of files) messages.push(...checkFile(file, exemptCfg));

  return {
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} version citation(s) are stale.`,
    okSummary: `All version citations in ${files.length} file(s) matched the cited document's real version.`,
  };
}

module.exports = { id: 'version_citations', run, checkFile, resolveCitedPath, scopedFiles, CITATION_RE };
