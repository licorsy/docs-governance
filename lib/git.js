'use strict';

// Generalizes the diff-against-a-boundary logic version-bump.js already had
// privately (lib/rules/version-bump.js's own changedMarkdownFiles): a single
// `changedFiles` that any caller can use to get the set of markdown files
// that changed relative to a boundary, without duplicating the git plumbing.
//
// Two ways to name the boundary — never both at once:
//   baseSha  — merge-base(baseSha, HEAD), for "everything this branch added
//              since it forked from develop" (same pattern version-bump uses).
//   since    — a `git log --since` expression, for "everything in the last
//              day/week", resolved to the parent of the oldest commit inside
//              that window so the result is one clean diff, not per-commit
//              noise.
// Neither given: abstains (returns null), same convention as version-bump.js.

const { execFileSync } = require('child_process');
const { toNative } = require('./walk');

// git's fixed empty-tree object id — valid as a diff endpoint in any repo,
// used when the window reaches back to the root commit (which has no parent
// to diff against).
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function diffAgainst(boundary) {
  return git(['diff', '--name-status', boundary, 'HEAD'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, file]) => file && file.endsWith('.md'))
    .map(([status, file]) => ({ status: status[0], file: toNative(file) }));
}

// The oldest commit reachable from HEAD whose date falls inside the window,
// diffed from its parent — so a window with several commits still produces
// one net status per file instead of one line per commit it touched.
function sinceBoundary(since) {
  const hashes = git(['log', `--since=${since}`, '--format=%H', 'HEAD']).trim();
  if (!hashes) return null;
  const oldest = hashes.split('\n').pop();
  const parent = git(['log', '-1', '--format=%P', oldest]).trim().split(' ')[0];
  return parent || EMPTY_TREE;
}

function changedFiles({ baseSha, since } = {}) {
  if (baseSha) {
    const mergeBase = git(['merge-base', baseSha, 'HEAD']).trim();
    return diffAgainst(mergeBase);
  }
  if (since) {
    const boundary = sinceBoundary(since);
    return boundary ? diffAgainst(boundary) : [];
  }
  return null;
}

module.exports = { changedFiles };
