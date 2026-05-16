---
name: test-design
description: Use when validating that a live website matches its design system and design file. Compares design tokens, component presence, layout/spacing, visual snapshots, and usability against a design source (Pencil, Figma, exported JSON/PNG) using Playwright.
metadata:
  version: "1.0.0"
argument-hint: "[optional website URL] [optional design source path or URL]"
allowed-tools: Bash(npx playwright:*) Bash(npx --yes playwright:*) Bash(node:*) Bash(find:*) Bash(grep:*) Bash(ls:*) Bash(mkdir:*) Bash(curl:*) Bash(test:*) Bash(jq:*) Bash(lsof:*) Bash(ss:*) Bash(awk:*) Bash(sort:*) Bash(for:*) Bash(head:*) Bash(echo:*) Read Write WebFetch
---

# Design Test Rules

Follow these rules when testing a live website against its design system and design file.

## Arguments

The skill accepts up to two optional arguments, in any order:

- A **website URL** (`http://` or `https://`) — the live site to test
- A **design source** — `.pen` file, `tokens.json`/`theme.json`, Figma file URL, or directory of PNG exports

Examples:
- `/test-design https://staging.example.com ./design/home.pen`
- `/test-design https://staging.example.com`
- `/test-design` (auto-discover everything)

If a needed input is missing, the skill prompts before running anything.

---

## Step 1: Resolve the website URL

If the user passed a URL argument, use it. Any scheme/host is valid — `https://staging.example.com`, `http://localhost:3000`, `http://127.0.0.1:5173` all work.

If no URL was passed, **detect a dev server already running for the current project** before falling back to config scanning.

### 1a. List listening localhost ports

macOS / Linux with `lsof`:

```!
lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | awk 'NR>1 {print $9}' | grep -oE '[0-9]+$' | sort -u
```

Linux without `lsof`:

```!
ss -tlnH 2>/dev/null | awk '{print $4}' | grep -oE '[0-9]+$' | sort -u
```

### 1b. Keep only HTML responders

For each listening port, send a short HEAD request and keep the ones that look like a web app:

```bash
for p in $PORTS; do
  ct=$(curl -sS -I -m 1 "http://localhost:$p/" 2>/dev/null | grep -i '^content-type:' | head -1)
  echo "$ct" | grep -qi 'text/html' && echo "http://localhost:$p"
done
```

### 1c. Match to the current project

Read `package.json` (and any of `next.config.*`, `vite.config.*`, `astro.config.*`, `nuxt.config.*`, `svelte.config.*`, `remix.config.*`, `angular.json`) to infer the framework's default port:

| Framework | Default port |
|---|---|
| Next.js / Remix / CRA / Nuxt | 3000 |
| Vite / SvelteKit | 5173 |
| Astro | 4321 |
| Angular | 4200 |
| Storybook | 6006 |
| Django / Flask | 8000 |
| Rails | 3000 |

- If exactly one HTML responder matches the inferred port, confirm it and use it.
- If multiple HTML responders are up, fetch each one's `<title>` and list them — ask the user which to test.
- If none are up, fall back to scanning project config for an explicit URL:

```!
grep -rIh -m1 -E "https?://(localhost|127\.0\.0\.1|[a-z0-9.-]+\.(dev|test|staging|preview)[a-z0-9./:-]*)(:[0-9]+)?" package.json .env .env.local .env.development README.md 2>/dev/null | sort -u | head -5
```

- If still nothing, ask the user for a URL, or offer to wait while they start the dev server (`npm run dev`, `pnpm dev`, etc.) and re-run detection.

Never auto-start the dev server. Do not proceed without a confirmed URL.

---

## Step 2: Locate the design system

The design system is the source of truth for tokens (colors, typography, spacing, radii, shadows) and components.

### Search order

1. `src/design-system/`
2. `packages/design-system/`, `packages/ui/`, `packages/tokens/`
3. `src/theme/`, `src/styles/tokens/`
4. Top-level `tokens.json`, `theme.json`, `design-tokens.json`
5. `tailwind.config.{js,ts,mjs,cjs}` (Tailwind themes count as a token source)

```!
find . -maxdepth 5 -type d \
  \( -name "design-system" -o -name "tokens" -o -name "theme" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -10
```

```!
find . -maxdepth 3 -type f \
  \( -name "tokens.json" -o -name "theme.json" -o -name "design-tokens.json" -o -name "tailwind.config.*" \) \
  -not -path "*/node_modules/*" 2>/dev/null | head -10
```

