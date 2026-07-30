#!/usr/bin/env node

'use strict';

// docgov — verificador mecânico de consistência documental.
//
// Resolve caminhos por `__dirname` (para si mesmo) e `process.cwd()` (para o
// repositório auditado). NUNCA referencia ${CLAUDE_PLUGIN_ROOT}: essa variável
// só existe do lado do plugin do Claude Code e não existe no CI. É essa
// separação que faz o MESMO arquivo servir aos três consumidores — pre-commit,
// GitHub Actions e sessão interativa.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { load } = require('../lib/config');
const { walkScoped } = require('../lib/walk');
const { parseFrontmatter } = require('../lib/frontmatter');

const VERSION = '1.1.2';

const RULES = [
  require('../lib/rules/frontmatter'),
  require('../lib/rules/internal-links'),
  require('../lib/rules/changelog-retention'),
  require('../lib/rules/version-bump'),
  // Fase 2 (personal-os/local-notes/030): regras de conteúdo, shadow mode até
  // precisão comprovada. Config de cada uma vem vazia (`entries: []`) por
  // padrão — sem entradas declaradas pelo repositório, cada uma roda e não
  // acha nada, o que é diferente de estar desabilitada.
  require('../lib/rules/declared-counts'),
  require('../lib/rules/sum-decomposition'),
  require('../lib/rules/facts'),
  require('../lib/rules/version-citations'),
  // Fase 3: covers: no frontmatter vs. version: real da fonte.
  require('../lib/rules/sync-destinations'),
];

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      if (inline !== undefined) args.flags[k] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) { args.flags[k] = argv[i + 1]; i += 1; }
      else args.flags[k] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function stagedMarkdown() {
  try {
    return new Set(
      execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' })
        .split('\n')
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.split('/').join(path.sep)),
    );
  } catch {
    return null;
  }
}

