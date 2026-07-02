#!/usr/bin/env node
/**
 * dev-server.mjs
 * Manage the project's dev server lifecycle for hands-off critique runs,
 * so the workflow never needs raw `curl`/`lsof`/`pkill`/`kill` (which are
 * not — and should not be — auto-allowed).
 *
 *   node .claude/skills/develop-web-feature/scripts/dev-server.mjs start [--cmd "npm run dev"] [--timeout 45]
 *   node .claude/skills/develop-web-feature/scripts/dev-server.mjs url
 *   node .claude/skills/develop-web-feature/scripts/dev-server.mjs stop
 *
 * `start`  spawns the dev command detached, waits for it to print a localhost
 *          URL and for that port to accept connections, records pid+url in a
 *          state file, then prints the URL. Idempotent: if a tracked server is
 *          already up it just reprints the URL.
 * `url`    prints the tracked URL (exit 1 if none / not reachable).
 * `stop`   terminates the tracked process group and clears the state file.
 *
 * Pure Node built-ins, no dependencies. Run from the project root.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';

const CACHE_DIR = '.cache/develop-web-feature';
const STATE_PATH = `${CACHE_DIR}/dev-server.json`;
const LOG_PATH = `${CACHE_DIR}/dev-server.log`;

const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\/?/i;

function readState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cmd') out.cmd = argv[++i];
    else if (argv[i] === '--timeout') out.timeout = Number(argv[++i]);
  }
  return out;
}

// Default dev command, picked from the project's package manager. Projects whose
// dev script is named differently (start, serve) pass `--cmd "<command>"`.
function defaultDevCmd() {
  if (existsSync('pnpm-lock.yaml')) return 'pnpm run dev';
  if (existsSync('yarn.lock')) return 'yarn dev';
  if (existsSync('bun.lockb') || existsSync('bun.lock')) return 'bun run dev';
  return 'npm run dev';
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

function urlParts(url) {
  try {
    const u = new URL(url);
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    // Strip the brackets URL keeps around IPv6 literals so net.connect accepts it.
    const host = u.hostname.replace(/^\[|\]$/g, '');
    return { host, port };
  } catch {
    return null;
  }
}

function tcpReachable(port, host, timeout = 1500) {
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
  const cmd = opts.cmd || defaultDevCmd();
  const timeoutMs = (opts.timeout || 45) * 1000;

  // Idempotent: a tracked, alive, reachable server short-circuits.
  const prev = readState();
  if (prev?.url && pidAlive(prev.pid)) {
    const parts = urlParts(prev.url);
    if (parts && (await tcpReachable(parts.port, parts.host))) {
      console.log(prev.url);
      return 0;
    }
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const logFd = openSync(LOG_PATH, 'w');

  const [bin, ...args] = cmd.split(' ');
  const child = spawn(bin, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  writeFileSync(STATE_PATH, JSON.stringify({ pid: child.pid, cmd, url: null }, null, 2) + '\n');

  // Poll the log for a localhost URL, then confirm the port is live.
  const deadline = Date.now() + timeoutMs;
  let url = null;
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) {
      console.error(`[dev-server] '${cmd}' exited before becoming ready. See ${LOG_PATH}.`);
      return 1;
    }
    let log = '';
    try {
      log = readFileSync(LOG_PATH, 'utf8');
    } catch {
      /* not written yet */
    }
    const match = log.match(URL_RE);
    if (match) {
      const candidate = match[0].replace(/\/$/, '');
      const parts = urlParts(candidate);
      if (parts && (await tcpReachable(parts.port, parts.host))) {
        url = candidate;
        break;
      }
    }
    await sleep(400);
  }

  if (!url) {
    console.error(`[dev-server] timed out after ${timeoutMs / 1000}s waiting for a ready URL. See ${LOG_PATH}.`);
    return 1;
  }

  writeFileSync(STATE_PATH, JSON.stringify({ pid: child.pid, cmd, url }, null, 2) + '\n');
  console.log(url);
  return 0;
}

async function url() {
  const state = readState();
  if (!state?.url || !pidAlive(state.pid)) {
    console.error('[dev-server] no tracked dev server running.');
    return 1;
  }
  const parts = urlParts(state.url);
  if (!parts || !(await tcpReachable(parts.port, parts.host))) {
    console.error('[dev-server] tracked dev server is not reachable.');
    return 1;
  }
  console.log(state.url);
  return 0;
}

function stop() {
  const state = readState();
  if (!state?.pid) {
    console.log('[dev-server] nothing to stop.');
    if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
    return 0;
  }
  // Detached child is a group leader: negative pid kills the whole group
  // (npm + the spawned dev server child), not just the npm wrapper.
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
  console.log(`[dev-server] stopped pid ${state.pid}.`);
  return 0;
}

const [, , sub, ...rest] = process.argv;
const handlers = {
  start: () => start(parseArgs(rest)),
  url,
  stop: () => stop(),
};

if (!handlers[sub]) {
  console.error('Usage: dev-server.mjs <start|url|stop> [--cmd "npm run dev"] [--timeout 45]');
  process.exit(2);
}

Promise.resolve(handlers[sub]()).then((code) => process.exit(code ?? 0));
