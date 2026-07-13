#!/usr/bin/env node
/**
 * device.mjs
 * Manage the app's run targets for the Phase 4 critique, so the workflow never
 * needs raw simctl/adb choreography typed ad hoc. One helper covers both
 * platforms: the iOS SIMULATOR and the ANDROID EMULATOR. Both can be tracked
 * at once (the state file holds an independent section per platform).
 *
 *   node …/device.mjs start      --platform ios|android [--device NAME | --avd NAME]
 *                                [--scheme S] [--configuration Debug] [--timeout 300]
 *                                [--no-build] [-- <launch args…>]
 *   node …/device.mjs screenshot --out <path> [--platform ios|android]
 *                                [--appearance light|dark] [--settle 2]
 *   node …/device.mjs appearance light|dark [--platform ios|android]
 *   node …/device.mjs relaunch   [--platform ios|android] [-- <launch args…>]
 *   node …/device.mjs status
 *   node …/device.mjs stop       [--platform ios|android]   # default: all tracked
 *
 * `--platform` is required for `start`; elsewhere it is inferred when exactly
 * one platform is tracked and required (exit 2) when both are.
 *
 * Metro must already be running (metro.mjs start) for Debug builds — this
 * helper only checks the port and fails with a hint; it never spawns the
 * bundler (one Metro serves both platforms, so its lifecycle is separate).
 *
 * iOS: resolves a simulator (an already-booted iPhone, else the newest
 * runtime), boots it when needed, builds signing-free
 * (CODE_SIGNING_ALLOWED=NO) via xcodebuild against ios/ when the native dir
 * is checked in (bare / Expo prebuild — Pods must be installed first), or via
 * `npx expo run:ios --no-bundler` for Expo managed (CNG) projects (Expo Go is
 * never used: native modules diverge from a development build). Installs,
 * launches, pins the status-bar clock to 9:41 on the first screenshot, forces
 * light/dark per shot.
 *
 * Android: needs the Android SDK (ANDROID_HOME/ANDROID_SDK_ROOT or adb on the
 * PATH) — absent SDK prints NO ANDROID and exits 3 (distinct from failure) so
 * the critique degrades to iOS-only cleanly. Prefers a running emulator, else
 * boots an AVD detached; `adb reverse` wires the app to Metro; builds via the
 * Gradle wrapper (bare / prebuild) or `npx expo run:android --no-bundler`
 * (managed); dark mode via `cmd uimode night`, clock pinned to 09:41 via
 * SystemUI demo mode (both restored on stop); screenshots via
 * `adb exec-out screencap` captured in-process (no shell redirect).
 *
 * `stop` terminates the app; shuts a simulator down / kills an emulator only
 * when this script booted it, and restores the Android uimode/demo-mode state
 * it changed. It never wipes, erases, or reshapes any device.
 *
 * Launch arguments: everything after a literal `--` passes verbatim to
 * `simctl launch` on iOS; on Android they append to an `am start` of the
 * resolved launcher activity (Android state-driving usually goes through deep
 * links instead: `relaunch -- -a android.intent.action.VIEW -d <url>` is not
 * needed — use the launch args as `am start` arguments).
 *
 * Pure Node built-ins, no dependencies. Run from the project root.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, openSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { connect } from 'node:net';

const CACHE_DIR = '.cache/develop-react-native-feature';
const DERIVED_DATA = join(CACHE_DIR, 'DerivedData');
const STATE_PATH = join(CACHE_DIR, 'device.json');
const METRO_STATE = join(CACHE_DIR, 'metro.json');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readState() {
  return readJSON(STATE_PATH) ?? {};
}

function writeState(state) {
  mkdirSync(CACHE_DIR, { recursive: true });
  if (!state.ios && !state.android) {
    rmSync(STATE_PATH, { force: true });
    return;
  }
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function parseArgs(argv) {
  const out = { _: [], launchArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.launchArgs = argv.slice(i + 1); break; }
    if (a === '--platform') out.platform = argv[++i];
    else if (a === '--device') out.device = argv[++i];
    else if (a === '--avd') out.avd = argv[++i];
    else if (a === '--scheme') out.scheme = argv[++i];
    else if (a === '--configuration') out.configuration = argv[++i];
    else if (a === '--timeout') out.timeout = Number(argv[++i]);
    else if (a === '--no-build') out.noBuild = true;
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--appearance') out.appearance = argv[++i];
    else if (a === '--settle') out.settle = Number(argv[++i]);
    else out._.push(a);
  }
  return out;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// --- Layout: a React Native app is required for every subcommand ---
const pkg = readJSON('package.json');
const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
if (!deps['react-native'] && !deps.expo) {
  console.log('NO APP: no react-native or expo dependency in package.json — not a React Native app, skip the device critique.');
  process.exit(3);
}
const isExpo = Boolean(deps.expo);
const appConfig = readJSON('app.json')?.expo ?? readJSON('app.config.json')?.expo ?? null;

// --- Metro: Debug builds load their bundle from the running bundler ---
function metroPort() {
  return readJSON(METRO_STATE)?.port ?? 8081;
}

function tcpReachable(port, host = '127.0.0.1', timeout = 1500) {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

// --- Platform resolution for the non-start subcommands ---
function resolvePlatform(opts, state) {
  if (opts.platform) {
    if (!['ios', 'android'].includes(opts.platform)) {
      console.error('[device] --platform must be ios or android.');
      return null;
    }
    return opts.platform;
  }
  const tracked = ['ios', 'android'].filter((p) => state[p]);
  if (tracked.length === 1) return tracked[0];
  if (tracked.length === 0) {
    console.error('[device] no tracked app — run `start --platform ios|android` first.');
    return null;
  }
  console.error('[device] both platforms are tracked — pass --platform ios|android.');
  process.exit(2);
}

// ============================== iOS half ==============================

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

function resolveSimulator(opts) {
  const sims = listSimulators().filter((d) => (opts.device ? d.name === opts.device : /iPhone/.test(d.name)));
  if (!sims.length) {
    console.error(`[device] No available ${opts.device ? `simulator named "${opts.device}"` : 'iPhone simulator'} — install an iOS runtime in Xcode.`);
    return null;
  }
  sims.sort((a, b) => (b.booted - a.booted) || (b.version - a.version));
  return sims[0];
}

function iosContainer() {
  if (!existsSync('ios')) return null;
  let entries = [];
  try { entries = readdirSync('ios'); } catch { return null; }
  const ws = entries.find((e) => e.endsWith('.xcworkspace'));
  if (ws) return { flag: '-workspace', path: join('ios', ws) };
  const proj = entries.find((e) => e.endsWith('.xcodeproj'));
  if (proj) return { flag: '-project', path: join('ios', proj) };
  return null;
}

function resolveScheme(opts, container, prev) {
  if (opts.scheme) return opts.scheme;
  if (prev?.scheme) return prev.scheme;
  const res = run('xcodebuild', ['-list', '-json', container.flag, container.path], { timeout: 120000 });
  if (res.status !== 0) return null;
  try {
    const parsed = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')));
    const schemes = (parsed.workspace ?? parsed.project ?? {}).schemes ?? [];
    if (!schemes.length) return null;
    const base = container.path.replace(/^ios\//, '').replace(/\.(xcworkspace|xcodeproj)$/, '');
    return schemes.includes(base) ? base : schemes[0];
  } catch {
    return null;
  }
}

function findApp(configuration) {
  const productsDir = join(DERIVED_DATA, 'Build', 'Products', `${configuration}-iphonesimulator`);
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

async function startIos(opts, state) {
  if (process.platform !== 'darwin') {
    console.error('[device] the iOS half needs macOS with Xcode.');
    return 1;
  }
  const configuration = opts.configuration ?? 'Debug';
  if (configuration === 'Debug' && !(await tcpReachable(metroPort()))) {
    console.error(`[device] Metro is not reachable on port ${metroPort()} — run \`metro.mjs start\` (drnf-metro start) first.`);
    return 1;
  }

  const target = resolveSimulator(opts);
  if (!target) return 1;
  const timeoutMs = (opts.timeout ?? 300) * 1000;

  let bootedByUs = false;
  if (!target.booted) {
    console.log(`[device] booting ${target.name} (${target.udid})…`);
    const boot = run('xcrun', ['simctl', 'boot', target.udid], { timeout: 60000 });
    if (boot.status !== 0 && !/current state:\s*Booted/i.test(boot.stderr ?? '')) {
      console.error(`[device] boot failed: ${(boot.stderr ?? '').trim()}`);
      return 1;
    }
    bootedByUs = true;
    run('xcrun', ['simctl', 'bootstatus', target.udid, '-b'], { timeout: timeoutMs });
  } else {
    bootedByUs = state.ios?.bootedByUs ?? false;
  }

  const container = iosContainer();
  let bundleId;
  let scheme = null;
  let appPath = null;

  if (opts.noBuild && state.ios?.bundleId) {
    bundleId = state.ios.bundleId;
    scheme = state.ios.scheme ?? null;
    appPath = state.ios.appPath ?? null;
    run('xcrun', ['simctl', 'terminate', target.udid, bundleId], { timeout: 30000 });
    const launch = run('xcrun', ['simctl', 'launch', target.udid, bundleId, ...opts.launchArgs], { timeout: 60000 });
    if (launch.status !== 0) {
      console.error(`[device] launch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  } else if (container) {
    // Bare / Expo prebuild: build signing-free with xcodebuild against ios/.
    if (existsSync('ios/Podfile') && !existsSync('ios/Pods')) {
      console.error('[device] ios/Podfile present but ios/Pods missing — run `pod install` in ios/ (or `npx pod-install`) first.');
      return 1;
    }
    scheme = resolveScheme(opts, container, state.ios);
    if (!scheme) {
      console.error('[device] Could not resolve a scheme — pass --scheme <name>.');
      return 1;
    }
    const buildArgs = [
      container.flag, container.path,
      '-scheme', scheme,
      '-configuration', configuration,
      '-derivedDataPath', DERIVED_DATA,
      '-destination', `id=${target.udid}`,
      'build',
      'CODE_SIGNING_ALLOWED=NO',
    ];
    console.log(`[device] building ${scheme} (${configuration}) for the simulator…`);
    const build = run('xcodebuild', buildArgs);
    const buildLog = join(CACHE_DIR, 'ios-build.log');
    writeFileSync(buildLog, `$ xcodebuild ${buildArgs.join(' ')}\n\n${build.stdout ?? ''}${build.stderr ?? ''}`);
    if (build.status !== 0) {
      const tail = `${build.stdout ?? ''}${build.stderr ?? ''}`.trimEnd().split('\n').slice(-25).join('\n');
      console.error(`[device] build failed — full log at ${buildLog}. Last lines:\n${tail}`);
      return 1;
    }
    appPath = findApp(configuration);
    if (!appPath) {
      console.error(`[device] built, but no .app found under ${DERIVED_DATA}/Build/Products — is "${scheme}" an app scheme?`);
      return 1;
    }
    bundleId = bundleIdOf(appPath);
    if (!bundleId) {
      console.error(`[device] could not read CFBundleIdentifier from ${appPath}/Info.plist.`);
      return 1;
    }
    const install = run('xcrun', ['simctl', 'install', target.udid, appPath], { timeout: 120000 });
    if (install.status !== 0) {
      console.error(`[device] install failed: ${(install.stderr ?? '').trim()}`);
      return 1;
    }
    run('xcrun', ['simctl', 'terminate', target.udid, bundleId], { timeout: 30000 }); // fresh launch; ignore "not running"
    const launch = run('xcrun', ['simctl', 'launch', target.udid, bundleId, ...opts.launchArgs], { timeout: 60000 });
    if (launch.status !== 0) {
      console.error(`[device] launch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  } else if (isExpo) {
    // Expo managed (CNG): expo run:ios prebuilds, builds, installs, and
    // launches a development build (never Expo Go) on the resolved simulator.
    bundleId = appConfig?.ios?.bundleIdentifier ?? null;
    console.log(`[device] npx expo run:ios --no-bundler on ${target.name} (first build prebuilds ios/ — can take a while)…`);
    const runIos = run('npx', ['expo', 'run:ios', '--no-bundler', '--device', target.udid, '--configuration', configuration]);
    const buildLog = join(CACHE_DIR, 'ios-build.log');
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(buildLog, `$ npx expo run:ios --no-bundler --device ${target.udid}\n\n${runIos.stdout ?? ''}${runIos.stderr ?? ''}`);
    if (runIos.status !== 0) {
      const tail = `${runIos.stdout ?? ''}${runIos.stderr ?? ''}`.trimEnd().split('\n').slice(-25).join('\n');
      console.error(`[device] expo run:ios failed — full log at ${buildLog}. Last lines:\n${tail}`);
      return 1;
    }
    if (!bundleId) {
      // expo run:ios materialized ios/ — read the id from the generated project
      // (expo run builds to its own derived data, so our findApp cannot see it).
      const projs = (() => { try { return readdirSync('ios').filter((e) => e.endsWith('.xcodeproj')); } catch { return []; } })();
      const pbx = projs.length ? readFileSync2(join('ios', projs[0], 'project.pbxproj')) : null;
      const ids = pbx ? [...pbx.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([^";]+)"?;/g)].map((m) => m[1].trim()) : [];
      bundleId = ids.find((id) => !/tests?$/i.test(id)) ?? ids[0] ?? null;
    }
    if (!bundleId) {
      console.error('[device] could not determine the bundle identifier — set expo.ios.bundleIdentifier in app.json.');
      return 1;
    }
  } else {
    console.error('[device] no ios/ directory and no expo dependency — nothing to build for iOS.');
    return 1;
  }

  sleep(2000); // past the splash before the first screenshot
  writeState({
    ...state,
    ios: {
      kind: 'simulator',
      udid: target.udid,
      deviceName: target.name,
      bundleId,
      scheme,
      configuration,
      appPath,
      bootedByUs,
      statusBarSet: state.ios?.statusBarSet ?? false,
    },
  });
  console.log(`[device] ${bundleId} running on simulator ${target.name} (${target.udid})`);
  return 0;
}

// ============================ Android half ============================

function binOnPath(bin) {
  return spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' }).status === 0;
}

function androidTools() {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || null;
  const adb = binOnPath('adb') ? 'adb'
    : (sdkRoot && existsSync(join(sdkRoot, 'platform-tools', 'adb')) ? join(sdkRoot, 'platform-tools', 'adb') : null);
  const emulator = binOnPath('emulator') ? 'emulator'
    : (sdkRoot && existsSync(join(sdkRoot, 'emulator', 'emulator')) ? join(sdkRoot, 'emulator', 'emulator') : null);
  return { sdkRoot, adb, emulator };
}

function adbDevices(adb) {
  const res = run(adb, ['devices'], { timeout: 15000 });
  if (res.status !== 0) return [];
  return (res.stdout ?? '').split('\n').slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === 'device')
    .map((p) => p[0]);
}

function adbShell(adb, serial, args, timeout = 30000) {
  return run(adb, ['-s', serial, 'shell', ...args], { timeout });
}

function androidAppId() {
  for (const [file, re] of [
    ['android/app/build.gradle', /applicationId\s+["']([^"']+)["']/],
    ['android/app/build.gradle.kts', /applicationId\s*=\s*["']([^"']+)["']/],
  ]) {
    const m = readFileSync2(file)?.match(re);
    if (m) return m[1];
  }
  return appConfig?.android?.package ?? null;
}

function readFileSync2(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function launcherActivity(adb, serial, appId) {
  const res = adbShell(adb, serial, ['cmd', 'package', 'resolve-activity', '--brief', '-c', 'android.intent.category.LAUNCHER', appId]);
  const line = (res.stdout ?? '').trim().split('\n').map((l) => l.trim()).reverse().find((l) => l.includes('/'));
  return line ?? null;
}

function launchAndroid(adb, serial, appId, launchArgs) {
  if (launchArgs.length) {
    const component = launcherActivity(adb, serial, appId);
    if (!component) {
      console.error(`[device] could not resolve the launcher activity for ${appId}.`);
      return false;
    }
    const res = adbShell(adb, serial, ['am', 'start', '-n', component, ...launchArgs], 60000);
    if (res.status !== 0 || /Error/.test(res.stdout ?? '')) {
      console.error(`[device] launch failed: ${(res.stdout ?? res.stderr ?? '').trim()}`);
      return false;
    }
    return true;
  }
  const res = adbShell(adb, serial, ['monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], 60000);
  if (res.status !== 0) {
    console.error(`[device] launch failed: ${(res.stderr ?? res.stdout ?? '').trim()}`);
    return false;
  }
  return true;
}

async function startAndroid(opts, state) {
  const { adb, emulator } = androidTools();
  if (!adb) {
    console.log('NO ANDROID: no Android SDK or adb detected (ANDROID_HOME/ANDROID_SDK_ROOT unset, adb not on PATH) — critique iOS-only and note it in the snapshot.');
    return 3;
  }
  const configuration = opts.configuration ?? 'Debug';
  if (configuration === 'Debug' && !(await tcpReachable(metroPort()))) {
    console.error(`[device] Metro is not reachable on port ${metroPort()} — run \`metro.mjs start\` (drnf-metro start) first.`);
    return 1;
  }
  const timeoutMs = (opts.timeout ?? 300) * 1000;

  // Target: a running emulator wins; else boot an AVD detached.
  let serial = adbDevices(adb).find((s) => s.startsWith('emulator-')) ?? null;
  let bootedByUs = false;
  let avd = state.android?.avd ?? null;
  if (!serial) {
    if (!emulator) {
      console.log('NO ANDROID: adb found but the emulator binary is not — install the Android Emulator, or start a device yourself; critique iOS-only otherwise.');
      return 3;
    }
    const listRes = run(emulator, ['-list-avds'], { timeout: 30000 });
    const avdList = (listRes.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('INFO'));
    avd = opts.avd ?? avdList[0] ?? null;
    if (!avd || (opts.avd && !avdList.includes(opts.avd))) {
      console.log(`NO ANDROID: ${opts.avd ? `no AVD named "${opts.avd}"` : 'no AVDs created'} (emulator -list-avds) — create one in Android Studio; critique iOS-only otherwise.`);
      return 3;
    }
    console.log(`[device] booting emulator ${avd}…`);
    const before = new Set(adbDevices(adb));
    mkdirSync(CACHE_DIR, { recursive: true });
    const logFd = openSync(join(CACHE_DIR, 'emulator.log'), 'w');
    const child = spawn(emulator, ['-avd', avd], { detached: true, stdio: ['ignore', logFd, logFd] });
    child.unref();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !serial) {
      sleep(2000);
      serial = adbDevices(adb).find((s) => s.startsWith('emulator-') && !before.has(s)) ?? null;
    }
    if (!serial) {
      console.error(`[device] emulator did not appear in adb devices within ${timeoutMs / 1000}s — see ${join(CACHE_DIR, 'emulator.log')}.`);
      return 1;
    }
    while (Date.now() < deadline) {
      const boot = adbShell(adb, serial, ['getprop', 'sys.boot_completed'], 10000);
      if ((boot.stdout ?? '').trim() === '1') break;
      sleep(2000);
    }
    bootedByUs = true;
  }

  // Wire the debug app to the Metro bundler on the host.
  run(adb, ['-s', serial, 'reverse', `tcp:${metroPort()}`, `tcp:${metroPort()}`], { timeout: 15000 });

  let appId = androidAppId();
  if (opts.noBuild && state.android?.appId) {
    appId = state.android.appId;
    adbShell(adb, serial, ['am', 'force-stop', appId]);
    if (!launchAndroid(adb, serial, appId, opts.launchArgs)) return 1;
  } else if (existsSync('android/gradlew')) {
    // Bare / Expo prebuild: install through the Gradle wrapper, scoped to this
    // emulator via ANDROID_SERIAL.
    const task = `:app:install${configuration}`;
    console.log(`[device] android/gradlew ${task}…`);
    const build = run('android/gradlew', ['-p', 'android', task], { env: { ...process.env, ANDROID_SERIAL: serial } });
    const buildLog = join(CACHE_DIR, 'android-build.log');
    writeFileSync(buildLog, `$ android/gradlew -p android ${task}\n\n${build.stdout ?? ''}${build.stderr ?? ''}`);
    if (build.status !== 0) {
      const tail = `${build.stdout ?? ''}${build.stderr ?? ''}`.trimEnd().split('\n').slice(-25).join('\n');
      console.error(`[device] gradle install failed — full log at ${buildLog}. Last lines:\n${tail}`);
      return 1;
    }
    if (!appId) {
      console.error('[device] could not determine the applicationId from android/app/build.gradle(.kts).');
      return 1;
    }
    adbShell(adb, serial, ['am', 'force-stop', appId]); // fresh launch
    if (!launchAndroid(adb, serial, appId, opts.launchArgs)) return 1;
  } else if (isExpo) {
    // Expo managed (CNG): expo run:android prebuilds, builds, installs, and
    // launches a development build on the emulator (never Expo Go).
    console.log('[device] npx expo run:android --no-bundler (first build prebuilds android/ — can take a while)…');
    const runAndroid = run('npx', ['expo', 'run:android', '--no-bundler', '--variant', configuration.toLowerCase()], {
      env: { ...process.env, ANDROID_SERIAL: serial },
    });
    const buildLog = join(CACHE_DIR, 'android-build.log');
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(buildLog, `$ npx expo run:android --no-bundler\n\n${runAndroid.stdout ?? ''}${runAndroid.stderr ?? ''}`);
    if (runAndroid.status !== 0) {
      const tail = `${runAndroid.stdout ?? ''}${runAndroid.stderr ?? ''}`.trimEnd().split('\n').slice(-25).join('\n');
      console.error(`[device] expo run:android failed — full log at ${buildLog}. Last lines:\n${tail}`);
      return 1;
    }
    appId = appId ?? androidAppId(); // android/ may have been materialized
    if (!appId) {
      console.error('[device] could not determine the application id — set expo.android.package in app.json.');
      return 1;
    }
  } else {
    console.error('[device] no android/gradlew and no expo dependency — nothing to build for Android.');
    return 1;
  }

  sleep(2000); // past the splash before the first screenshot
  writeState({
    ...state,
    android: {
      kind: 'emulator',
      serial,
      avd,
      appId,
      configuration,
      bootedByUs: state.android?.bootedByUs || bootedByUs,
      uimodeSet: state.android?.uimodeSet ?? false,
      demoModeSet: state.android?.demoModeSet ?? false,
    },
  });
  console.log(`[device] ${appId} running on emulator ${serial}${avd ? ` (${avd})` : ''}`);
  return 0;
}

// ============================ Subcommands =============================

async function start(opts) {
  const state = readState();
  if (opts.platform === 'ios') return startIos(opts, state);
  if (opts.platform === 'android') return startAndroid(opts, state);
  console.error('[device] start needs --platform ios|android.');
  return 2;
}

function screenshot(opts) {
  const state = readState();
  const platform = resolvePlatform(opts, state);
  if (!platform || !state[platform]) {
    if (platform) console.error(`[device] no tracked ${platform} app — run \`start --platform ${platform}\` first.`);
    return 1;
  }
  if (!opts.out) {
    console.error('[device] screenshot needs --out <path>.');
    return 2;
  }
  mkdirSync(dirname(opts.out), { recursive: true });
  if (Number.isFinite(opts.settle) && opts.settle > 0) sleep(opts.settle * 1000);

  if (platform === 'ios') {
    const s = state.ios;
    if (opts.appearance) {
      run('xcrun', ['simctl', 'ui', s.udid, 'appearance', opts.appearance], { timeout: 30000 });
      sleep(2000); // let the appearance transition settle before capturing
    }
    if (!s.statusBarSet) {
      run('xcrun', ['simctl', 'status_bar', s.udid, 'override', '--time', '9:41'], { timeout: 30000 });
      writeState({ ...state, ios: { ...s, statusBarSet: true } });
    }
    const shot = run('xcrun', ['simctl', 'io', s.udid, 'screenshot', opts.out], { timeout: 30000 });
    if (shot.status !== 0) {
      console.error(`[device] screenshot failed: ${(shot.stderr ?? '').trim()}`);
      return 1;
    }
  } else {
    const s = state.android;
    const { adb } = androidTools();
    if (!adb) {
      console.log('NO ANDROID: adb is no longer available.');
      return 3;
    }
    if (opts.appearance) {
      adbShell(adb, s.serial, ['cmd', 'uimode', 'night', opts.appearance === 'dark' ? 'yes' : 'no']);
      state.android = { ...s, uimodeSet: true };
      writeState(state);
      sleep(2000);
    }
    if (!state.android.demoModeSet) {
      // The 09:41 status-bar pin, via SystemUI demo mode (restored on stop).
      adbShell(adb, s.serial, ['settings', 'put', 'global', 'sysui_demo_allowed', '1']);
      adbShell(adb, s.serial, ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'enter']);
      adbShell(adb, s.serial, ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'clock', '-e', 'hhmm', '0941']);
      state.android = { ...state.android, demoModeSet: true };
      writeState(state);
    }
    const shot = spawnSync(adb, ['-s', s.serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
    if (shot.status !== 0 || !shot.stdout?.length) {
      console.error(`[device] screenshot failed: ${(shot.stderr ?? '').toString().trim()}`);
      return 1;
    }
    writeFileSync(opts.out, shot.stdout);
  }
  console.log(opts.out);
  return 0;
}

function appearance(opts) {
  const state = readState();
  const platform = resolvePlatform(opts, state);
  if (!platform || !state[platform]) {
    if (platform) console.error(`[device] no tracked ${platform} app — run \`start --platform ${platform}\` first.`);
    return 1;
  }
  const mode = opts._[0];
  if (!['light', 'dark'].includes(mode)) {
    console.error('Usage: device.mjs appearance <light|dark> [--platform ios|android]');
    return 2;
  }
  if (platform === 'ios') {
    const res = run('xcrun', ['simctl', 'ui', state.ios.udid, 'appearance', mode], { timeout: 30000 });
    if (res.status !== 0) {
      console.error(`[device] appearance switch failed: ${(res.stderr ?? '').trim()}`);
      return 1;
    }
  } else {
    const { adb } = androidTools();
    const res = adbShell(adb, state.android.serial, ['cmd', 'uimode', 'night', mode === 'dark' ? 'yes' : 'no']);
    if (res.status !== 0) {
      console.error(`[device] appearance switch failed: ${(res.stderr ?? res.stdout ?? '').trim()}`);
      return 1;
    }
    writeState({ ...state, android: { ...state.android, uimodeSet: true } });
  }
  console.log(`[device] ${platform} appearance → ${mode}`);
  return 0;
}

function relaunch(opts) {
  const state = readState();
  const platform = resolvePlatform(opts, state);
  if (!platform || !state[platform]) {
    if (platform) console.error(`[device] no tracked ${platform} app — run \`start --platform ${platform}\` first.`);
    return 1;
  }
  if (platform === 'ios') {
    const s = state.ios;
    run('xcrun', ['simctl', 'terminate', s.udid, s.bundleId], { timeout: 30000 });
    const launch = run('xcrun', ['simctl', 'launch', s.udid, s.bundleId, ...opts.launchArgs], { timeout: 60000 });
    if (launch.status !== 0) {
      console.error(`[device] relaunch failed: ${(launch.stderr ?? '').trim()}`);
      return 1;
    }
  } else {
    const s = state.android;
    const { adb } = androidTools();
    adbShell(adb, s.serial, ['am', 'force-stop', s.appId]);
    if (!launchAndroid(adb, s.serial, s.appId, opts.launchArgs)) return 1;
  }
  sleep(2000); // past the splash before the first screenshot
  console.log(`[device] relaunched on ${platform}${opts.launchArgs.length ? ` with args: ${opts.launchArgs.join(' ')}` : ''}.`);
  return 0;
}

function status() {
  const state = readState();
  if (!state.ios && !state.android) {
    console.log('[device] no tracked app.');
    return 1;
  }
  console.log(JSON.stringify(state, null, 2));
  return 0;
}

function stopPlatform(platform, state) {
  const s = state[platform];
  if (!s) return;
  if (platform === 'ios') {
    run('xcrun', ['simctl', 'terminate', s.udid, s.bundleId], { timeout: 30000 });
    // Shut down only a simulator this script booted; never touch one the user
    // had open.
    if (s.bootedByUs) run('xcrun', ['simctl', 'shutdown', s.udid], { timeout: 60000 });
    console.log(`[device] stopped ${s.bundleId} on ${s.deviceName}.`);
  } else {
    const { adb } = androidTools();
    if (adb) {
      adbShell(adb, s.serial, ['am', 'force-stop', s.appId]);
      // Restore what this script changed — and nothing else.
      if (s.uimodeSet) adbShell(adb, s.serial, ['cmd', 'uimode', 'night', 'no']);
      if (s.demoModeSet) adbShell(adb, s.serial, ['am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', 'exit']);
      // Kill only an emulator this script booted; never one the user started.
      if (s.bootedByUs) run(adb, ['-s', s.serial, 'emu', 'kill'], { timeout: 30000 });
    }
    console.log(`[device] stopped ${s.appId} on ${s.serial}.`);
  }
  delete state[platform];
}

function stop(opts) {
  const state = readState();
  if (!state.ios && !state.android) {
    console.log('[device] nothing to stop.');
    return 0;
  }
  const platforms = opts.platform ? [opts.platform] : ['ios', 'android'];
  for (const p of platforms) stopPlatform(p, state);
  writeState(state);
  return 0;
}

const [, , sub, ...rest] = process.argv;
const opts = parseArgs(rest);
const handlers = {
  start: () => start(opts),
  screenshot: () => screenshot(opts),
  appearance: () => appearance(opts),
  relaunch: () => relaunch(opts),
  status,
  stop: () => stop(opts),
};

if (!handlers[sub]) {
  console.error('Usage: device.mjs <start|screenshot|appearance|relaunch|status|stop> [--platform ios|android] [options] [-- <launch args…>]');
  process.exit(2);
}

Promise.resolve(handlers[sub]()).then((code) => process.exit(code ?? 0));
