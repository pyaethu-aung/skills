#!/usr/bin/env node
/**
 * server.mjs
 * Manage the Go service's lifecycle for the verify phase (contract testing
 * against the live app), so the workflow never needs raw `curl`/`lsof`/
 * `pkill`/`kill` (which are not — and should not be — auto-allowed).
 *
 *   node .claude/skills/develop-go-feature/scripts/server.mjs start [--cmd "make run"] [--timeout 60]
 *   node .claude/skills/develop-go-feature/scripts/server.mjs url
 *   node .claude/skills/develop-go-feature/scripts/server.mjs stop
 *
 * `start`  spawns the serve command detached, waits for the health endpoint
 *          (or the port) to answer, records pid+url in a state file, then
 *          prints the base URL. Idempotent: if a tracked server is already up
 *          it just reprints the URL.
 * `url`    prints the tracked URL (exit 1 if none / not reachable).
 * `stop`   terminates the tracked process group and clears the state file.
 *
 * Command resolution, first hit wins:
 *   1. .cache/develop-go-feature/server.json — {"command": "...", "url":
 *      "http://localhost:8080", "health": "/healthz"}. Pin a compose-based
 *      command here when the service itself runs in Docker.
 *   2. A Makefile target named run, serve, or dev.
 *   3. Exactly one cmd/<name>/main.go → `go run ./cmd/<name>`.
 * Otherwise it exits with instructions to write server.json.
 *
 * Pure Node built-ins, no dependencies. Run from the project root.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

const CACHE_DIR = '.cache/develop-go-feature';
const CONFIG_PATH = `${CACHE_DIR}/server.json`;
const STATE_PATH = `${CACHE_DIR}/server-state.json`;
const LOG_PATH = `${CACHE_DIR}/server.log`;

const HEALTH_PATHS = ['/healthz', '/health'];

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cmd') out.cmd = argv[++i];
    else if (argv[i] === '--timeout') out.timeout = Number(argv[++i]);
  }
  return out;
}

// Resolve the serve command and expected URL (see resolution order above).
function resolveConfig(opts) {
  const pinned = readJSON(CONFIG_PATH) ?? {};
  const url = pinned.url || `http://localhost:${process.env.PORT || 8080}`;
  const health = pinned.health ?? null;
  if (opts.cmd) return { cmd: opts.cmd, url, health };
  if (pinned.command) return { cmd: pinned.command, url, health };

  const makefile = readText('Makefile');
  const targets = new Set([...makefile.matchAll(/^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:/gm)].map((m) => m[1]));
  const runTarget = ['run', 'serve', 'dev'].find((t) => targets.has(t));
  if (runTarget) return { cmd: `make ${runTarget}`, url, health };

  let mains = [];
  try {
    mains = readdirSync('cmd').filter((d) => existsSync(join('cmd', d, 'main.go')));
  } catch { /* no cmd dir */ }
  if (mains.length === 1) return { cmd: `go run ./cmd/${mains[0]}`, url, health };

  console.error(
    mains.length > 1
      ? `[server] Multiple entrypoints (${mains.map((m) => `cmd/${m}`).join(', ')}) — pin one in ${CONFIG_PATH}:`
      : `[server] No run/serve/dev make target and no single cmd/*/main.go — pin the command in ${CONFIG_PATH}:`,
  );
  console.error('  {"command": "go run ./cmd/api", "url": "http://localhost:8080", "health": "/healthz"}');
  return null;
}

function readState() {
  return readJSON(STATE_PATH);
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

// Health probe: any HTTP response (even 404) proves the server is up; a pinned
// health path additionally demands a 2xx. fetch is built into Node 18+.
async function healthOk(baseUrl, healthPath) {
  const paths = healthPath ? [healthPath] : HEALTH_PATHS;
  for (const p of paths) {
    try {
      const res = await fetch(new URL(p, baseUrl), { signal: AbortSignal.timeout(1500) });
      if (healthPath ? res.ok : true) return true;
    } catch { /* try the next path */ }
  }
  if (healthPath) return false;
  // No pinned health path and the well-known paths 404'd or refused: fall back
  // to a bare TCP check so unconventional services still pass.
  const parts = urlParts(baseUrl);
  return parts ? tcpReachable(parts.port, parts.host) : false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(opts) {
  const config = resolveConfig(opts);
  if (!config) return 1;
  const { cmd, url: baseUrl, health } = config;
  const timeoutMs = (opts.timeout || 60) * 1000;

  // Idempotent: a tracked, alive, healthy server short-circuits.
  const prev = readState();
  if (prev?.url && pidAlive(prev.pid)) {
    if (await healthOk(prev.url, health)) {
      console.log(prev.url);
      return 0;
    }
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const logFd = openSync(LOG_PATH, 'w');

  const [bin, ...cmdArgs] = cmd.split(' ');
  const child = spawn(bin, cmdArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  writeFileSync(STATE_PATH, JSON.stringify({ pid: child.pid, cmd, url: baseUrl }, null, 2) + '\n');

  // Poll until the service answers (or the process dies / the clock runs out).
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(child.pid)) {
      console.error(`[server] '${cmd}' exited before becoming ready. See ${LOG_PATH}.`);
      rmSync(STATE_PATH, { force: true });
      return 1;
    }
    if (await healthOk(baseUrl, health)) {
      console.log(baseUrl);
      return 0;
    }
    await sleep(500);
  }

  console.error(`[server] timed out after ${timeoutMs / 1000}s waiting for ${baseUrl} to answer. See ${LOG_PATH}.`);
  console.error(`[server] If the service listens elsewhere, pin "url" (and "health") in ${CONFIG_PATH}.`);
  return 1;
}

async function url() {
  const state = readState();
  if (!state?.url || !pidAlive(state.pid)) {
    console.error('[server] no tracked server running.');
    return 1;
  }
  const health = readJSON(CONFIG_PATH)?.health ?? null;
  if (!(await healthOk(state.url, health))) {
    console.error('[server] tracked server is not reachable.');
    return 1;
  }
  console.log(state.url);
  return 0;
}

function stop() {
  const state = readState();
  if (!state?.pid) {
    console.log('[server] nothing to stop.');
    if (existsSync(STATE_PATH)) rmSync(STATE_PATH);
    return 0;
  }
  // Detached child is a group leader: negative pid kills the whole group
  // (make + the spawned go binary), not just the wrapper.
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
  console.log(`[server] stopped pid ${state.pid}.`);
  return 0;
}

const [, , sub, ...rest] = process.argv;
const handlers = {
  start: () => start(parseArgs(rest)),
  url,
  stop: () => stop(),
};

if (!handlers[sub]) {
  console.error('Usage: server.mjs <start|url|stop> [--cmd "make run"] [--timeout 60]');
  process.exit(2);
}

Promise.resolve(handlers[sub]()).then((code) => process.exit(code ?? 0));
