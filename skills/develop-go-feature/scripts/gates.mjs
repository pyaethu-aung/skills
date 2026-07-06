#!/usr/bin/env node
/**
 * gates.mjs
 * Run the project's gate commands (build / vet / lint / test, optionally e2e,
 * api, vuln) in one granted invocation, logging each to the cache dir and
 * printing a PASS/FAIL summary. Run from the project root.
 *
 * Why a script: the agent runs ONE allowlisted command —
 *   node .claude/skills/develop-go-feature/scripts/gates.mjs
 * — instead of `go test ./... > log 2>&1; echo "EXIT:$?"`. All the shell
 * orchestration (redirection, exit capture, sequencing) happens here in Node,
 * where Claude Code's command-injection / redirect heuristics never apply.
 *
 * Subprocesses spawned here are NOT re-checked against the allow list — only
 * the `node …/gates.mjs` the agent typed is — so Docker-pinned gate commands
 * (see below) run without a standing docker grant.
 *
 * Portable: gates are DERIVED from the module (go build/vet/test, golangci
 * when configured), never hard-coded to one service. A project can pin exact
 * commands via .cache/develop-go-feature/gates.json — either the array form
 *   [{ "name": "...", "command": "..." }]
 * or the object form
 *   { "gates": [{ "name": "...", "command": "..." }], "coverageThreshold": 80 }
 * — which overrides detection entirely. Pin docker-based commands here when
 * the project prescribes testing through its image, e.g.
 *   { "name": "test", "command": "docker compose run --rm app go test -race ./..." }
 *
 * Usage:
 *   node …/gates.mjs                 # build, vet, lint (when configured), test
 *   node …/gates.mjs --coverage      # test also enforces the coverage threshold
 *   node …/gates.mjs --e2e           # also run the integration/e2e suite
 *   node …/gates.mjs --api           # also run the project's contract-test target
 *   node …/gates.mjs --vuln          # also run govulncheck (advisory)
 *   node …/gates.mjs --only build,vet
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CACHE_DIR = '.cache/develop-go-feature';
const COVERAGE_PROFILE = join(CACHE_DIR, 'coverage.out');

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// --- Flags ---
const args = process.argv.slice(2);
const useCoverage = args.includes('--coverage');
const withE2e = args.includes('--e2e');
const withApi = args.includes('--api');
const withVuln = args.includes('--vuln');
const onlyArg = args.find((a) => a.startsWith('--only'));
const only = onlyArg
  ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1] || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
  : null;

// --- Detect the project so the gates fit whatever service is in use ---
const golangciConfig = ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json']
  .find((p) => existsSync(p));
const binaryOnPath = (bin) =>
  spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;

const makefile = readText('Makefile');
const makeTargets = new Set(
  [...makefile.matchAll(/^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:/gm)].map((m) => m[1]),
);
const firstMakeTarget = (...names) => names.find((n) => makeTargets.has(n));

// Integration build tags anywhere in tracked tests → the -tags fallback works.
let integrationTagged = false;
try {
  const tracked = spawnSync('git', ['ls-files', '*_test.go'], { encoding: 'utf8' });
  integrationTagged = (tracked.stdout ?? '').split('\n').filter(Boolean)
    .some((f) => /go:build\s+integration|\+build\s+integration/.test(readText(f)));
} catch { /* not a git repo */ }

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
} else {
  gates = [
    { name: 'build', command: 'go build ./...' },
    { name: 'vet', command: 'go vet ./...' },
  ];
  if (golangciConfig) {
    // Config present but binary missing is a FAIL, not a skip: the project made
    // lint a gate, so a fresh checkout must install the linter, not merge around it.
    gates.push(
      binaryOnPath('golangci-lint')
        ? { name: 'lint', command: 'golangci-lint run' }
        : { name: 'lint', command: `echo "golangci config (${golangciConfig}) present but golangci-lint is not installed — see https://golangci-lint.run/welcome/install/" && exit 1` },
    );
  }
  gates.push({
    name: 'test',
    command: useCoverage
      ? `go test -race -coverprofile=${COVERAGE_PROFILE} ./...`
      : 'go test -race ./...',
  });
}

if (withE2e && !gates.some((g) => g.name === 'e2e')) {
  const target = firstMakeTarget('test-e2e', 'e2e', 'test-integration', 'integration');
  if (target) gates.push({ name: 'e2e', command: `make ${target}` });
  else if (integrationTagged) gates.push({ name: 'e2e', command: 'go test -race -tags=integration ./...' });
  else gates.push({ name: 'e2e', skip: 'no e2e/integration make target and no integration build tags — pin a command in gates.json' });
}

if (withApi && !gates.some((g) => g.name === 'api')) {
  const target = firstMakeTarget('test-api', 'test-contract', 'contract');
  if (target) gates.push({ name: 'api', command: `make ${target}` });
  else gates.push({ name: 'api', skip: 'no contract-test make target — contract testing runs agent-driven via /test-api (Phase 4)' });
}

if (withVuln && !gates.some((g) => g.name === 'vuln')) {
  if (binaryOnPath('govulncheck')) gates.push({ name: 'vuln', command: 'govulncheck ./...' });
  else gates.push({ name: 'vuln', skip: 'govulncheck not installed (go install golang.org/x/vuln/cmd/govulncheck@latest) — advisory check skipped' });
}

if (only) gates = gates.filter((g) => only.includes(g.name));

if (!gates.length) {
  console.error('[gates] No gates selected.');
  process.exit(1);
}

if (!existsSync('go.mod') && !Array.isArray(overrideGates)) {
  console.error('[gates] No go.mod in the working directory — run from the module root (or pin commands in gates.json).');
  process.exit(1);
}

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// --- Run each gate, log it, collect the result ---
const runnable = gates.filter((g) => !g.skip);
console.log(`[gates] Running ${runnable.length}: ${runnable.map((g) => g.name).join(', ')}`);

const results = [];
for (const gate of gates) {
  if (gate.skip) {
    console.log(`[gates] ${gate.name} … SKIP (${gate.skip})`);
    continue;
  }
  const logPath = join(CACHE_DIR, `gate-${gate.name}.log`);
  const started = Date.now();
  const res = spawnSync(gate.command, { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  let output = `$ ${gate.command}\n\n${res.stdout ?? ''}${res.stderr ?? ''}`;
  let ok = res.status === 0;

  // Coverage floor: parse the total from `go tool cover` and enforce the
  // threshold pinned in gates.json (no threshold pinned → report only).
  if (gate.name === 'test' && useCoverage && ok && existsSync(COVERAGE_PROFILE)) {
    const cover = spawnSync('go', ['tool', 'cover', `-func=${COVERAGE_PROFILE}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    output += `\n$ go tool cover -func=${COVERAGE_PROFILE}\n\n${cover.stdout ?? ''}${cover.stderr ?? ''}`;
    const total = Number((cover.stdout ?? '').match(/^total:.*?([\d.]+)%/m)?.[1]);
    if (Number.isFinite(total)) {
      if (coverageThreshold !== null && total < coverageThreshold) {
        ok = false;
        output += `\ncoverage ${total}% is below the ${coverageThreshold}% threshold (gates.json)\n`;
        console.log(`[gates] coverage ${total}% < threshold ${coverageThreshold}%`);
      } else {
        console.log(`[gates] coverage ${total}%${coverageThreshold !== null ? ` (threshold ${coverageThreshold}%)` : ' (no threshold pinned)'}`);
      }
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
