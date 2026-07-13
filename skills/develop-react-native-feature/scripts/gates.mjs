#!/usr/bin/env node
/**
 * gates.mjs
 * Run the project's gate commands (typecheck / lint / test, optionally format
 * and e2e) in one granted invocation, logging each to the cache dir and
 * printing a PASS/FAIL summary. Run from the project root.
 *
 * Why a script: the agent runs ONE allowlisted command —
 *   node .claude/skills/develop-react-native-feature/scripts/gates.mjs
 * — instead of `npx jest … > log 2>&1; echo "EXIT:$?"`. All the shell
 * orchestration (redirection, exit capture, sequencing) happens here in Node,
 * where Claude Code's command-injection / redirect heuristics never apply.
 *
 * Subprocesses spawned here are NOT re-checked against the allow list — only
 * the `node …/gates.mjs` the agent typed is — so gate commands pinned in
 * gates.json (a native build, a detox suite) run without their own standing
 * grants.
 *
 * The default gates are JS-level only: typecheck, lint, test. Native iOS and
 * Android builds are deliberately NOT default gates — they are slow, and the
 * Phase 4 device helper builds both platforms anyway, so a broken native build
 * still blocks the loop. A project that wants native builds (or detox/maestro
 * e2e) as merge gates pins exact commands in
 * .cache/develop-react-native-feature/gates.json — either the array form
 *   [{ "name": "...", "command": "..." }]
 * or the object form
 *   { "gates": [{ "name": "...", "command": "..." }], "coverageThreshold": 80 }
 * — which overrides detection entirely.
 *
 * Derivation (package manager from the lockfile):
 * - typecheck: the `typecheck`/`type-check` script when present; else a
 *   tsconfig.json runs `npx tsc --noEmit` (typescript dep missing = FAIL with
 *   an install hint, not a skip).
 * - lint: the `lint` script when present; else an ESLint config runs
 *   `npx eslint .` (config present but eslint missing = FAIL with a hint).
 * - test: the `test` script (a bare-jest watch script gets --watchAll=false
 *   appended; vitest without --run gets --run).
 * - format: only via an explicit check-shaped script (format:check,
 *   prettier:check, or a format script carrying --check) — prettier configs
 *   ship unenforced in every RN template, so config presence alone is
 *   deliberately not a trigger here.
 *
 * Usage:
 *   node …/gates.mjs                     # typecheck, lint, test (as configured)
 *   node …/gates.mjs --coverage          # test also measures (and enforces) coverage
 *   node …/gates.mjs --e2e               # also run the e2e suite when one is scripted
 *   node …/gates.mjs --only lint,test
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CACHE_DIR = '.cache/develop-react-native-feature';

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// --- Flags ---
const args = process.argv.slice(2);
const useCoverage = args.includes('--coverage');
const withE2e = args.includes('--e2e');
const flagValue = (name) => {
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.split('=')[1] : null;
};
const only = flagValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

// --- Detect the project so the gates fit whatever app is in use ---
const pkg = readJSON('package.json');
const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
const scripts = pkg?.scripts ?? {};

const pm = existsSync('pnpm-lock.yaml') ? 'pnpm'
  : existsSync('yarn.lock') ? 'yarn'
    : (existsSync('bun.lockb') || existsSync('bun.lock')) ? 'bun'
      : 'npm';
// How to run a package.json script, and how to append extra args to it
// (npm and bun forward extra args only after a `--`; yarn and pnpm pass
// them straight through).
const runScript = (name, extra = '') => {
  const sep = extra && (pm === 'npm' || pm === 'bun') ? ' --' : '';
  const base = pm === 'yarn' ? `yarn ${name}` : `${pm} run ${name}`;
  return `${base}${sep}${extra ? ` ${extra}` : ''}`;
};
const binInstalled = (bin) => existsSync(join('node_modules', '.bin', bin));

const eslintConfig = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
  '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', '.eslintrc',
].find((p) => existsSync(p));
const hasTsconfig = existsSync('tsconfig.json');

// --- Override file (wins entirely when it lists gates) ---
const override = readJSON(join(CACHE_DIR, 'gates.json'));
const overrideGates = Array.isArray(override) ? override : override?.gates;
const coverageThreshold =
  (!Array.isArray(override) && typeof override?.coverageThreshold === 'number')
    ? override.coverageThreshold
    : null;

// --- Build the ordered gate list ---
// A gate is { name, command } or { name, skip: "<reason>" } (reported, never fails).
let gates;

if (Array.isArray(overrideGates) && overrideGates.length) {
  gates = overrideGates.map((g) => ({ name: g.name, command: g.command }));
} else if (pkg && (deps['react-native'] || deps.expo)) {
  gates = [];

  // typecheck
  const typecheckScript = ['typecheck', 'type-check'].find((s) => scripts[s]);
  if (typecheckScript) {
    gates.push({ name: 'typecheck', command: runScript(typecheckScript) });
  } else if (hasTsconfig) {
    // Config present but binary missing is a FAIL, not a skip: the project made
    // the check a gate, so a fresh checkout must install the tool, not merge
    // around it.
    gates.push(
      binInstalled('tsc')
        ? { name: 'typecheck', command: 'npx tsc --noEmit' }
        : { name: 'typecheck', command: 'echo "tsconfig.json present but typescript is not installed — add it as a devDependency and reinstall" && exit 1' },
    );
  }

  // lint
  if (scripts.lint) {
    gates.push({ name: 'lint', command: runScript('lint') });
  } else if (eslintConfig) {
    gates.push(
      binInstalled('eslint')
        ? { name: 'lint', command: 'npx eslint .' }
        : { name: 'lint', command: `echo "ESLint config (${eslintConfig}) present but eslint is not installed — add it as a devDependency and reinstall" && exit 1` },
    );
  }

  // format — only an explicit check-shaped script; prettier config presence is
  // deliberately not a trigger (RN templates ship one unenforced).
  const formatScript = ['format:check', 'prettier:check'].find((s) => scripts[s])
    ?? (scripts.format && /(^|\s)(--check|-c)(\s|$)/.test(scripts.format) ? 'format' : null);
  if (formatScript) gates.push({ name: 'format', command: runScript(formatScript) });

  // test
  if (scripts.test) {
    // Guard watch modes so the gate terminates: a jest script carrying a watch
    // flag gets --watchAll=false appended; vitest without --run gets --run.
    let extra = '';
    if (/\bjest\b/.test(scripts.test) && /--watch/.test(scripts.test)) extra = '--watchAll=false';
    if (/\bvitest\b/.test(scripts.test) && !/\b(--run|run)\b/.test(scripts.test)) extra = '--run';
    if (useCoverage) {
      if (scripts['test:coverage']) {
        gates.push({ name: 'test', command: runScript('test:coverage') });
      } else {
        gates.push({ name: 'test', command: runScript('test', [extra, '--coverage'].filter(Boolean).join(' ')) });
      }
    } else {
      gates.push({ name: 'test', command: runScript('test', extra) });
    }
  }

  if (!gates.length) {
    console.error('[gates] No gates derivable: no typecheck/lint/test scripts, tsconfig.json, or ESLint config — pin commands in .cache/develop-react-native-feature/gates.json.');
    process.exit(1);
  }
} else {
  console.error('[gates] No package.json with a react-native or expo dependency in the working directory — run from the project root (or pin commands in gates.json).');
  process.exit(1);
}

if (withE2e && !gates.some((g) => g.name === 'e2e')) {
  if (scripts['test:e2e']) {
    gates.push({ name: 'e2e', command: runScript('test:e2e') });
  } else {
    gates.push({ name: 'e2e', skip: 'no test:e2e script — pin a detox/maestro command in gates.json' });
  }
}

if (only) gates = gates.filter((g) => only.includes(g.name));

if (!gates.length) {
  console.error('[gates] No gates selected.');
  process.exit(1);
}

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// --- Run each gate, log it, collect the result ---
const runnable = gates.filter((g) => !g.skip);
console.log(`[gates] Running ${runnable.length}: ${runnable.map((g) => g.name).join(', ')} (package manager: ${pm})`);

const results = [];
for (const gate of gates) {
  if (gate.skip) {
    console.log(`[gates] ${gate.name} … SKIP (${gate.skip})`);
    continue;
  }
  const logPath = join(CACHE_DIR, `gate-${gate.name}.log`);
  const started = Date.now();
  const res = spawnSync(gate.command, {
    shell: '/bin/bash',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1' }, // one-shot runs: no watch UIs, no prompts
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  let output = `$ ${gate.command}\n\n${res.stdout ?? ''}${res.stderr ?? ''}`;
  let ok = res.status === 0;

  // Coverage floor: read the line-coverage total (jest json-summary reporter
  // when configured, else the default lcov report) and enforce the threshold
  // pinned in gates.json (no threshold pinned → report only).
  if (gate.name === 'test' && useCoverage && ok) {
    let total = NaN;
    const summary = readJSON('coverage/coverage-summary.json');
    if (summary?.total?.lines?.pct !== undefined) {
      total = Number(summary.total.lines.pct);
    } else if (existsSync('coverage/lcov.info')) {
      const lcov = readFileSync('coverage/lcov.info', 'utf8');
      const sum = (re) => [...lcov.matchAll(re)].reduce((acc, m) => acc + Number(m[1]), 0);
      const found = sum(/^LF:(\d+)$/gm);
      const hit = sum(/^LH:(\d+)$/gm);
      if (found > 0) total = Number(((hit / found) * 100).toFixed(1));
    }
    if (Number.isFinite(total)) {
      output += `\ncoverage (line): ${total}%\n`;
      if (coverageThreshold !== null && total < coverageThreshold) {
        ok = false;
        output += `coverage ${total}% is below the ${coverageThreshold}% threshold (gates.json)\n`;
        console.log(`[gates] coverage ${total}% < threshold ${coverageThreshold}%`);
      } else {
        console.log(`[gates] coverage ${total}%${coverageThreshold !== null ? ` (threshold ${coverageThreshold}%)` : ' (no threshold pinned)'}`);
      }
    } else {
      console.log('[gates] coverage ran but no coverage/coverage-summary.json or coverage/lcov.info to read a total from');
    }
  }

  writeFileSync(logPath, output);
  results.push({ ...gate, ok, secs, logPath, status: res.status });
  console.log(`[gates] ${gate.name} … ${ok ? 'PASS' : 'FAIL'} (${secs}s)${ok ? '' : ` → ${logPath}`}`);
}

// --- Summary; print the tail of each failing log so the error is inline ---
const failed = results.filter((r) => !r.ok);
console.log(`\n[gates] ${results.length - failed.length}/${results.length} passed.`);

for (const r of failed) {
  const tail = readFileSync(r.logPath, 'utf8').trimEnd().split('\n').slice(-30).join('\n');
  console.log(`\n----- ${r.name} FAILED (exit ${r.status}) — last lines of ${r.logPath} -----`);
  console.log(tail);
}

process.exit(failed.length ? 1 : 0);
