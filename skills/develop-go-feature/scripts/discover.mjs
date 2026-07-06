#!/usr/bin/env node
/**
 * discover.mjs
 * Emit a structured Phase 0 project overview for a Go service: module info,
 * entrypoints, Makefile targets, inferred gates, OpenAPI doc location, Docker
 * setup (and whether the project prescribes testing through it), git hooks,
 * enforcement config, and which doc files are present. Run from the project
 * root. Analytical work (feature pattern, error conventions) is still done by
 * the agent reading source files.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

function readJSON(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// --- go.mod: module path, go directive, notable dependencies ---
const goMod = readText('go.mod');
const modulePath = goMod.match(/^module\s+(\S+)/m)?.[1] ?? 'unknown';
const goDirective = goMod.match(/^go\s+(\S+)/m)?.[1] ?? 'unknown';
const toolchainDirective = goMod.match(/^toolchain\s+(\S+)/m)?.[1];

const DEP_LABELS = {
  'github.com/gin-gonic/gin':        'Gin',
  'github.com/labstack/echo':        'Echo',
  'github.com/go-chi/chi':           'chi',
  'github.com/gofiber/fiber':        'Fiber',
  'google.golang.org/grpc':          'gRPC',
  'gorm.io/gorm':                    'GORM',
  'github.com/jmoiron/sqlx':         'sqlx',
  'github.com/jackc/pgx':            'pgx',
  'github.com/pressly/goose':        'goose',
  'github.com/golang-migrate/migrate': 'golang-migrate',
  'github.com/stretchr/testify':     'testify',
  'github.com/swaggo/swag':          'swaggo (annotations generate the doc)',
  'github.com/oapi-codegen/oapi-codegen': 'oapi-codegen (doc generates the code)',
  'github.com/deepmap/oapi-codegen': 'oapi-codegen (doc generates the code)',
};
const notableDeps = Object.entries(DEP_LABELS)
  .filter(([mod]) => goMod.includes(mod))
  .map(([, label]) => label);

// --- Layout: entrypoints and multi-module flag ---
const hasGoWork = existsSync('go.work');
const entrypoints = [];
try {
  for (const d of readdirSync('cmd')) {
    if (existsSync(join('cmd', d, 'main.go'))) entrypoints.push(`cmd/${d}`);
  }
} catch { /* no cmd dir */ }
if (!entrypoints.length && existsSync('main.go')) entrypoints.push('. (root main.go)');

// --- Makefile targets ---
const makefile = readText('Makefile');
const makeTargets = [...makefile.matchAll(/^([A-Za-z0-9][A-Za-z0-9_./-]*)\s*:/gm)].map((m) => m[1]);
const GATE_SHAPED = /^(test|lint|build|run|serve|dev|e2e|integration|coverage|contract)/;
const gateShapedTargets = makeTargets.filter((t) => GATE_SHAPED.test(t));

// --- golangci-lint config ---
const golangciConfig = ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json']
  .find((p) => existsSync(p));

// --- OpenAPI doc candidates ---
const SPEC_CANDIDATES = [
  'api/openapi.yaml', 'api/openapi.yml', 'api/openapi.json',
  'openapi.yaml', 'openapi.yml', 'openapi.json',
  'swagger.yaml', 'swagger.yml', 'swagger.json',
  'docs/openapi.yaml', 'docs/openapi.yml', 'docs/openapi.json',
  'docs/swagger.yaml', 'docs/swagger.yml', 'docs/swagger.json',
];
const specs = SPEC_CANDIDATES.filter((p) => existsSync(p));
try {
  for (const f of readdirSync('api')) {
    const p = join('api', f);
    if (/\.(ya?ml|json)$/.test(f) && !specs.includes(p) && statSync(p).isFile()) specs.push(p);
  }
} catch { /* no api dir */ }

// --- Test layout ---
// git ls-files keeps this fast and vendor-free; fall back to "unknown" outside git.
let testFiles = [];
let integrationTagged = false;
try {
  const tracked = execFileSync('git', ['ls-files', '*_test.go'], { encoding: 'utf8' })
    .split('\n').filter(Boolean);
  testFiles = tracked;
  integrationTagged = tracked.some((f) => /go:build\s+integration|\+build\s+integration/.test(readText(f)));
} catch { /* not a git repo */ }
const coverageConfig = ['.testcoverage.yml', '.testcoverage.yaml'].find((p) => existsSync(p));

// --- Docker: files present, and is testing through Docker PRESCRIBED? ---
// A Dockerfile alone often exists only for deployment. Tests belong in the
// image only when the project says so: an explicit instruction in the agent
// docs (or from the user). Grep those docs for docker-and-test wording.
const dockerfiles = ['Dockerfile', 'Dockerfile.dev', 'build/Dockerfile'].filter((p) => existsSync(p));
const composeFiles = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']
  .filter((p) => existsSync(p));
