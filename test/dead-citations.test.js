'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../lib/rules/dead-citations');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'docgov-dead-citations-'));
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

function baseCfg(overrides) {
  return Object.assign(
    {
      scope_dirs: ['.'],
      root_files: [],
      exclude_prefixes: [],
      exempt: {},
      patterns: [],
    },
    overrides,
  );
}

test('filename kind: true positive - citation resolves to an existing file', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/real.md'), '# real\n');
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `docs/real.md` para detalhes.');

  withCwd(dir, () => {
    const result = run(baseCfg({ patterns: [{ id: 'md-files', kind: 'filename' }] }));
    assert.strictEqual(result.findings.length, 0);
  });
});

test('filename kind: true negative - citation to a missing file is flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `docs/missing.md` para detalhes.');

  withCwd(dir, () => {
    const result = run(baseCfg({ patterns: [{ id: 'md-files', kind: 'filename' }] }));
    assert.strictEqual(result.findings.length, 1);
    const msg = result.findings[0].messages[0];
    assert.match(msg, /docs\/missing\.md/);
    assert.match(msg, /"md-files"/);
    assert.strictEqual(result.findings[0].file, '');
  });
});

test('filename kind: dot-relative resolution - resolves against citing file dir, existing file', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/RUNBOOK.md'), '# runbook\n');
  fs.writeFileSync(path.join(dir, 'state/tasks.md'), 'ver `../docs/RUNBOOK.md` para o passo a passo.');

  withCwd(dir, () => {
    const result = run(baseCfg({ scope_dirs: ['state'], patterns: [{ id: 'md-files', kind: 'filename' }] }));
    assert.strictEqual(result.findings.length, 0);
  });
});

test('filename kind: dot-relative resolution - correctly flags a missing dot-relative citation', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state/tasks.md'), 'ver `../docs/GHOST.md` para o passo a passo.');

  withCwd(dir, () => {
    const result = run(baseCfg({ scope_dirs: ['state'], patterns: [{ id: 'md-files', kind: 'filename' }] }));
    assert.strictEqual(result.findings.length, 1);
    assert.match(result.findings[0].messages[0], /docs\/GHOST\.md/);
  });
});

test('prefix-id kind: true positive - prompt-042 resolves to docs/prompts/042-something.md', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/042-something.md'), '# 042\n');
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `prompt-042` para detalhes.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        patterns: [{ id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('prefix-id kind: true negative - prompt-099 has no matching file under dir', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/042-something.md'), '# 042\n');
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `prompt-099` para detalhes.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        patterns: [{ id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 }],
      }),
    );
    assert.strictEqual(result.findings.length, 1);
    const msg = result.findings[0].messages[0];
    assert.match(msg, /prompt-099/);
    assert.match(msg, /"prompts"/);
  });
});

test('prefix-id kind: missing dir entirely - index is empty, citation flagged, no crash', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `prompt-042` para detalhes.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        patterns: [{ id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 }],
      }),
    );
    assert.strictEqual(result.findings.length, 1);
    assert.match(result.findings[0].messages[0], /prompt-042/);
  });
});

test('exemption - fenced code block: a dead citation only inside a fence is not flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'citer.md'),
    ['exemplo:', '', '```', 'ver `docs/missing.md` para detalhes.', '```', ''].join('\n'),
  );

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        exempt: { fenced_code: true },
        patterns: [{ id: 'md-files', kind: 'filename' }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('exemption - historical path: dead citation in a file under historical_paths is not flagged', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'logs/sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'logs/sessions/old.md'), 'ver `docs/missing.md` para detalhes.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        scope_dirs: ['logs'],
        exempt: { historical_paths: ['logs/sessions'] },
        patterns: [{ id: 'md-files', kind: 'filename' }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('exemption - target_allowlist: filename-kind citation matching an exact-string target is not flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `scaffold/future-module.md` para detalhes.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        exempt: { target_allowlist: ['scaffold/future-module.md'] },
        patterns: [{ id: 'md-files', kind: 'filename' }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('exemption - target_allowlist: prefix-id citation matching a target is not flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `prompt-999` para detalhes.');

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        exempt: { target_allowlist: ['prompt-999'] },
        patterns: [{ id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 }],
      }),
    );
    assert.strictEqual(result.findings.length, 0);
  });
});

test('exemption - target_allowlist: exempts by target, not by line - an unlisted citation sharing the line is still flagged', () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, 'citer.md'),
    'ver `scaffold/future-module.md` e também `docs/missing.md` para detalhes.',
  );

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        exempt: { target_allowlist: ['scaffold/future-module.md'] },
        patterns: [{ id: 'md-files', kind: 'filename' }],
      }),
    );
    assert.strictEqual(result.findings.length, 1);
    assert.match(result.findings[0].messages[0], /docs\/missing\.md/);
  });
});

test('config validation: an unrecognized pattern kind throws instead of silently finding nothing', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `docs/real.md` para detalhes.');

  withCwd(dir, () => {
    assert.throws(
      () => run(baseCfg({ patterns: [{ id: 'typo', kind: 'file-name' }] })),
      /unknown pattern kind "file-name"/,
    );
  });
});

test('config validation: a prefix-id pattern missing "digits" throws instead of matching nothing', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'citer.md'), 'ver `prompt-042` para detalhes.');

  withCwd(dir, () => {
    assert.throws(
      () =>
        run(
          baseCfg({
            patterns: [{ id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts' }],
          }),
        ),
      /"digits" is missing or not a number/,
    );
  });
});

test('both pattern kinds active simultaneously in the same file do not interfere', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'docs/prompts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs/prompts/042-something.md'), '# 042\n');
  fs.writeFileSync(path.join(dir, 'docs/real.md'), '# real\n');
  fs.writeFileSync(
    path.join(dir, 'citer.md'),
    [
      'ver `docs/real.md` para detalhes.',
      'ver `docs/missing.md` para detalhes.',
      'ver `prompt-042` para detalhes.',
      'ver `prompt-099` para detalhes.',
    ].join('\n'),
  );

  withCwd(dir, () => {
    const result = run(
      baseCfg({
        patterns: [
          { id: 'md-files', kind: 'filename' },
          { id: 'prompts', kind: 'prefix-id', prefix: 'prompt', dir: 'docs/prompts', digits: 3 },
        ],
      }),
    );
    assert.strictEqual(result.findings.length, 2);
    const messages = result.findings.map((f) => f.messages[0]);
    assert.ok(messages.some((m) => /docs\/missing\.md/.test(m) && /"md-files"/.test(m)));
    assert.ok(messages.some((m) => /prompt-099/.test(m) && /"prompts"/.test(m)));
  });
});
