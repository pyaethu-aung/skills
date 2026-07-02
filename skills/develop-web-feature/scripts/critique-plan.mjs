#!/usr/bin/env node
/**
 * critique-plan.mjs
 * Derive the autonomous Phase 5 work-list from /impeccable critique's PERSISTED
 * snapshot, not from its interactive "Recommended Actions" prompt. Run from the
 * project root.
 *
 * Why: /impeccable critique always ends by handing an action plan back to the
 * user (it has no non-interactive mode), which halts a hands-free (--auto) run.
 * But critique also writes a snapshot to
 *   .impeccable/critique/<timestamp>__<slug>.md
 * with YAML frontmatter (total_score, p0_count, p1_count) and a `## Priority
 * Issues` section tagging each finding [P0]-[P3]. Reading that snapshot lets the
 * --auto loop decide deterministically what to fix (P0/P1) and what to defer
 * (P2/P3) without waiting on the prompt. The fix command per finding comes from
 * the SKILL's Phase 5 routing table, applied by the agent to each issue's text.
 *
 * Usage:
 *   node …/critique-plan.mjs                 # newest snapshot in .impeccable/critique
 *   node …/critique-plan.mjs --slug <slug>   # newest snapshot for one slug
 *   node …/critique-plan.mjs --json          # machine-readable output
 *
 * Exit code (a deterministic convergence signal, like gates.mjs):
 *   0  no P0/P1 remain      → Phase 5 has converged (remaining P2/P3 are deferred)
 *   1  P0/P1 findings remain → keep fixing
 *   2  no snapshot found / usage error
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CRITIQUE_DIR = '.impeccable/critique';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const slugIdx = args.indexOf('--slug');
const slug = slugIdx >= 0 ? args[slugIdx + 1] : null;

if (!existsSync(CRITIQUE_DIR)) {
  console.error(`[critique-plan] No ${CRITIQUE_DIR} directory — run /impeccable critique first.`);
  process.exit(2);
}

// Snapshots are `<timestamp>__<slug>.md`; ISO-like timestamps sort lexically, so
// the lexical max filename is the newest. Filter by slug when asked.
let files = readdirSync(CRITIQUE_DIR).filter((f) => f.endsWith('.md'));
if (slug) files = files.filter((f) => f.includes(`__${slug}.md`));
files.sort();
const newest = files[files.length - 1];

if (!newest) {
  console.error(`[critique-plan] No matching snapshot${slug ? ` for slug '${slug}'` : ''} in ${CRITIQUE_DIR}.`);
  process.exit(2);
}

const raw = readFileSync(join(CRITIQUE_DIR, newest), 'utf8');

// --- YAML frontmatter: simple `key: value` lines between the first two `---`. ---
const fm = {};
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
if (fmMatch) {
  for (const line of fmMatch[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
}
const score = fm.total_score ?? '?';
const p0 = Number(fm.p0_count ?? 0);
const p1 = Number(fm.p1_count ?? 0);

// --- `## Priority Issues` section: lines like `- [P2] text. Fix: ...`. ---
const findings = [];
const afterHeading = raw.split(/^##\s+Priority Issues\s*$/m)[1];
if (afterHeading) {
  const body = afterHeading.split(/^##\s+/m)[0]; // up to the next H2
  for (const line of body.split('\n')) {
    const m = line.match(/^-\s*\[(P[0-3])\]\s*(.+)$/);
    if (m) findings.push({ severity: m[1], text: m[2].trim() });
  }
}

const blocking = findings.filter((f) => f.severity === 'P0' || f.severity === 'P1');
const deferred = findings.filter((f) => f.severity === 'P2' || f.severity === 'P3');
// Frontmatter counts are authoritative for convergence; the parsed list can miss
// a finding if the body format drifts, so trust whichever is larger (err toward
// "keep fixing", never toward a false "converged").
const blockingCount = Math.max(p0 + p1, blocking.length);

if (asJson) {
  console.log(JSON.stringify({ snapshot: newest, slug: fm.slug ?? null, score, p0, p1, findings }, null, 2));
} else {
  console.log(`[critique-plan] ${fm.slug ?? newest} — score ${score}/40, P0 ${p0}, P1 ${p1} (${fm.timestamp ?? '?'})`);
  console.log('\nFix now (P0/P1):');
  console.log(blocking.length ? blocking.map((f) => `  - [${f.severity}] ${f.text}`).join('\n') : '  none');
  console.log('\nDefer to PR (P2/P3):');
  console.log(deferred.length ? deferred.map((f) => `  - [${f.severity}] ${f.text}`).join('\n') : '  none');
  console.log(
    `\n${blockingCount ? `BLOCKING: ${blockingCount} P0/P1 finding(s) remain — keep fixing.` : 'CONVERGED: no P0/P1 — remaining items are deferred.'}`,
  );
}

process.exit(blockingCount ? 1 : 0);