let composeServices = [];
if (composeFiles.length) {
  const compose = readText(composeFiles[0]);
  const servicesBlock = compose.split(/^services:\s*$/m)[1];
  if (servicesBlock) {
    composeServices = [...servicesBlock.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  }
}
const AGENT_DOCS = ['CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md'];
const dockerTestHint = AGENT_DOCS.filter((d) => {
  const body = readText(d);
  return /docker[^\n]*\b(test|tests|testing)\b|\b(test|tests|testing)\b[^\n]*docker/i.test(body);
});
const dockerPrescribed = (dockerfiles.length || composeFiles.length) && dockerTestHint.length > 0;

// --- Git hooks ---
const hooks = [];
for (const dir of ['.githooks', '.git/hooks']) {
  if (existsSync(dir)) {
    try { readdirSync(dir).forEach((f) => hooks.push(`${dir}/${f}`)); } catch { /* ignore */ }
  }
}

// --- .claude/settings.json enforcement ---
const settings = readJSON('.claude/settings.json');
const preHooks = (settings?.hooks?.PreToolUse ?? [])
  .flatMap((h) => (h.hooks ?? []).map((hk) => hk.command));
const allowList = settings?.permissions?.allow ?? [];

// --- Inferred default gates (what gates.mjs will run without an override) ---
const inferredGates = [
  '`go build ./...`',
  '`go vet ./...`',
  ...(golangciConfig ? ['`golangci-lint run`'] : []),
  '`go test -race ./...`',
];

// --- Docs ---
const DOCS = ['CLAUDE.md', 'AGENTS.md', 'README.md', 'CONTRIBUTING.md'];

// --- Output ---
const lines = [
  '## Project Discovery',
  '',
  `**Module:** ${modulePath}`,
  `**Go directive:** ${goDirective}${toolchainDirective ? ` (toolchain ${toolchainDirective})` : ''}`,
  `**go.work:** ${hasGoWork ? 'yes — multi-module workspace; gates run on the cwd module only (pin others via gates.json)' : 'no'}`,
  `**Notable deps:** ${notableDeps.length ? notableDeps.join(', ') : 'none recognized'}`,
  `**Entrypoints:** ${entrypoints.length ? entrypoints.join(', ') : 'none found (no cmd/*/main.go or root main.go)'}`,
  '',
  '### Makefile',
  ...(makeTargets.length
    ? [
        `Targets: ${makeTargets.map((t) => `\`${t}\``).join(', ')}`,
        ...(gateShapedTargets.length
          ? [`Gate/run-shaped: ${gateShapedTargets.map((t) => `\`make ${t}\``).join(', ')}`]
          : []),
      ]
    : ['- no Makefile (or no targets found)']),
  '',
  '### Inferred Gates (gates.mjs defaults)',
  inferredGates.map((g) => `- ${g}`).join('\n'),
  golangciConfig
    ? `- lint config: \`${golangciConfig}\``
    : '- no golangci config found; lint gate skipped unless pinned via gates.json',
  coverageConfig
    ? `- coverage config: \`${coverageConfig}\``
    : '- no coverage config found; --coverage needs a threshold in gates.json',
  '',
  '### OpenAPI / Swagger doc',
  ...(specs.length
    ? specs.map((s) => `- \`${s}\``)
    : ['- none found — ask where the API contract lives (or whether annotations generate it)']),
  '',
  '### Tests',
  `- \`*_test.go\` files: ${testFiles.length || 'unknown (not a git repo?)'}`,
  `- integration build tags: ${integrationTagged ? 'yes (`-tags=integration`)' : 'not detected'}`,
  '',
  '### Docker',
  `- Dockerfile: ${dockerfiles.length ? dockerfiles.map((d) => `\`${d}\``).join(', ') : 'none'}`,
  `- Compose: ${composeFiles.length ? `\`${composeFiles[0]}\`${composeServices.length ? ` (services: ${composeServices.join(', ')})` : ''}` : 'none'}`,
  `- Testing through Docker prescribed: ${
    dockerPrescribed
      ? `likely — docker+test wording in ${dockerTestHint.join(', ')}; verify, then pin docker-based commands in .cache/develop-go-feature/gates.json`
      : 'no explicit instruction found — run gates natively unless the user says otherwise'
  }`,
  '',
  '### Git Hooks',
  ...(hooks.length ? hooks.map((h) => `- \`${h}\``) : ['- none found']),
  '',
  '### Enforcement (.claude/settings.json)',
  ...(preHooks.length
    ? ['PreToolUse hooks:', ...preHooks.map((h) => `  - \`${h}\``)]
    : ['- no PreToolUse hooks configured']),
  ...(allowList.length
    ? ['Allow list:', ...allowList.map((e) => `  - \`${e}\``)]
    : []),
  '',
  '### Docs',
  ...DOCS.map((d) => `- ${d}: ${existsSync(d) ? '✓' : '✗'}`),
];

console.log(lines.join('\n'));
