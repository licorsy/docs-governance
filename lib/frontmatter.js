'use strict';

// Frontmatter and version parsing. Deliberately naive and dependency-free:
// reads `key: value` line by line, first occurrence wins. It's not a YAML
// parser and doesn't try to be — the schema is shallow by convention, and
// swapping this for a dependency would cost more than it solves.

function parseFrontmatter(content) {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) return null;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return null;
  const block = content.slice(0, end);
  const fields = {};
  for (const line of block.split(/\r?\n/).slice(1)) {
    const match = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (match) {
      const key = match[1];
      if (!(key in fields)) fields[key] = match[2].trim();
    }
  }
  return fields;
}

// `related: [a, b, c]` -> ['a','b','c']. YAML block format is deliberately
// unsupported: no target repository uses it, and supporting it without a YAML
// parser would invite silent false negatives.
function parseRelated(fields) {
  if (!fields || !fields.related) return [];
  const match = /^\[(.*)\]$/.exec(fields.related);
  if (!match) return [];
  return match[1].split(',').map((s) => s.trim()).filter(Boolean);
}

// `covers: { agent: "2.36", agent-identity: "1.6" }` -> { agent: '2.36', 'agent-identity': '1.6' }.
// Same spirit as `parseRelated`: deliberately naive parser, no YAML block
// support — no target repository needs it, and a full parser would invite a
// silent false negative in something nobody tested.
function parseCovers(fields) {
  if (!fields || !fields.covers) return {};
  const match = /^\{(.*)\}$/.exec(fields.covers);
  if (!match) return {};
  const out = {};
  const pairRe = /([\w-]+)\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = pairRe.exec(match[1])) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

// null = out of scope (no frontmatter or no version field).
function extractVersion(content) {
  const fields = parseFrontmatter(content);
  if (!fields || !fields.version) return null;
  return fields.version.replace(/^["']|["']$/g, '');
}

// Compares dotted versions ("3.10" > "3.9"). Returns 1/0/-1, or null when it
// can't be ordered.
//
// CAUTION, and this contradicts a comment in the original script this was
// extracted from: null does NOT happen whenever the version has a
// non-numeric suffix. `parseInt` consumes the leading digits, so "1.0-rc"
// becomes [1, 0] — same as "1.0-beta" and "1.0". It only returns null when a
// segment starts with no digit at all ("beta").
//
// Practical consequence: a version scheme with a suffix (1.0-beta -> 1.0-rc)
// reads as "no bump" and fails. That's acceptable for the target
// repositories, which use purely numeric versions — but it would be a false
// positive in any repository using pre-release suffixes, which is why this is
// written down here.
function compareVersions(a, b) {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  if (pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const va = pa[i] || 0;
    const vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

module.exports = { parseFrontmatter, parseRelated, parseCovers, extractVersion, compareVersions };
