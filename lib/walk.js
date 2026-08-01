'use strict';

// Two walking strategies, because personal-os's original checks used two —
// and exact parity was the acceptance criterion for the extraction.
//
//   walkScoped  — the primitive behind `scopedFiles` below, and callable
//                 directly by any rule that just needs one declared path
//                 walked (e.g. `declared-counts`'s per-entry `dir`), not the
//                 full scope_dirs/root_files/exclude_* shape. Don't enumerate
//                 callers here — grep the codebase for the current list,
//                 it has drifted stale in this comment before. Takes declared
//                 paths; accepts a file, a directory, or a nonexistent path
//                 (returns empty). Does NOT exclude by directory name.
//   walkTree    — used by internal-links. Walks the whole tree from a root,
//                 pruning by directory NAME at any level (this is how
//                 `reports`/`sessions` stayed out of link scope, at any
//                 depth).
//
// Both normalize to the native separator via path.join, so config written
// with `/` works on Windows.

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

// Normalizes a prefix written with `/` in config to the native separator, and
// tests whether `file` is under it. The prefix also matches its own path.
function underPrefix(file, prefix) {
  const native = prefix.split('/').join(path.sep);
  return file === native || file.startsWith(native + path.sep);
}

function toNative(p) {
  return p.split('/').join(path.sep);
}

// Shared by every rule that scopes via `scope_dirs` + `root_files`
// (frontmatter, facts, version-citations, changelog-retention, corpus's
// sync-destinations index): walk each scope dir, drop anything under
// `exclude_prefixes` or listed verbatim in `exclude_files`, then append
// `root_files` that actually exist. Kept in one place after `exclude_files`
// was found honoured in only one of five copies — the others silently
// ignored it.
function scopedFiles(cfg) {
  const excludeFiles = new Set((cfg.exclude_files || []).map(toNative));
  const excluded = (f) =>
    excludeFiles.has(f) || (cfg.exclude_prefixes || []).some((p) => underPrefix(f, p));

  return (cfg.scope_dirs || [])
    .reduce((acc, d) => acc.concat(walkScoped(toNative(d))), [])
    .filter((f) => !excluded(f))
    .concat((cfg.root_files || []).map(toNative).filter((f) => fs.existsSync(f)));
}

module.exports = { walkScoped, walkTree, underPrefix, toNative, scopedFiles };