If multiple sources are found, list them and ask. If none, ask the user to point at one — or to skip design-system checks and run only design-file comparison.

### Extract tokens

Read the resolved source and build a normalized token map:

```
{
  "color":   { "primary": "#1d4ed8", "background": "#ffffff", ... },
  "spacing": { "sm": "8px", "md": "16px", ... },
  "font":    { "body": "Inter, ...", "size.base": "16px", ... },
  "radius":  { "sm": "4px", "md": "8px", ... },
  "shadow":  { "card": "...", ... }
}
```

For Tailwind configs, evaluate the file in Node and read `theme` + `theme.extend`. For Style Dictionary / Tokens Studio JSON, flatten the nested `$value` shape.

---

## Step 3: Locate the design source (design file)

### If the user passed a design-source argument

Use it directly. Detect type by extension / URL:

- `*.pen` → **Pencil**, via the Pencil MCP (see below)
- `figma.com/file/...` or `figma.com/design/...` → **Figma**
- `*.json` → exported tokens or layout data
- A directory of `*.png` / `*.jpg` → screenshot exports (visual diff only)

### If no argument was passed

Try these in order and stop at the first match:

1. **Pencil**: `find . -maxdepth 4 -name "*.pen" -not -path "*/node_modules/*" 2>/dev/null | head -5`
2. **Figma**: look in `.env*` and `README.md` for `FIGMA_FILE_URL`, `FIGMA_FILE_KEY`, or a `figma.com/...` link
3. **Loaded MCP**: if the conversation has Pencil or Figma MCP tools available (e.g. `mcp__pencil__*`, `mcp__figma__*`), ask the user which document to open
4. **Exported assets**: `find . -maxdepth 4 -type d -name "design" -o -name "designs" -o -name "mockups" 2>/dev/null | head -5`

If nothing is found, ask the user. They may also choose to skip design-file checks and run only design-system + usability checks against the live site.

### Reading the design source

| Source | How |
|---|---|
| Pencil `.pen` | Pencil MCP only: `open_document`, then `get_variables` for tokens, `batch_get` for node geometry, `get_screenshot` for visual refs. **Never use `Read` or `Grep` on `.pen` files.** |
| Figma (MCP loaded) | Use the Figma MCP tools that are present |
| Figma (REST) | Ask the user for a personal access token if not in env. `curl -s -H "X-Figma-Token: $TOKEN" "https://api.figma.com/v1/files/<key>"`. Treat the token as secret — never echo it |
| Tokens JSON | `Read` the file and normalize to the map shape in Step 2 |
| PNG/JPG directory | List files; each becomes a baseline for the screenshot-diff check, keyed by filename → route |

---

## Step 4: Select the Playwright executor

Try in priority order:

### 4a. Playwright CLI (preferred)

```!
npx --yes playwright --version 2>/dev/null || true
```

If a version prints, use the CLI. If chromium isn't installed yet, prompt the user before running `npx playwright install chromium` — this downloads ~150 MB.

Write a temporary runner under `.test-design/` (gitignored). The runner is a plain Node script using the `playwright` package, not a full `playwright test` project — this keeps the skill self-contained and avoids touching the user's existing test config.

### 4b. Playwright MCP (fallback)

If the CLI isn't available but a Playwright MCP server is loaded (tools matching `mcp__playwright__*` or similar), use those tools instead. Note this in the pre-flight summary so the user knows which executor is in use.

### 4c. Neither

Stop and tell the user:

> "Playwright is not available. Install it with `npm i -D playwright && npx playwright install chromium`, or load a Playwright MCP server, then re-run `/test-design`."

---

## Step 5: Pre-flight summary

Before any browser launches, show:

```
Website:        <url>
Viewport(s):    1440x900 (desktop), 390x844 (mobile)
Executor:       Playwright CLI 1.48 | Playwright MCP
Design system:  <path>           (<N> tokens loaded)
Design source:  <path or URL>    (<N> frames / <N> components)

Checks to run:
  ✓ Design tokens         (computed CSS vars vs design-system tokens)
  ✓ Component presence    (every design-system component rendered somewhere)
  ✓ Layout & spacing      (bounding boxes vs design-file frames)
  ✓ Visual snapshot       (per-route screenshot diff vs design exports)
  ✓ Usability             (axe-core a11y, tap-target ≥ 44px, focus-visible, contrast)

Routes:
  /
  /pricing
  /docs

Proceed? [yes / pick checks / change routes / cancel]
```

Discover routes from the user's framework (`app/`, `pages/`, `routes/`) or ask. Do not run anything until the user confirms.

---

