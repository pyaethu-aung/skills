#!/usr/bin/env node
/**
 * gates.mjs
 * Run the project's gate commands (test / lint / build, optionally e2e) in one
 * granted invocation, logging each to the cache dir and printing a PASS/FAIL
 * summary. Run from the project root.
 *
 * Why a script: the agent runs ONE allowlisted command —
 *   node .claude/skills/develop-web-feature/scripts/gates.mjs
 * — instead of `npm run <gate> > log 2>&1; echo "EXIT:$?"`. All the shell
 * orchestration (redirection, exit capture, sequencing) happens here in Node,
 * where Claude Code's command-injection / redirect heuristics never apply. That
 * collapses the broad `Bash(<pm> run *)` + `echo` grants into a single,
 * reviewable entry, and removes the `$?` / `>` / `&&` permission-prompt class.
 *
 * Subprocesses spawned here are NOT re-checked against the allow list — only the
 * `node …/gates.mjs` the agent typed is — so the runner can call the gates
 * freely without `<pm> run *` being granted.
 *
 * Portable: gates are DERIVED from package.json scripts, never hard-coded. A
 * project can pin exact commands via .cache/develop-web-feature/gates.json
 * (an array of { "name": "...", "command": "..." }), which overrides detection.
 *
 * Usage:
 *   node …/gates.mjs                 # test, lint, build (whichever exist)
 *   node …/gates.mjs --coverage      # use test:coverage in place of test
 *   node …/gates.mjs --e2e           # also run test:e2e
 *   node …/gates.mjs --only test,lint
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CACHE_DIR = '.cache/develop-web-feature';

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// --- Flags ---
const args = process.argv.slice(2);
const useCoverage = args.includes('--coverage');
const withE2e = args.includes('--e2e');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
  : null;

// --- Detect the project so the gates fit whatever stack is in use ---
const pkg = readJSON('package.json') ?? {};
const scripts = pkg.scripts ?? {};

const pm = existsSync('pnpm-lock.yaml') ? 'pnpm'
  : existsSync('yarn.lock') ? 'yarn'
  : (existsSync('bun.lockb') || existsSync('bun.lock')) ? 'bun'
  : 'npm';

// `<pm> run <script>` (yarn omits the `run`); append extra args after a `--`.
const invoke = (script) => (pm === 'yarn' ? `yarn ${script}` : `${pm} run ${script}`);
const passArgs = (cmd, extra) => (pm === 'yarn' ? `${cmd} ${extra}` : `${cmd} -- ${extra}`);

// Guard against a Vitest watch-mode test script hanging the runner forever.
function commandFor(script) {
  const body = scripts[script] ?? '';
  let cmd = invoke(script);
  if (/\bvitest\b/.test(body) && !/\bvitest\s+run\b/.test(body) && !/--run\b/.test(body)) {
    cmd = passArgs(cmd, '--run');
  }
  return cmd;
}

// --- Build the ordered gate list (override file wins, else derive) ---
let gates;
const overridePath = join(CACHE_DIR, 'gates.json');
const override = existsSync(overridePath) ? readJSON(overridePath) : null;
if (Array.isArray(override) && override.length) {
  gates = override.map((g) => ({ name: g.name, command: g.command }));
} else {
  const testScript = useCoverage && scripts['test:coverage'] ? 'test:coverage' : 'test';
  const candidates = [
    ['test', testScript],
    ['lint', 'lint'],
    ['build', 'build'],
    ...(withE2e ? [['e2e', 'test:e2e']] : []),
  ];
  gates = candidates
    .filter(([, script]) => Boolean(scripts[script]))
    .map(([name, script]) => ({ name, command: commandFor(script) }));
}

if (only) gates = gates.filter((g) => only.includes(g.name));

if (!gates.length) {
  console.error('[gates] No gate scripts found in package.json (looked for test, lint, build).');
  process.exit(1);
}

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// --- Run each gate, log it, collect the result ---
console.log(`[gates] Running ${gates.length}: ${gates.map((g) => g.name).join(', ')} (via ${pm})`);

const results = [];
for (const gate of gates) {
  const logPath = join(CACHE_DIR, `gate-${gate.name}.log`);
  const started = Date.now();
  const res = spawnSync(gate.command, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const output = `$ ${gate.command}\n\n${res.stdout ?? ''}${res.stderr ?? ''}`;
  writeFileSync(logPath, output);
  const ok = res.status === 0;
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
