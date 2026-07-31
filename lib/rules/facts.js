'use strict';

// A "fact" is an atomic value the repository asserts in prose in more than
// one place, with no single source — "5 routines", "05:00", "~2,867
// tokens". Born from cause C4 of the `docgov` diagnosis
// (`personal-os/local-notes/030`): the same fact hard-coded in prose across
// 10+ files, with nothing keeping them in sync when the fact changes.
//
// Two independent checks per fact, each optional:
//
//   required_in  — does the file declare the CURRENT value of the fact,
//                  anywhere in the file (does not go through the exemption
//                  predicate — see the comment on `checkRequired`)? A fixed,
//                  small list of file+pattern — cheap, no false positives,
//                  because the config author chooses exactly where to check.
//   forbidden    — does the OLD value of the fact appear anywhere in scope,
//                  outside an exempt context? (a broad scan — a secondary
//                  net, more prone to false positives, hence always subject
//                  to the exemption predicate first).
//
// Shadow mode — see `bin/docgov.js`: never fails the process on its own.

const fs = require('fs');
const { walkScoped, underPrefix, toNative } = require('../walk');
const { isHistoricalPath, exemptLineSet } = require('../exempt');

// `required_in` does NOT go through the exemption predicate — deliberately,
// and unlike `checkForbidden` below. A real finding when validating against
// the `personal-os` corpus (07/29): `AGENTS.md` states "there are 4
// routines... that existed then" and, in the SAME sentence, "there are 5
// routines... today" — per-LINE exemption marked the whole line as historical
// (because of the first part) and hid the second, producing a false "the
// file doesn't state the current fact" when it does. Asking "does this file
// mention X anywhere?" doesn't carry the same false-positive risk as asking
// "is every place that mentions something like X a current claim?" — the
// exemption exists for the second question (`checkForbidden`), not the
// first.
function checkRequired(fact) {
  const findings = [];
  for (const { file, pattern } of fact.required_in || []) {
    if (!fs.existsSync(file)) {
      findings.push(`${file}: expected to state fact "${fact.id}" (${fact.value}) but the file does not exist`);
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    if (!pattern.test(content)) {
      findings.push(`${file}: does not state fact "${fact.id}" (expected to match ${pattern})`);
    }
  }
  return findings;
}

function scopedFiles(scopeCfg) {
  const files = (scopeCfg.scope_dirs || []).reduce((acc, d) => acc.concat(walkScoped(toNative(d))), []);
  const excluded = (f) => (scopeCfg.exclude_prefixes || []).some((p) => underPrefix(f, p));
  return files
    .filter((f) => !excluded(f))
    .concat((scopeCfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

function checkForbidden(fact, files, exemptCfg) {
  const findings = [];
  for (const file of files) {
    if (isHistoricalPath(file, exemptCfg.historical_paths)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const exempt = exemptLineSet(content, exemptCfg);
    lines.forEach((line, i) => {
      if (exempt.has(i)) return;
      for (const pattern of fact.forbidden || []) {
        if (pattern.test(line)) {
          findings.push(`${file}:${i + 1}: matches forbidden (stale) form of fact "${fact.id}": "${line.trim()}"`);
        }
      }
    });
  }
  return findings;
}

function run(cfg) {
  const entries = cfg.entries || [];
  const exemptCfg = cfg.exempt || {};
  const files = scopedFiles(cfg);

  const messages = [];
  for (const fact of entries) {
    messages.push(...checkRequired(fact));
    if (fact.forbidden && fact.forbidden.length) {
      messages.push(...checkForbidden(fact, files, exemptCfg));
    }
  }

  return {
    findings: messages.map((m) => ({ file: '', messages: [m] })),
    inlineMessages: true,
    failSummary: (n) => `${n} fact violation(s) found.`,
    okSummary: `All ${entries.length} declared fact(s) check out.`,
  };
}

module.exports = { id: 'facts', run, checkRequired, checkForbidden, scopedFiles };