## Step 6: Run checks

Run checks in the order listed. Reuse a single browser context per viewport.

### 6a. Design tokens

For each route and each viewport:

1. `page.goto(url)`
2. Evaluate in the page:
   ```js
   const root = document.documentElement;
   const cs  = getComputedStyle(root);
   const vars = {};
   for (let i = 0; i < cs.length; i++) {
     const n = cs[i];
     if (n.startsWith('--')) vars[n] = cs.getPropertyValue(n).trim();
   }
   return vars;
   ```
3. Compare each design-system token to its computed value. Match by name first (`--color-primary` ↔ `color.primary`), then by value for unnamed tokens.
4. Flag: missing tokens, value drift (color ΔE > 2, spacing > 1px diff, font-family mismatch).

### 6b. Component presence

For every component declared in the design system (file name, exported symbol, Storybook story, or Pencil/Figma component):

- Try `data-component="<name>"`, `data-testid="<name>"`, `[class*="<name>"]`, role/text fallbacks
- Mark **present** / **missing** / **ambiguous (multiple matches)**

### 6c. Layout & spacing

For each component or design-file frame with known coordinates:

- Get the live element's `boundingClientRect()`
- Normalize to the design-file artboard size
- Flag: position off by > 4px, size off by > 4px, padding/gap off by > 2px

Skip this check silently if the design source has no coordinate data (e.g. a tokens-only JSON).

### 6d. Visual snapshot

- `page.screenshot({ fullPage: true })` per route × viewport
- Compare to the design-file export for that route (Pencil `get_screenshot`, Figma image export, or matching PNG by filename)
- Use `pixelmatch` with `threshold: 0.1`; flag any route with > 1% changed pixels
- Save diffs to `.test-design/diffs/<route>-<viewport>.png`

### 6e. Usability

Run on each route at desktop viewport:

- **a11y**: inject `axe-core` and report violations (impact ≥ serious by default)
- **Tap targets**: every interactive element ≥ 44×44 px
- **Focus visible**: tab through; flag any focused element with no outline / box-shadow change
- **Contrast**: text vs computed background ≥ 4.5:1 (or 3:1 for ≥ 18 pt)

---

## Step 7: Report results

### Default output: pass/fail summary

```
Results: <pass>/<total> checks passed

Tokens           23/25   ⚠️  2 drifted
Components       11/12   ❌  1 missing
Layout           18/18   ✅
Visual snapshot   3/4    ❌  1 route over threshold
Usability        47/49   ⚠️  2 serious a11y issues

─────────────────────────────────────────────────
Failures (2):

  ❌ Component: PricingCard
     Expected on /pricing (defined in src/design-system/PricingCard.tsx)
     Not found — no [data-component], [data-testid], or matching class

  ❌ Visual snapshot: /docs (1440x900)
     2.7% pixels changed vs design/docs.png
     Diff: .test-design/diffs/docs-1440x900.png

Warnings (4):
  ⚠️  --color-primary  #2563eb live  vs  #1d4ed8 design  (ΔE 3.4)
  ⚠️  spacing.md       18px live      vs  16px design
  ⚠️  a11y: button on / has no accessible name
  ⚠️  a11y: <img> on /docs missing alt
─────────────────────────────────────────────────

Write the full report to test-design-report.md? [yes / no]
```

### Full report (only on request)

If the user says yes, `Write` a markdown file `test-design-report.md` containing:

1. Run metadata (website, executor, design system path, design source, timestamp)
2. One section per check with full per-item results
3. Inline screenshot diffs (relative paths into `.test-design/diffs/`)
4. Token tables (live | design | delta)
5. Suggested fixes where unambiguous (e.g. "update `--color-primary` to `#1d4ed8`")

Append `.test-design/` to `.gitignore` if it isn't already.

---

## Constraints

- **Non-destructive** — never `npm install` without confirmation; never modify the user's Playwright config or existing tests
- **Pencil files are encrypted** — only access `.pen` via the Pencil MCP tools, never via `Read`/`Grep`
- **No secrets in output** — Figma tokens, API keys, and any value from `.env*` are redacted as `<redacted>` in everything printed or written
- **Playwright CLI first** — only fall back to Playwright MCP if the CLI is unavailable; surface the choice in the pre-flight summary
- **Confirm before browser install** — `npx playwright install` downloads large binaries; always ask first
- **Skip gracefully** — if a check has no source data (no design file, no Storybook, no coordinates), skip it and note it in the report rather than failing
- **Bounded scope** — test only the routes confirmed in pre-flight; do not crawl
