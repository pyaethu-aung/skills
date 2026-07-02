#!/usr/bin/env node
/**
 * discover.mjs
 * Emit a structured Phase 0 project overview: scripts, version, inferred
 * gates, git hooks, enforcement config, and which doc files are present.
 * Run from the project root. Analytical work (feature pattern, design system)
 * is still done by the agent reading source files.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

const pkg = readJSON('package.json');
const scripts = pkg?.scripts ?? {};
const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };

// Framework / toolchain detection
const detect = (map) =>
  Object.entries(map)
    .filter(([k]) => deps?.[k])
    .map(([k, label]) => label(deps[k]));

const frameworks = detect({
  react:   v => `React ${v}`,
  next:    v => `Next.js ${v}`,
  vue:     v => `Vue ${v}`,
  svelte:  v => `Svelte ${v}`,
  angular: v => `Angular ${v}`,
});
const buildTools = detect({
  vite:    v => `Vite ${v}`,
  webpack: v => `webpack ${v}`,
  esbuild: v => `esbuild ${v}`,
  turbo:   v => `Turborepo ${v}`,
  rollup:  v => `Rollup ${v}`,
});
const testRunners = detect({
  vitest:             v => `Vitest ${v}`,
  jest:               v => `Jest ${v}`,
  '@playwright/test': v => `Playwright ${v}`,
  mocha:              v => `Mocha ${v}`,
});

// Heuristic gate detection
const GATE_PATTERNS = ['test', 'lint', 'build', 'typecheck', 'type-check', 'check', 'tsc'];
const gateKeys = Object.keys(scripts).filter(k =>
  GATE_PATTERNS.some(p => k === p || k.startsWith(p + ':'))
);

// Git hooks
const hooks = [];
for (const dir of ['.githooks', '.git/hooks']) {
  if (existsSync(dir)) {
    try { readdirSync(dir).forEach(f => hooks.push(`${dir}/${f}`)); } catch { /* ignore */ }
  }
}

// .claude/settings.json enforcement
const settings = readJSON('.claude/settings.json');
const preHooks = (settings?.hooks?.PreToolUse ?? [])
  .flatMap(h => (h.hooks ?? []).map(hk => hk.command));
const allowList = settings?.permissions?.allow ?? [];

// Browser driver for the live-UI critique (and the e2e gate). Policy: prefer the
// Playwright CLI when present (it is also what a `playwright test` gate and CI
// use); fall back to a Playwright MCP server only when the CLI is absent; if
// neither is configured, the CLI is the default and gets installed.
const cliPresent = Boolean(deps?.['@playwright/test'] || deps?.['playwright']);

// Browser binaries the CLI needs (best-effort cache check).
const browserCacheDir =
  process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0'
    ? process.env.PLAYWRIGHT_BROWSERS_PATH
    : platform() === 'darwin'
      ? `${homedir()}/Library/Caches/ms-playwright`
      : platform() === 'win32'
        ? `${process.env.LOCALAPPDATA || homedir()}\\ms-playwright`
        : `${homedir()}/.cache/ms-playwright`;
let browsersInstalled = false;
try {
  browsersInstalled =
    existsSync(browserCacheDir) && readdirSync(browserCacheDir).some((n) => /^(chromium|firefox|webkit)/.test(n));
} catch {
  /* unreadable — treat as not installed */
}

// Playwright MCP server declared in the project .mcp.json. User/global MCP
// configs are outside this script; the agent also knows from its available tools.
const mcpServers = readJSON('.mcp.json')?.mcpServers ?? {};
const mcpPlaywright = Object.entries(mcpServers).some(
  ([name, def]) =>
    /playwright/i.test(name) || (Array.isArray(def?.args) && def.args.some((a) => /@playwright\/mcp/i.test(String(a)))),
);

// Apply the policy.
let browserDriver, driverNote;
if (cliPresent) {
  browserDriver = 'CLI';
  driverNote = browsersInstalled
    ? 'Playwright CLI present and browsers installed.'
    : 'Playwright CLI present; run `npx playwright install chromium` once (cached).';
} else if (mcpPlaywright) {
  browserDriver = 'MCP';
  driverNote = 'No Playwright CLI dependency; a Playwright MCP server is configured, so drive critique through its browser tools.';
} else {
  browserDriver = 'CLI (default)';
  driverNote = 'Neither configured; install the CLI: `npm i -D @playwright/test && npx playwright install chromium`.';
}

// Docs
const DOCS = ['CLAUDE.md', 'AGENTS.md', 'README.md', 'DESIGN.md', 'PRODUCT.md'];

// Output
const lines = [
  '## Project Discovery',
  '',
  `**Version:** ${pkg?.version ?? 'unknown'}`,
  `**Framework:** ${frameworks.length ? frameworks.join(', ') : 'not detected'}`,
  `**Build tool:** ${buildTools.length ? buildTools.join(', ') : 'not detected'}`,
  `**Test runner:** ${testRunners.length ? testRunners.join(', ') : 'not detected'}`,
  `**TypeScript:** ${deps?.typescript ? `yes (${deps.typescript})` : 'no'}`,
  '',
  '### npm Scripts',
  ...Object.entries(scripts).map(([k, v]) => `- \`${k}\`: \`${v}\``),
  '',
  '### Suggested Gates',
  gateKeys.length
    ? `\`${gateKeys.map(s => `npm run ${s}`).join(' && ')}\``
    : 'None detected — inspect scripts above and confirm with the user.',
  '',
  '### Browser driver (live-UI critique + e2e)',
  `- Playwright CLI dep: ${cliPresent ? 'yes' : 'no'}`,
  ...(cliPresent
    ? [`- Browser binaries: ${browsersInstalled ? `installed (\`${browserCacheDir}\`)` : 'not found, run `npx playwright install chromium`'}`]
    : []),
  `- Playwright MCP (.mcp.json): ${mcpPlaywright ? 'yes' : 'no'}`,
  `- Recommended driver: **${browserDriver}** (${driverNote})`,
  '',
  '### Git Hooks',
  ...(hooks.length ? hooks.map(h => `- \`${h}\``) : ['- none found']),
  '',
  '### Enforcement (.claude/settings.json)',
  ...(preHooks.length
    ? ['PreToolUse hooks:', ...preHooks.map(h => `  - \`${h}\``)]
    : ['- no PreToolUse hooks configured']),
  ...(allowList.length
    ? ['Allow list:', ...allowList.map(e => `  - \`${e}\``)]
    : []),
  '',
  '### Docs',
  ...DOCS.map(d => `- ${d}: ${existsSync(d) ? '✓' : '✗'}`),
];

console.log(lines.join('\n'));
