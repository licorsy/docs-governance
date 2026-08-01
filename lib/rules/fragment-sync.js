'use strict';

// A canonical marked block of prose in one "source" file must exact-byte-match
// (after \r\n -> \n normalization) the same-id marked block in one or more
// "destination" files. Generalizes the `sync-destinations.js` pattern (exact
// string comparison, no heuristics, not shadow mode) from atomic frontmatter
// `covers:` id/version values to whole prose blocks delimited by
// `<!-- fragment:{id}:start/end -->` markers (`lib/text.js`'s
// `markedBlockLines`).
//
// Separate module from sync-destinations.js on purpose: the resolution
// mechanism differs (direct config-named files here, vs.
// sync-destinations.js's indirect frontmatter-`covers:`-id lookup via
// lib/corpus.js's buildIdIndex) — no shared code beyond what both already get
// from lib/walk.js / lib/text.js.
//
// Optional per-fragment `anchor: { file, text }`. A synced block is very often
// a RESTATEMENT of a rule whose full text lives somewhere else, under a
// specific heading. Byte-matching the copies against each other says nothing
// about whether the thing they quote still exists: renumber "## Step 10" in the
// manual and every copy stays perfectly in sync while all of them now cite a
// heading that is gone. The anchor is what catches that, and it is the reason
// this rule could not simply replace ai-assisted-sdd-template's bespoke
// check-adapter-sync.js until now.
//
// Declared in config rather than parsed out of the marker comment, because this
// config declares DATA. Reading `source=`/`anchor=` attributes off the markers
// would put a second, undocumented schema in the markup and make the engine
// parse it.

const fs = require('fs');
const { markedBlockLines } = require('../text');
const { toNative } = require('../walk');

// Returns a finding when the anchor is declared and does not resolve, null
// otherwise — including when no anchor is declared, which is the common case.
function checkAnchor(fragment) {
  const { id, anchor } = fragment;
  if (!anchor) return null;

  const { file, text } = anchor;
  if (!file || !text) {
    return { file: file || '', id, ok: false, message: `fragment "${id}": anchor needs both \`file\` and \`text\`` };
  }
  if (!fs.existsSync(file)) {
    return { file, id, ok: false, message: `${file}: anchor file does not exist (fragment "${id}")` };
  }
  if (!fs.readFileSync(file, 'utf8').includes(text)) {
    return { file, id, ok: false, message: `${file}: anchor "${text}" no longer occurs here (fragment "${id}" quotes it)` };
  }
  return null;
}

function checkFragment(fragment) {
  const { id, source, destinations } = fragment;

  if (!fs.existsSync(source)) {
    return [{ file: source, id, ok: false, message: `${source}: fragment source does not exist (fragment "${id}")` }];
  }

  const sourceBlock = markedBlockLines(fs.readFileSync(source, 'utf8'), id);
  if (!sourceBlock) {
    return [{ file: source, id, ok: false, message: `${source}: missing <!-- fragment:${id}:start/end --> markers (declared as source)` }];
  }

  // Independent of the destination comparison on purpose: a fragment can be
  // perfectly in sync across every copy AND cite a heading that no longer
  // exists. Reporting only one of the two would hide the other.
  const anchorFinding = checkAnchor(fragment);
  const anchorResults = anchorFinding ? [anchorFinding] : [];

  return anchorResults.concat((destinations || []).map((dest) => {
    if (!fs.existsSync(dest)) {
      return { file: dest, id, ok: false, message: `${dest}: fragment destination does not exist` };
    }
    const destBlock = markedBlockLines(fs.readFileSync(dest, 'utf8'), id);
    if (!destBlock) {
      return { file: dest, id, ok: false, message: `${dest}: missing <!-- fragment:${id}:start/end --> markers` };
    }
    if (destBlock.text !== sourceBlock.text) {
      return { file: dest, id, ok: false, message: `${dest}: fragment "${id}" does not match ${source} (block content differs)` };
    }
    return { file: dest, id, ok: true, message: `${dest}: fragment "${id}" matches ${source}` };
  }));
}

// Normalizes `/`-written config paths to the native separator, same as
// sync-destinations.js's `targets.map(toNative)` — needed both for correct
// cross-platform path handling and so `finding.file` matches the
// native-separator paths `--changed` compares against its staged-file set.
function normalizeFragment(fragment) {
  return {
    ...fragment,
    source: toNative(fragment.source),
    destinations: (fragment.destinations || []).map(toNative),
    // `anchor.file` is a config-written path like every other one here, so it
    // needs the same normalization — otherwise a forward-slash anchor path
    // reports a finding whose `file` never matches `--changed`'s staged set.
    ...(fragment.anchor ? { anchor: { ...fragment.anchor, file: toNative(fragment.anchor.file) } } : {}),
  };
}

function run(cfg) {
  const fragments = (cfg.fragments || []).map(normalizeFragment);
  const results = fragments.flatMap((f) => checkFragment(f));
  const findings = results.filter((r) => !r.ok);

  return {
    findings: findings.map((f) => ({ file: f.file, messages: [f.message] })),
    inlineMessages: true,
    failSummary: (n) => `${n} fragment(s) out of sync.`,
    okSummary: `All configured fragments (${fragments.length}) are in sync across their destinations.`,
    // used by any future status-reporting CLI subcommand, mirrors
    // sync-destinations.js's `all` field — not consumed by anything in this
    // task, but costs nothing to include and keeps the door open
    all: results,
  };
}

module.exports = { id: 'fragment_sync', run, checkFragment, checkAnchor };
