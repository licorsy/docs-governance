'use strict';

// Builds a reference graph over a given file set: forward edges (what a file
// cites) and reverse edges (who cites a file) — via markdown links
// (lib/rules/internal-links.js's resolvedLinks) and frontmatter `related:`
// ids (resolved the same way lib/rules/frontmatter.js resolves them: an id
// only counts if some file in the set declares it).
//
// Deliberately narrow: numbered-rule citations and dead-citations' filename/
// prefix-id patterns stay each rule's own concern — those are heuristic text
// matches, not a structured, reliably-resolvable reference, and a false edge
// here silently pulls unrelated documents into the incremental scope this
// graph exists to keep small.
//
// Only expands one hop (see expandWithReferrers below) — a document two hops
// from a change is exactly what the periodic `--full` pass exists to still
// catch, not something this graph tries to reach transitively.

const fs = require('fs');
const { resolvedLinks } = require('./rules/internal-links');
const { parseFrontmatter, parseRelated } = require('./frontmatter');

function collectIdToFile(files) {
  const idToFile = new Map();
  for (const file of files) {
    const fields = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    if (fields && fields.id) idToFile.set(fields.id, file);
  }
  return idToFile;
}

function buildReferenceGraph(files) {
  const known = new Set(files);
  const idToFile = collectIdToFile(files);
  const forward = new Map(files.map((f) => [f, new Set()]));
  const reverse = new Map(files.map((f) => [f, new Set()]));

  const addEdge = (from, to) => {
    if (from === to || !known.has(to)) return;
    forward.get(from).add(to);
    reverse.get(to).add(from);
  };

  for (const file of files) {
    for (const target of resolvedLinks(file)) addEdge(file, target);

    const fields = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    for (const id of parseRelated(fields)) {
      const target = idToFile.get(id);
      if (target) addEdge(file, target);
    }
  }

  return { forward, reverse };
}

// changed ∪ direct referrers of each changed file — one hop, not a
// transitive closure (see module comment above for why).
function expandWithReferrers(changed, graph) {
  const expanded = new Set(changed);
  for (const file of changed) {
    for (const referrer of graph.reverse.get(file) || []) {
      expanded.add(referrer);
    }
  }
  return [...expanded];
}

module.exports = { buildReferenceGraph, expandWithReferrers };
