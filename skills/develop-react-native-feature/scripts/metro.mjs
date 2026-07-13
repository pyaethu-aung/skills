#!/usr/bin/env node
/**
 * metro.mjs
 * Manage the Metro bundler lifecycle for hands-off critique runs, so the
 * workflow never needs raw `curl`/`lsof`/`pkill`/`kill` (which are not — and
 * should not be — auto-allowed), and never uses the `&` background operator.
 *
 *   node …/metro.mjs start [--cmd "npx expo start"] [--port 8081] [--timeout 60]
 *   node …/metro.mjs status
 *   node …/metro.mjs stop
 *
 * One Metro instance serves BOTH platforms, so its lifecycle is separate from
 * device.mjs (which only checks that the port is reachable): stopping the iOS
 * run must not kill the bundler Android still needs.
 *
 * `start`  spawns the bundler detached (default command derived from the
 *          project: `npx expo start` for Expo projects, `npx react-native
 *          start` for bare RN), waits for the port to accept connections,
 *          records pid+port in a state file, then prints the port. Idempotent:
 *          a tracked, alive, reachable bundler short-circuits. A bundler the
 *          user already runs on the port is adopted as external — status
 *          reports it, stop leaves it alone.
 * `status` prints the tracked state (exit 1 if none / not reachable).
 * `stop`   terminates the tracked process group and clears the state file;
 *          never kills an external bundler this script did not spawn.
 *
 * Pure Node built-ins, no dependencies. Run from the project root.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';

const CACHE_DIR = '.cache/develop-react-native-feature';
const STATE_PATH = `${CACHE_DIR}/metro.json`;
const LOG_PATH = `${CACHE_DIR}/metro.log`;

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cmd') out.cmd = argv[++i];
    else if (argv[i] === '--port') out.port = Number(argv[++i]);
    else if (argv[i] === '--timeout') out.timeout = Number(argv[++i]);
  }
  return out;
}

// Default bundler command, derived from the project. Expo projects go through
// the expo CLI (its dev server also serves the manifest expo run builds need);
// bare RN uses the react-native CLI. `--cmd` overrides both.
function defaultCmd(port) {
  const pkg = readJSON('package.json') ?? {};
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return deps.expo
    ? `npx expo start --port ${port}`
    : `npx react-native start --port ${port}`;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(opts) {
  const port = opts.port || 8081;
  const cmd = opts.cmd || defaultCmd(port);
  const timeoutMs = (opts.timeout || 60) * 1000;

  // Idempotent: a tracked, alive, reachable bundler short-circuits.
  const prev = readState();
  if (prev?.port && (prev.external || pidAlive(prev.pid)) && (await tcpReachable(prev.port))) {
    console.log(String(prev.port));
    return 0;
  }

  // A bundler already listening that this script did not spawn (the user's own
  // `expo start` terminal): adopt it as external — usable, never killed by stop.
  if (await tcpReachable(port)) {
    writeFileSync(STATE_PATH, JSON.stringify({ pid: null, external: true, cmd: null, port }, null, 2) + '\n');
    console.log(`[metro] adopting an external bundler already on port ${port}.`);
    console.log(String(port));
    return 0;
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const logFd = openSync(LOG_PATH, 'w');

  const [bin, ...args] = cmd.split(' ');
  const child = spawn(bin, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, CI: '1' }, // no interactive keybindings / browser opens
  });
  child.unref();
  writeFileSync(STATE_PATH, JSON.stringify({ pid: child.pid, external: false, cmd, port }, null, 2) + '\n');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) {
      console.error(`[metro] '${cmd}' exited before becoming ready. See ${LOG_PATH}.`);
      rmSync(STATE_PATH, { force: true });
      return 1;
    }
    if (await tcpReachable(port)) {
      console.log(String(port));
      return 0;
    }
    await sleep(400);
  }

  console.error(`[metro] timed out after ${timeoutMs / 1000}s waiting for port ${port}. See ${LOG_PATH}.`);
  return 1;
}

async function status() {
  const state = readState();
  if (!state?.port || (!state.external && !pidAlive(state.pid))) {
    console.error('[metro] no tracked bundler running.');
    return 1;
  }
  if (!(await tcpReachable(state.port))) {
    console.error(`[metro] tracked bundler is not reachable on port ${state.port}.`);
    return 1;
  }
  console.log(JSON.stringify(state, null, 2));
  return 0;
}

function stop() {
  const state = readState();
  if (!state?.pid) {
    if (state?.external) {
      console.log('[metro] tracked bundler is external (not spawned here) — leaving it running.');
    } else {
      console.log('[metro] nothing to stop.');
    }
    rmSync(STATE_PATH, { force: true });
    return 0;
  }
  // Detached child is a group leader: negative pid kills the whole group
  // (npx + the spawned bundler child), not just the npx wrapper.
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    try {
      process.kill(-state.pid, sig);
    } catch {
      try {
        process.kill(state.pid, sig);
      } catch {
        /* already gone */
      }
    }
    if (!pidAlive(state.pid)) break;
  }
  rmSync(STATE_PATH, { force: true });
  console.log(`[metro] stopped pid ${state.pid}.`);
  return 0;
}

const [, , sub, ...rest] = process.argv;
const handlers = {
  start: () => start(parseArgs(rest)),
  status,
  stop: () => stop(),
};

if (!handlers[sub]) {
  console.error('Usage: metro.mjs <start|status|stop> [--cmd "npx expo start"] [--port 8081] [--timeout 60]');
  process.exit(2);
}

Promise.resolve(handlers[sub]()).then((code) => process.exit(code ?? 0));
