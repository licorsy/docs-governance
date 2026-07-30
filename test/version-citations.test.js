'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkFile, resolveCitedPath } = require('../lib/rules/version-citations');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-version-citations-'));
}

function withCwd(dir, fn) {
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(cwd);
  }
}

function fm(version) {
  return `---\ntitle: "x"\nversion: "${version}"\n---\n\nbody\n`;
}

test('resolveCitedPath resolves a root-relative citation against cwd', () => {
  assert.strictEqual(resolveCitedPath('AGENTS.md', 'docs/prompts/009.md'), path.join('docs', 'prompts', '009.md'));
});

test('resolveCitedPath resolves a dot-relative citation against the citing file dir', () => {
  const dir = tmpRepo();
  withCwd(dir, () => {
    assert.strictEqual(resolveCitedPath('state/tasks.md', '../docs/RUNBOOK.md'), path.join('docs', 'RUNBOOK.md'));
  });
});

test('checkFile flags a stale version citation', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/target.md'), fm('2.0'));
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `docs/target.md` v1.9 para detalhes.');

  withCwd(dir, () => {
    const findings = checkFile('citer.md', {});
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0], /cites docs\/target\.md as v1\.9, but its real version is v2\.0/);
  });
});

test('checkFile is silent when the cited version matches', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/target.md'), fm('2.0'));
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `docs/target.md` v2.0 para detalhes.');

  withCwd(dir, () => {
    const findings = checkFile('citer.md', {});
    assert.strictEqual(findings.length, 0);
  });
});

test('checkFile ignores a citation to a file that does not exist (not this rule\'s job)', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `docs/ghost.md` v1.0 para detalhes.');
  withCwd(dir, () => {
    const findings = checkFile('citer.md', {});
    assert.strictEqual(findings.length, 0);
  });
});

test('checkFile respects the exempt predicate (inside changelog block)', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/target.md'), fm('2.0'));
  fs.writeFileSync(
    path.join(dir, 'citer.md'),
    ['Changelog:', '', '- v1.0: ver `docs/target.md` v1.9 na época.', '', '## fim'].join('\n'),
  );

  withCwd(dir, () => {
    const findings = checkFile('citer.md', { inside_changelog_block: true });
    assert.strictEqual(findings.length, 0);
  });
});

test('checkFile ignores an open-ended threshold citation ("v4.0+" means "since", not "is at")', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/target.md'), fm('4.7'));
  fs.writeFileSync(path.join(dir, 'citer.md'), 'sujeito ao teto do fluxo (`docs/target.md` v4.0+).');

  withCwd(dir, () => {
    const findings = checkFile('citer.md', {});
    assert.strictEqual(findings.length, 0);
  });
});

test('checkFile ignores a historical multi-version enumeration ("v1.6/v1.9/v1.17")', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state/tasks.md'), fm('1.77'));
  fs.writeFileSync(path.join(dir, 'citer.md'), 'fricção recorrente, ver `state/tasks.md` v1.6/v1.9/v1.17.');

  withCwd(dir, () => {
    const findings = checkFile('citer.md', {});
    assert.strictEqual(findings.length, 0);
  });
});

test('checkFile handles a relative citation with ../', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/RUNBOOK.md'), fm('3.31'));
  fs.writeFileSync(path.join(dir, 'state/tasks.md'), 'ver `../docs/RUNBOOK.md` v3.30 para o passo a passo.');

  withCwd(dir, () => {
    const findings = checkFile('state/tasks.md', {});
    assert.strictEqual(findings.length, 1);
    assert.match(findings[0], /v3\.30, but its real version is v3\.31/);
  });
});
