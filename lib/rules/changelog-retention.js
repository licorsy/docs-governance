'use strict';

// Living documents keep only the N newest changelog entries in the body; the
// full history lives in git.
//
// This rule only exists because the opposite was measured: a file once had
// 28 changelog entries taking up ~31% of the file itself — more weight than
// the content it was supposed to carry.
//
// The count runs from the marker to the end of the contiguous list. The fixed
// closing line ("- Older entries: ...") is a list item but does NOT count as
// an entry — only lines matching `- v<digit>` count. This matters: counting
// the closing line would make every file at the cap fail by one.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');

function countChangelogEntries(content, marker) {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === marker);
  if (start === -1) return null;

  let count = 0;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('- ')) break;
    if (/^- v\d/.test(trimmed)) count += 1;
  }
  return count;
}

function scopedFiles(cfg) {
  const excludeFiles = new Set((cfg.exclude_files || []).map(toNative));
  const excluded = (f) =>
    excludeFiles.has(f) || (cfg.exclude_prefixes || []).some((p) => underPrefix(f, p));

  return (cfg.scope_dirs || [])
    .reduce((acc, d) => acc.concat(walkScoped(toNative(d))), [])
    .filter((f) => !excluded(f))
    .concat((cfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

function run(cfg) {
  const marker = cfg.marker || 'Changelog:';
  const max = cfg.max_entries == null ? 3 : cfg.max_entries;
  const files = scopedFiles(cfg);

  const findings = [];
  let checked = 0;

  for (const file of files) {
    const count = countChangelogEntries(fs.readFileSync(file, 'utf8'), marker);
    if (count === null) continue;
    checked += 1;
    if (count > max) {
      // `why` is deliberately NOT included here: the CLI already prints it
      // once in the rule's footer. Interpolating it in both places would fill
      // the output with the same paragraph per finding — and noisy output is
      // where nobody reads the output anymore.
      findings.push({
        file,
        messages: [`${count} changelog entries (retention cap is ${max}) - remove the oldest, removal-only`],
      });
    }
  }

  return {
    findings,
    failSummary: (n) => `${n} file(s) exceed the body-changelog retention cap.`,
    okSummary: `All ${checked} document(s) with a body changelog respect the newest-${max} retention cap.`,
  };
}

module.exports = { id: 'changelog-retention', run, countChangelogEntries, scopedFiles };
