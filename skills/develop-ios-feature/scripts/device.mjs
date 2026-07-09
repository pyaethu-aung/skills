#!/usr/bin/env node
/**
 * device.mjs
 * Manage the app's run target for the Phase 4 critique, so the workflow never
 * needs raw simctl/devicectl choreography typed ad hoc. One helper covers both
 * targets; the iOS SIMULATOR is the default, a connected physical device is
 * opt-in (--physical or a physical UDID).
 *
 *   node …/device.mjs start [--scheme MyApp] [--device "iPhone 16"] [--udid U]
 *                           [--physical] [--configuration Debug] [--timeout 180]
 *   node …/device.mjs screenshot --out <path> [--appearance light|dark]
 *   node …/device.mjs appearance light|dark
 *   node …/device.mjs relaunch
 *   node …/device.mjs status
 *   node …/device.mjs stop
 *
 * `start`      resolves the target (booted iPhone simulator, else the newest
 *              available iPhone; or the physical device), boots it when needed,
 *              builds the app (simulator: CODE_SIGNING_ALLOWED=NO; physical:
 *              the project's configured signing, failing plainly when it can't
 *              sign), installs, launches, and records the state file. Re-running
 *              after a fix rebuilds and relaunches — that is the point.
 * `screenshot` captures the current screen. Simulator: can force light/dark
 *              first and pins the status-bar clock to 9:41 once. Physical:
 *              best-effort via `devicectl device screenshot`; when the installed
 *              Xcode lacks it, prints NO SCREENSHOT and exits 3 so the critique
 *              falls back to snapshot-test images.
 * `appearance` simulator-only light/dark switch.
 * `relaunch`   terminate + launch (reset transient UI state between shots).
 * `stop`       terminates the app; shuts the simulator down only when this
 *              script booted it. Physical devices are never rebooted.
 *
 * Swift-package layouts have no app to run: every subcommand prints NO APP and
 * exits 3 (distinct from failure) so the critique loop can branch cleanly.
 *
 * Pure Node built-ins, no dependencies. Run from the project root.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const CACHE_DIR = '.cache/develop-ios-feature';
const DERIVED_DATA = join(CACHE_DIR, 'DerivedData');
const STATE_PATH = join(CACHE_DIR, 'device.json');
const BUILD_LOG = join(CACHE_DIR, 'device-build.log');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return null; }
}

function writeState(state) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scheme') out.scheme = argv[++i];
    else if (a === '--device') out.device = argv[++i];
    else if (a === '--udid') out.udid = argv[++i];
    else if (a === '--physical') out.physical = true;
    else if (a === '--configuration') out.configuration = argv[++i];
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--appearance') out.appearance = argv[++i];
    else out._.push(a);
  }
  return out;
}

// --- Layout: an app container is required for every subcommand ---
const rootEntries = (() => { try { return readdirSync('.'); } catch { return []; } })();
const workspaces = rootEntries.filter((e) => e.endsWith('.xcworkspace'));
const projects = rootEntries.filter((e) => e.endsWith('.xcodeproj'));
const container = workspaces.length
  ? { flag: '-workspace', path: workspaces[0] }
  : projects.length
    ? { flag: '-project', path: projects[0] }
    : null;

if (!container) {
  console.log('NO APP: no .xcworkspace or .xcodeproj at the root — Swift package layout, skip the simulator critique.');
  process.exit(3);
}

// --- Target resolution ---
function listSimulators() {
  const res = run('xcrun', ['simctl', 'list', '-j', 'devices', 'available'], { timeout: 30000 });
  if (res.status !== 0) return [];
  let parsed;
  try { parsed = JSON.parse(res.stdout); } catch { return []; }
  const out = [];
  for (const [runtimeId, devices] of Object.entries(parsed.devices ?? {})) {
    const versionMatch = runtimeId.match(/iOS-(\d+)-(\d+)/);
    if (!versionMatch) continue;
    const version = Number(versionMatch[1]) * 100 + Number(versionMatch[2]);
    for (const d of devices) {
      if (d.isAvailable) out.push({ udid: d.udid, name: d.name, version, booted: d.state === 'Booted' });
    }
  }
  return out;
}

function listPhysicalDevices() {
  const jsonPath = join(CACHE_DIR, 'devicectl-list.json');
  mkdirSync(CACHE_DIR, { recursive: true });
  const res = run('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath], { timeout: 30000 });
  if (res.status !== 0) return [];
  let parsed;
  try { parsed = JSON.parse(readFileSync(jsonPath, 'utf8')); } catch { return []; }
  return (parsed.result?.devices ?? []).map((d) => ({
    udid: d.hardwareProperties?.udid ?? '',
    name: d.deviceProperties?.name ?? 'unknown',
    identifier: d.identifier ?? '',
  })).filter((d) => d.udid || d.identifier);
}

function resolveTarget(opts) {
  const physicals = (opts.physical || opts.udid) ? listPhysicalDevices() : [];
  if (opts.udid) {
    const phys = physicals.find((d) => d.udid === opts.udid || d.identifier === opts.udid);
    if (phys) return { kind: 'physical', ...phys };
    const sim = listSimulators().find((d) => d.udid === opts.udid);
    if (sim) return { kind: 'simulator', ...sim };
    console.error(`[device] No simulator or connected device with UDID ${opts.udid}.`);
    return null;
  }
  if (opts.physical) {
    const phys = opts.device
      ? physicals.find((d) => d.name === opts.device)
      : physicals[0];
    if (!phys) {
      console.error(`[device] No connected physical device${opts.device ? ` named "${opts.device}"` : ''} — check \`xcrun devicectl list devices\` and pairing.`);
      return null;
    }
    return { kind: 'physical', ...phys };
  }
  const sims = listSimulators().filter((d) => (opts.device ? d.name === opts.device : /iPhone/.test(d.name)));
  if (!sims.length) {
    console.error(`[device] No available ${opts.device ? `simulator named "${opts.device}"` : 'iPhone simulator'} — install an iOS runtime in Xcode.`);
    return null;
  }
  sims.sort((a, b) => (b.booted - a.booted) || (b.version - a.version));
  return { kind: 'simulator', ...sims[0] };
}

function resolveScheme(opts) {
  if (opts.scheme) return opts.scheme;
  const prev = readState();
  if (prev?.scheme) return prev.scheme;
  const res = run('xcodebuild', ['-list', '-json', container.flag, container.path], { timeout: 120000 });
  if (res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
    const schemes = (parsed.workspace ?? parsed.project ?? {}).schemes ?? [];
    if (!schemes.length) return null;
    const base = container.path.replace(/\.(xcworkspace|xcodeproj)$/, '');
    return schemes.includes(base) ? base : schemes[0];
  } catch {
    return null;
  }
}

function findApp(configuration, sdkSuffix) {
  const productsDir = join(DERIVED_DATA, 'Build', 'Products', `${configuration}-${sdkSuffix}`);
  try {
    const app = readdirSync(productsDir).find((e) => e.endsWith('.app'));
    return app ? join(productsDir, app) : null;
  } catch {
    return null;
  }
}

function bundleIdOf(appPath) {
  const res = run('plutil', ['-convert', 'json', '-o', '-', join(appPath, 'Info.plist')], { timeout: 15000 });
  if (res.status !== 0) return null;
  try { return JSON.parse(res.stdout).CFBundleIdentifier ?? null; } catch { return null; }
}

// --- Subcommands ---
function start(opts) {
  const target = resolveTarget(opts);
  if (!target) return 1;
  const scheme = resolveScheme(opts);
  if (!scheme) {
    console.error('[device] Could not resolve a scheme — pass --scheme <name>.');
    return 1;
  }
  const configuration = opts.configuration ?? 'Debug';
  const timeoutMs = (opts.timeout ?? 180) * 1000;

  let bootedByUs = false;
  if (target.kind === 'simulator' && !target.booted) {
    console.log(`[device] booting ${target.name} (${target.udid})…`);
    const boot = run('xcrun', ['simctl', 'boot', target.udid], { timeout: 60000 });
    if (boot.status !== 0 && !/current state:\s*Booted/i.test(boot.stderr ?? '')) {
      console.error(`[device] boot failed: ${(boot.stderr ?? '').trim()}`);
      return 1;
    }
    bootedByUs = true;
    run('xcrun', ['simctl', 'bootstatus', target.udid, '-b'], { timeout: timeoutMs });
  } else if (target.kind === 'simulator') {
    bootedByUs = readState()?.bootedByUs ?? false;
  }

  // Build. Simulator builds never sign; device builds use the project's
  // configured signing as-is (this script never edits signing settings).
  const buildArgs = [
    container.flag, container.path,
    '-scheme', scheme,
    '-configuration', configuration,
    '-derivedDataPath', DERIVED_DATA,
    '-destination', target.kind === 'simulator' ? `id=${target.udid}` : 'generic/platform=iOS',
    'build',
    ...(target.kind === 'simulator' ? ['CODE_SIGNING_ALLOWED=NO'] : []),
  ];
  console.log(`[device] building ${scheme} (${configuration}) for ${target.kind}…`);
  const build = run('xcodebuild', buildArgs);
  writeFileSync(BUILD_LOG, `$ xcodebuild ${buildArgs.join(' ')}\n\n${build.stdout ?? ''}${build.stderr ?? ''}`);
  if (build.status !== 0) {
    const tail = `${build.stdout ?? ''}${build.stderr ?? ''}`.trimEnd().split('\n').slice(-25).join('\n');
    console.error(`[device] build failed — full log at ${BUILD_LOG}. Last lines:\n${tail}`);
    if (target.kind === 'physical' && /signing|provisioning/i.test(tail)) {
      console.error('[device] Device builds need the project\'s existing code signing to work (a development team and profile). Fix signing in Xcode, or critique on the simulator instead.');
    }
    return 1;
  }

  const appPath = findApp(configuration, target.kind === 'simulator' ? 'iphonesimulator' : 'iphoneos');
  if (!appPath) {
    console.error(`[device] built, but no .app found under ${DERIVED_DATA}/Build/Products — is "${scheme}" an app scheme?`);
    return 1;
  }
  const bundleId = bundleIdOf(appPath);
  if (!bundleId) {
    console.error(`[device] could not read CFBundleIdentifier from ${appPath}/Info.plist.`);
    return 1;
  }

  if (target.kind === 'simulator') {
    const install = run('xcrun', ['simctl', 'install', target.udid, appPath], { timeout: 120000 });
    if (install.status !== 0) {
      console.error(`[device] install failed: ${(install.stderr ?? '').trim()}`);
      return 1;
    }
    run('xcrun', ['simctl', 'terminate', target.udid, bundleId], { timeout: 30000 }); // fresh launch; ignore "not running"
    const launch = run('xcrun', ['simctl', 'launch', target.udid, bundleId], { timeout: 60000 });
    if (launch.status !== 0) {
      console.error(`[device] launch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  } else {
    const install = run('xcrun', ['devicectl', 'device', 'install', 'app', '--device', target.udid || target.identifier, appPath], { timeout: 300000 });
    if (install.status !== 0) {
      console.error(`[device] install failed: ${(install.stderr ?? '').trim()}`);
      return 1;
    }
    const launch = run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', target.udid || target.identifier, bundleId], { timeout: 120000 });
    if (launch.status !== 0) {
      console.error(`[device] launch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  }

  writeState({
    kind: target.kind,
    udid: target.udid || target.identifier,
    deviceName: target.name,
    bundleId,
    scheme,
    configuration,
    appPath,
    bootedByUs,
    statusBarSet: readState()?.statusBarSet ?? false,
  });
  console.log(`[device] ${bundleId} running on ${target.kind} ${target.name} (${target.udid || target.identifier})`);
  return 0;
}

function requireState() {
  const state = readState();
  if (!state?.udid || !state?.bundleId) {
    console.error('[device] no tracked app — run `start` first.');
    return null;
  }
  return state;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function screenshot(opts) {
  const state = requireState();
  if (!state) return 1;
  if (!opts.out) {
    console.error('[device] screenshot needs --out <path>.');
    return 2;
  }
  mkdirSync(dirname(opts.out), { recursive: true });

  if (state.kind === 'simulator') {
    if (opts.appearance) {
      run('xcrun', ['simctl', 'ui', state.udid, 'appearance', opts.appearance], { timeout: 30000 });
      sleep(2000); // let the appearance transition settle before capturing
    }
    if (!state.statusBarSet) {
      run('xcrun', ['simctl', 'status_bar', state.udid, 'override', '--time', '9:41'], { timeout: 30000 });
      writeState({ ...state, statusBarSet: true });
    }
    const shot = run('xcrun', ['simctl', 'io', state.udid, 'screenshot', opts.out], { timeout: 30000 });
    if (shot.status !== 0) {
      console.error(`[device] screenshot failed: ${(shot.stderr ?? '').trim()}`);
      return 1;
    }
  } else {
    if (opts.appearance) console.error('[device] --appearance is simulator-only; capturing the device\'s current appearance.');
    const shot = run('xcrun', ['devicectl', 'device', 'screenshot', '--device', state.udid, opts.out], { timeout: 60000 });
    if (shot.status !== 0 || !existsSync(opts.out)) {
      console.log('NO SCREENSHOT: this Xcode\'s devicectl cannot capture the device screen — score visual dimensions from snapshot-test images and previews instead.');
      return 3;
    }
  }
  console.log(opts.out);
  return 0;
}

function appearance(opts) {
  const state = requireState();
  if (!state) return 1;
  const mode = opts._[0];
  if (!['light', 'dark'].includes(mode)) {
    console.error('Usage: device.mjs appearance <light|dark>');
    return 2;
  }
  if (state.kind !== 'simulator') {
    console.error('[device] appearance switching is simulator-only.');
    return 3;
  }
  const res = run('xcrun', ['simctl', 'ui', state.udid, 'appearance', mode], { timeout: 30000 });
  if (res.status !== 0) {
    console.error(`[device] appearance switch failed: ${(res.stderr ?? '').trim()}`);
    return 1;
  }
  console.log(`[device] appearance → ${mode}`);
  return 0;
}

function relaunch() {
  const state = requireState();
  if (!state) return 1;
  if (state.kind === 'simulator') {
    run('xcrun', ['simctl', 'terminate', state.udid, state.bundleId], { timeout: 30000 });
    const launch = run('xcrun', ['simctl', 'launch', state.udid, state.bundleId], { timeout: 60000 });
    if (launch.status !== 0) {
      console.error(`[device] relaunch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  } else {
    run('xcrun', ['devicectl', 'device', 'process', 'terminate', '--device', state.udid, state.bundleId], { timeout: 60000 });
    const launch = run('xcrun', ['devicectl', 'device', 'process', 'launch', '--device', state.udid, state.bundleId], { timeout: 120000 });
    if (launch.status !== 0) {
      console.error(`[device] relaunch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  }
  console.log(`[device] relaunched ${state.bundleId}.`);
  return 0;
}

function status() {
  const state = readState();
  if (!state) {
    console.log('[device] no tracked app.');
    return 1;
  }
  console.log(JSON.stringify(state, null, 2));
  return 0;
}

function stop() {
  const state = readState();
  if (!state) {
    console.log('[device] nothing to stop.');
    return 0;
  }
  if (state.kind === 'simulator') {
    run('xcrun', ['simctl', 'terminate', state.udid, state.bundleId], { timeout: 30000 });
    // Shut down only a simulator this script booted; never touch one the user
    // had open, and never reboot/shut down physical hardware.
    if (state.bootedByUs) run('xcrun', ['simctl', 'shutdown', state.udid], { timeout: 60000 });
  } else {
    run('xcrun', ['devicectl', 'device', 'process', 'terminate', '--device', state.udid, state.bundleId], { timeout: 60000 });
  }
  rmSync(STATE_PATH, { force: true });
  console.log(`[device] stopped ${state.bundleId} on ${state.deviceName}.`);
  return 0;
}

const [, , sub, ...rest] = process.argv;
const opts = parseArgs(rest);
const handlers = { start: () => start(opts), screenshot: () => screenshot(opts), appearance: () => appearance(opts), relaunch, status, stop };

if (!handlers[sub]) {
  console.error('Usage: device.mjs <start|screenshot|appearance|relaunch|status|stop> [options]');
  process.exit(2);
}

process.exit(handlers[sub]() ?? 0);