function cmdCheck(args) {
  const cwd = process.cwd();
  let loaded;
  try {
    loaded = load(cwd, args.flags.config);
  } catch (err) {
    console.error(`docgov: ${err.message}`);
    return 2;
  }

  const { config, warnings } = loaded;
  for (const w of warnings) console.error(`docgov: warning: ${w}`);

  const only = args.flags.rule ? String(args.flags.rule).split(',') : null;
  const staged = args.flags.changed ? stagedMarkdown() : null;
  if (args.flags.changed && staged === null) {
    console.error('docgov: --changed needs a git repository with a staged set; running full check');
  }

  let failed = 0;

  for (const rule of RULES) {
    const ruleCfg = (config.rules || {})[rule.id] || {};
    if (ruleCfg.enabled === false) continue;
    if (only && !only.includes(rule.id)) continue;

    // Regra em shadow mode nunca roda no pre-commit (`--changed`) e nunca
    // reprova o processo (`check`/CI) — só imprime, prefixado, o que já teria
    // achado. É a Fase 2 do plano (`personal-os/local-notes/030`): promoção a
    // bloqueante é decisão humana, depois de medir precisão num corpus real,
    // nunca automática por causa deste código.
    const shadow = !!ruleCfg.shadow;
    if (shadow && args.flags.changed) continue;
    const tag = shadow ? '[shadow] ' : '';

    const ctx = { cwd, baseSha: args.flags['base-sha'] };
    let result;
    try {
      result = rule.run(ruleCfg, ctx);
    } catch (err) {
      console.error(`\n${tag}[${rule.id}] rule crashed: ${err.message}`);
      if (!shadow) failed += 1;
      continue;
    }

    if (result.skipped) {
      console.log(`${tag}[${rule.id}] skipped — ${result.reason}`);
      continue;
    }

    let findings = result.findings;
    if (staged) findings = findings.filter((f) => staged.has(f.file));

    if (findings.length === 0) {
      // Em --changed a contagem do resumo é do repositório inteiro, não do que
      // foi filtrado; dizer "tudo ok" com um número que não corresponde ao
      // escopo relatado enganaria. Por isso o rótulo explícito.
      console.log(tag + (staged ? `[${rule.id}] no findings in staged files` : result.okSummary));
      continue;
    }

    if (!shadow) failed += 1;
    for (const finding of findings) {
      if (result.inlineMessages) {
        for (const m of finding.messages) console.error(tag + m);
      } else {
        console.error('\n' + tag + finding.file);
        for (const m of finding.messages) console.error('  - ' + m);
      }
    }
    console.error('\n' + tag + result.failSummary(findings.length));
    if (ruleCfg.why) console.error(`  why this rule exists: ${ruleCfg.why}`);
  }

  return failed > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// sync-status — relatório humano da regra `sync_destinations`. Existe como
// comando próprio (em vez de só rodar via `check --rule sync_destinations`)
// porque quem invoca isto (o passo 8 da Revisão Semanal do `personal-os`)
// quer o estado de CADA destino, inclusive o que está OK — `check` só imprime
// o que falhou.

function cmdSyncStatus() {
  const cwd = process.cwd();
  let loaded;
  try {
    loaded = load(cwd);
  } catch (err) {
    console.error(`docgov: ${err.message}`);
    return 2;
  }

  const { config } = loaded;
  const cfg = (config.rules || {}).sync_destinations || {};
  if (!(cfg.targets || []).length) {
    console.log('sync-status: no targets configured (rules.sync_destinations.targets is empty)');
    return 0;
  }

  const rule = require('../lib/rules/sync-destinations');
  const result = rule.run(cfg);

  let anyStale = false;
  for (const r of result.all) {
    console.log(r.ok ? `OK    ${r.message}` : `STALE ${r.message}`);
    if (!r.ok) anyStale = true;
  }

  return anyStale ? 1 : 0;
}

// ---------------------------------------------------------------------------
// init — descobre a forma do repositório em vez de perguntar. Zero token: é
// `fs` e `git log`.

function discover(cwd) {
  const skip = new Set(['.git', 'node_modules', '.vscode', '.github', 'local-notes', 'dist', 'build']);
  const dirs = fs.readdirSync(cwd, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !skip.has(e.name))
    .map((e) => e.name);

  const density = [];
  for (const d of dirs) {
    const files = walkScoped(d);
    if (files.length === 0) continue;
    const withFm = files.filter((f) => parseFrontmatter(fs.readFileSync(f, 'utf8'))).length;
    density.push({ dir: d, files: files.length, withFm });
  }
  // Um diretório entra no escopo quando a maioria dos seus .md já carrega
  // frontmatter — ou seja, quando a convenção já vale ali de fato.
  const scopeDirs = density.filter((d) => d.withFm > d.files / 2).map((d) => d.dir);

  const rootFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md'].filter((f) => fs.existsSync(path.join(cwd, f)));

  // Marker de changelog realmente em uso, medido em vez de suposto.
  const markers = ['Changelog:', 'Changelog of this document:'];
  const counts = markers.map((m) => {
    let n = 0;
    for (const d of scopeDirs) {
      for (const f of walkScoped(d)) {
        if (fs.readFileSync(f, 'utf8').split(/\r?\n/).some((l) => l.trim() === m)) n += 1;
      }
    }
    return { marker: m, n };
  }).sort((a, b) => b.n - a.n);

  // Candidatos a histórico congelado: diretórios cujo conteúdo não é tocado há
  // muitos commits. Proposta, não decisão — init comenta, não ativa.
  let stale = [];
  try {
    const recent = execFileSync('git', ['log', '-n', '80', '--name-only', '--pretty=format:'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    const touched = new Set(recent.map((f) => f.split('/')[0]));
    stale = scopeDirs.flatMap((d) => {
      const subs = fs.existsSync(d)
        ? fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => `${d}/${e.name}`)
        : [];
      return subs.filter((s) => !recent.some((f) => f.startsWith(s + '/')));
    });
    void touched;
  } catch { /* sem git: sem proposta de histórico */ }

  return { scopeDirs, rootFiles, marker: counts[0] && counts[0].n > 0 ? counts[0].marker : 'Changelog:', stale };
}

function renderConfig(d) {
  const list = (a) => `[${a.map((x) => `'${x}'`).join(', ')}]`;
  return `'use strict';

// Gerado por \`docgov init\`. Ajuste e comite.
//
// Esta config declara DADOS, não lógica. Se você precisar de uma checagem que
// não existe, ela vai para o motor (licorsy/docs-governance), não para cá —
// senão o motor é forkado por config e a duplicação volta pela porta dos fundos.
//
// Toda regra aceita um campo \`why\`, impresso quando ela falha. Preencha com o
// defeito REAL que motivou a regra. Regra sem defeito real não deveria existir.

module.exports = {
  engine: '^1',

  rules: {
    frontmatter: {
      scope_dirs: ${list(d.scopeDirs)},
      root_files: ${list(d.rootFiles)},
      exclude_prefixes: [],${d.stale.length ? `\n      // candidatos a histórico congelado detectados: ${d.stale.join(', ')}` : ''}
      // ids destes contam para resolver \`related:\`, mas os arquivos não são cobrados
      id_only_sources: [],
      required: ['title', 'doc_type', 'description', 'status', 'version', 'created', 'updated', 'language'],
      status_enum: ['draft', 'active', 'deprecated', 'archived'],
      doc_type_enum: null, // null = não cobra o enum; liste os tipos quando quiser cobrar
      date_fields: ['created', 'updated'],
    },

    'internal-links': {
      // poda por NOME de diretório, em qualquer profundidade
      exclude_dir_names: ['.git', 'node_modules', '.vscode', 'local-notes'],
      // links que nunca devem ser cobrados (ex.: alvo gitignored)
      skip_link_patterns: [],
    },

    'changelog-retention': {
      scope_dirs: ${list(d.scopeDirs)},
      root_files: ${list(d.rootFiles)},
      exclude_prefixes: [],
      exclude_files: [],
      marker: '${d.marker}',
      max_entries: 3,
      why: null,
    },

    'version-bump': {
      enabled: true,
    },

    // ---- Fase 2: regras de conteúdo, shadow mode até precisão comprovada ---
    // Cada uma fica sem entradas até você declarar uma — sem entradas, a
    // regra roda e não acha nada (dado ausente, não erro). Exemplos:
    //
    // declared_counts: { entries: [
    //   { file: 'docs/index.md', pattern: /(\\d+) prompts no total/, dir: 'docs/prompts' },
    // ] },
    // sum_decomposition: { entries: [
    //   { file: 'docs/index.md', pattern: /(\\d+) \\+ (\\d+) \\+ (\\d+) = (\\d+)/ },
    // ] },
    // facts: { scope_dirs: ${list(d.scopeDirs)}, entries: [
    //   { id: 'slug', value: '5', required_in: [{ file: 'README.md', pattern: /5 rotinas/ }], forbidden: [/4 rotinas/] },
    // ] },
    // version_citations: { scope_dirs: ${list(d.scopeDirs)}, root_files: ${list(d.rootFiles)} },

    // ---- Fase 3: covers: no frontmatter do destino vs. version: da fonte ---
    // sync_destinations: {
    //   targets: ['docs/prompts/006-project.md'],
    //   scope_dirs: ${list(d.scopeDirs)}, root_files: ${list(d.rootFiles)},
    // },
  },
};
`;
}

const PRE_COMMIT = `#!/bin/sh
# instalado por \`docgov init --hook\`
# Falso positivo aqui é pior que falso negativo: ensina a usar --no-verify.
# Se este hook acusar algo errado, CONSERTE A REGRA ou APAGUE A REGRA.
exec node "$DOCGOV_BIN" check --changed
`;

function installHook(cwd) {
  const hookDir = path.join(cwd, '.git', 'hooks');
  if (!fs.existsSync(hookDir)) {
    console.error('docgov: no .git/hooks — skipping hook install');
    return false;
  }
  const hookPath = path.join(hookDir, 'pre-commit');
  const bin = path.join(__dirname, 'docgov.js');
  fs.writeFileSync(hookPath, PRE_COMMIT.replace('$DOCGOV_BIN', bin.split(path.sep).join('/')), 'utf8');
  try { fs.chmodSync(hookPath, 0o755); } catch { /* Windows: sem bit de execução */ }
  console.log(`installed .git/hooks/pre-commit -> ${bin}`);
  return true;
}

function cmdInit(args) {
  const cwd = process.cwd();
  const target = path.join(cwd, '.docgov.config.js');

  if (fs.existsSync(target) && !args.flags.force) {
    // Config já existe: `--hook` sozinho ainda é um pedido legítimo — instalar
    // o hook num repositório já configurado é o caso comum, e forçar --force
    // para isso significaria sobrescrever uma config escrita à mão só para
    // ganhar um hook.
    if (args.flags.hook) {
      console.log('.docgov.config.js already exists — keeping it');
      installHook(cwd);
      return 0;
    }
    console.error('docgov: .docgov.config.js already exists (use --force to overwrite, or --hook to only install the hook)');
    return 2;
  }

  const d = discover(cwd);
  if (d.scopeDirs.length === 0) {
    console.error('docgov: no directory found where most .md files carry frontmatter.');
    console.error('  docgov governs a frontmatter convention; there is nothing to govern here yet.');
    return 2;
  }

  fs.writeFileSync(target, renderConfig(d), 'utf8');
  console.log(`wrote .docgov.config.js`);
  console.log(`  scope: ${d.scopeDirs.join(', ')}`);
  console.log(`  root files: ${d.rootFiles.join(', ') || '(none)'}`);
  console.log(`  changelog marker: "${d.marker}"`);
  if (d.stale.length) console.log(`  possible frozen history (commented, not enabled): ${d.stale.join(', ')}`);

  if (args.flags.hook) installHook(cwd);

  return 0;
}

const USAGE = `docgov ${VERSION} — mechanical documentation-consistency checks

  docgov check       [--config <path>] [--changed] [--base-sha <sha>] [--rule <id,...>]
  docgov init        [--hook] [--force]
  docgov sync-status

  check       run every enabled rule; exit 1 on findings, 2 on setup error.
              Rules with \`shadow: true\` in config never fail the process and
              never run under --changed; findings print prefixed "[shadow]"
  --changed   report only findings in staged files (for pre-commit)
  --base-sha  base commit for the version-bump rule (or BASE_SHA env var)
  init        generate .docgov.config.js by discovering this repository's shape
  --hook      also install .git/hooks/pre-commit
  sync-status per-target report of rules.sync_destinations (OK and STALE both
              printed, not just failures); exit 1 if any target is stale
`;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];

  if (args.flags.version) { console.log(VERSION); return 0; }
  if (!cmd || args.flags.help) { console.log(USAGE); return cmd ? 0 : 2; }

  if (cmd === 'check') return cmdCheck(args);
  if (cmd === 'init') return cmdInit(args);
  if (cmd === 'sync-status') return cmdSyncStatus();

  console.error(`docgov: unknown command "${cmd}"\n\n${USAGE}`);
  return 2;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, parseArgs, discover, VERSION };
