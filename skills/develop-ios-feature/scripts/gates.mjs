#!/usr/bin/env node
/**
 * gates.mjs
 * Run the project's gate commands (build / lint / test, optionally UI tests)
 * in one granted invocation, logging each to the cache dir and printing a
 * PASS/FAIL summary. Run from the project root.
 *
 * Why a script: the agent runs ONE allowlisted command —
 *   node .claude/skills/develop-ios-feature/scripts/gates.mjs
 * — instead of `xcodebuild test … > log 2>&1; echo "EXIT:$?"`. All the shell
 * orchestration (redirection, exit capture, sequencing) happens here in Node,
 * where Claude Code's command-injection / redirect heuristics never apply.
 *
 * Subprocesses spawned here are NOT re-checked against the allow list — only
 * the `node …/gates.mjs` the agent typed is — so gate commands pinned in
 * gates.json (a fastlane lane, an exact -workspace/-scheme pair) run without
 * their own standing grants.
 *
 * Portable: gates are DERIVED from the layout — Xcode app (.xcodeproj /
 * .xcworkspace) gates run xcodebuild against a resolved iOS Simulator
 * destination with CODE_SIGNING_ALLOWED=NO; Swift package layouts run
 * swift build / swift test; SwiftLint / SwiftFormat only when configured.
 * A project can pin exact commands via .cache/develop-ios-feature/gates.json —
 * either the array form
 *   [{ "name": "...", "command": "..." }]
 * or the object form
 *   { "gates": [{ "name": "...", "command": "..." }], "coverageThreshold": 80 }
 * — which overrides detection entirely.
 *
 * Usage:
 *   node …/gates.mjs                     # build, lint (when configured), test
 *   node …/gates.mjs --scheme MyApp      # override the auto-picked scheme
 *   node …/gates.mjs --coverage          # test also measures (and enforces) coverage
 *   node …/gates.mjs --ui                # also run the XCUITest / UI test suite
 *   node …/gates.mjs --only build,lint
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CACHE_DIR = '.cache/develop-ios-feature';
const DERIVED_DATA = join(CACHE_DIR, 'DerivedData');
const RESULT_BUNDLE = join(CACHE_DIR, 'test.xcresult');

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function runQuiet(cmd, args, timeout = 60000) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return res.status === 0 ? (res.stdout ?? '').trim() : null;
}

// --- Flags ---
const args = process.argv.slice(2);
const useCoverage = args.includes('--coverage');
const withUi = args.includes('--ui');
const flagValue = (name) => {
  const idx = args.indexOf(name);
  if (idx >= 0) return args[idx + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.split('=')[1] : null;
};
const schemeArg = flagValue('--scheme');
const only = flagValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

// --- Detect the layout so the gates fit whatever project is in use ---
const rootEntries = (() => { try { return readdirSync('.'); } catch { return []; } })();
const workspaces = rootEntries.filter((e) => e.endsWith('.xcworkspace'));
const projects = rootEntries.filter((e) => e.endsWith('.xcodeproj'));
const hasPackage = existsSync('Package.swift');
const container = workspaces.length
  ? { flag: '-workspace', path: workspaces[0] }
  : projects.length
    ? { flag: '-project', path: projects[0] }
    : null;

const swiftlintConfig = ['.swiftlint.yml', '.swiftlint.yaml'].find((p) => existsSync(p));
const swiftformatConfig = existsSync('.swiftformat');
const binaryOnPath = (bin) =>
  spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
const hasXcbeautify = binaryOnPath('xcbeautify');

// --- Scheme resolution (app layouts) ---
function resolveScheme() {
  if (schemeArg) return schemeArg;
  const out = runQuiet('xcodebuild', ['-list', '-json', container.flag, container.path], 120000);
  if (!out) return null;
  try {
    const parsed = JSON.parse(out.slice(out.indexOf('{')));
    const schemes = (parsed.workspace ?? parsed.project ?? {}).schemes ?? [];
    if (!schemes.length) return null;
    // Prefer the scheme named after the container; else the first.
    const base = container.path.replace(/\.(xcworkspace|xcodeproj)$/, '');
    return schemes.includes(base) ? base : schemes[0];
  } catch {
    return null;
  }
}

// --- Destination resolution: prefer a booted iPhone simulator, else the ---
// --- newest-runtime available iPhone. Physical devices are a critique   ---
// --- target (device.mjs), never a gate target: gates stay deterministic ---
// --- and signing-free.                                                  ---
function resolveDestination() {
  const out = runQuiet('xcrun', ['simctl', 'list', '-j', 'devices', 'available'], 30000);
  if (!out) return null;
  let parsed;
  try { parsed = JSON.parse(out); } catch { return null; }
  const candidates = [];
  for (const [runtimeId, devices] of Object.entries(parsed.devices ?? {})) {
    const versionMatch = runtimeId.match(/iOS-(\d+)-(\d+)/);
    if (!versionMatch) continue;
    const version = Number(versionMatch[1]) * 100 + Number(versionMatch[2]);
    for (const d of devices) {
      if (!d.isAvailable || !/iPhone/.test(d.name)) continue;
      candidates.push({ udid: d.udid, name: d.name, version, booted: d.state === 'Booted' });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.booted - a.booted) || (b.version - a.version));
  return candidates[0];
}

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
let scheme = null;
let destination = null;

if (Array.isArray(overrideGates) && overrideGates.length) {
  gates = overrideGates.map((g) => ({ name: g.name, command: g.command }));
} else if (container) {
  scheme = resolveScheme();
  destination = resolveDestination();
  if (!scheme) {
    console.error('[gates] Could not resolve a scheme — pass --scheme <name> or pin commands in gates.json.');
    process.exit(1);
  }
  if (!destination) {
    console.error('[gates] No available iPhone simulator — install an iOS runtime in Xcode, or pin commands in gates.json.');
    process.exit(1);
  }
  const base = `xcodebuild ${container.flag} "${container.path}" -scheme "${scheme}" -destination "id=${destination.udid}" -derivedDataPath "${DERIVED_DATA}" CODE_SIGNING_ALLOWED=NO`;
  gates = [{ name: 'build', command: `${base} build` }];
  if (swiftlintConfig) {
    // Config present but binary missing is a FAIL, not a skip: the project made
    // lint a gate, so a fresh checkout must install the linter, not merge around it.
    gates.push(
      binaryOnPath('swiftlint')
        ? { name: 'lint', command: 'swiftlint lint' }
        : { name: 'lint', command: `echo "SwiftLint config (${swiftlintConfig}) present but swiftlint is not installed — see https://github.com/realm/SwiftLint#installation" && exit 1` },
    );
  }
  if (swiftformatConfig) {
    gates.push(
      binaryOnPath('swiftformat')
        ? { name: 'format', command: 'swiftformat --lint .' }
        : { name: 'format', command: 'echo ".swiftformat present but swiftformat is not installed — see https://github.com/nicklockwood/SwiftFormat#how-do-i-install-it" && exit 1' },
    );
  }
  gates.push({
    name: 'test',
    command: `${base} test -resultBundlePath "${RESULT_BUNDLE}"${useCoverage ? ' -enableCodeCoverage YES' : ''}`,
  });
} else if (hasPackage) {
  gates = [{ name: 'build', command: 'swift build' }];
  if (swiftlintConfig) {
    gates.push(
      binaryOnPath('swiftlint')
        ? { name: 'lint', command: 'swiftlint lint' }
        : { name: 'lint', command: `echo "SwiftLint config (${swiftlintConfig}) present but swiftlint is not installed — see https://github.com/realm/SwiftLint#installation" && exit 1` },
    );
  }
  if (swiftformatConfig) {
    gates.push(
      binaryOnPath('swiftformat')
        ? { name: 'format', command: 'swiftformat --lint .' }
        : { name: 'format', command: 'echo ".swiftformat present but swiftformat is not installed — see https://github.com/nicklockwood/SwiftFormat#how-do-i-install-it" && exit 1' },
    );
  }
  gates.push({
    name: 'test',
    command: useCoverage ? 'swift test --enable-code-coverage' : 'swift test',
  });
} else {
  console.error('[gates] No .xcworkspace, .xcodeproj, or Package.swift in the working directory — run from the project root (or pin commands in gates.json).');
  process.exit(1);
}

if (withUi && !gates.some((g) => g.name === 'ui')) {
  if (container && scheme && destination) {
    // Detect a UI-test target so the gate is real, not a guess.
    const pbxproj = projects.length ? (() => { try { return readFileSync(join(projects[0], 'project.pbxproj'), 'utf8'); } catch { return ''; } })() : '';
    const uiTarget = pbxproj.match(/name\s*=\s*"?([A-Za-z0-9_]+UITests)"?;/)?.[1];
    if (uiTarget) {
      gates.push({
        name: 'ui',
        command: `xcodebuild ${container.flag} "${container.path}" -scheme "${scheme}" -destination "id=${destination.udid}" -derivedDataPath "${DERIVED_DATA}" CODE_SIGNING_ALLOWED=NO test -only-testing:${uiTarget}`,
      });
    } else {
      gates.push({ name: 'ui', skip: 'no *UITests target detected — pin a command in gates.json' });
    }
  } else {
    gates.push({ name: 'ui', skip: 'UI tests need an Xcode app layout with a simulator destination' });
  }
}

if (only) gates = gates.filter((g) => only.includes(g.name));

if (!gates.length) {
  console.error('[gates] No gates selected.');
  process.exit(1);
}

if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
// xcodebuild refuses to overwrite an existing result bundle.
if (gates.some((g) => g.command?.includes(RESULT_BUNDLE))) rmSync(RESULT_BUNDLE, { recursive: true, force: true });

// --- Run each gate, log it, collect the result ---
const runnable = gates.filter((g) => !g.skip);
console.log(`[gates] Running ${runnable.length}: ${runnable.map((g) => g.name).join(', ')}`);
if (scheme) console.log(`[gates] scheme "${scheme}", destination ${destination.name} (${destination.udid})`);

const results = [];
for (const gate of gates) {
  if (gate.skip) {
    console.log(`[gates] ${gate.name} … SKIP (${gate.skip})`);
    continue;
  }
  const logPath = join(CACHE_DIR, `gate-${gate.name}.log`);
  // Prettify verbose xcodebuild logs when xcbeautify is around; pipefail keeps
  // xcodebuild's exit status authoritative.
  const command = hasXcbeautify && gate.command.startsWith('xcodebuild')
    ? `set -o pipefail; ${gate.command} 2>&1 | xcbeautify`
    : gate.command;
  const started = Date.now();
  const res = spawnSync(command, { shell: '/bin/bash', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  let output = `$ ${gate.command}\n\n${res.stdout ?? ''}${res.stderr ?? ''}`;
  let ok = res.status === 0;

  // Coverage floor: read the line-coverage total from the result bundle and
  // enforce the threshold pinned in gates.json (no threshold pinned → report
  // only). Package layouts generate the profile but have no bundle to read, so
  // they report generation only.
  if (gate.name === 'test' && useCoverage && ok) {
    if (existsSync(RESULT_BUNDLE)) {
      const cov = spawnSync('xcrun', ['xccov', 'view', '--report', '--json', RESULT_BUNDLE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const total = (() => {
        try { return Number((JSON.parse(cov.stdout ?? '').lineCoverage * 100).toFixed(1)); } catch { return NaN; }
      })();
      if (Number.isFinite(total)) {
        output += `\ncoverage (xccov line coverage): ${total}%\n`;
        if (coverageThreshold !== null && total < coverageThreshold) {
          ok = false;
          output += `coverage ${total}% is below the ${coverageThreshold}% threshold (gates.json)\n`;
          console.log(`[gates] coverage ${total}% < threshold ${coverageThreshold}%`);
        } else {
          console.log(`[gates] coverage ${total}%${coverageThreshold !== null ? ` (threshold ${coverageThreshold}%)` : ' (no threshold pinned)'}`);
        }
      }
    } else {
      console.log('[gates] coverage profile generated (swift test --enable-code-coverage); no result bundle to enforce a threshold against');
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
