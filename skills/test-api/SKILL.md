---
name: test-api
description: Use when testing API endpoints against an OpenAPI/Swagger specification. Discovers or loads the spec, executes requests against each endpoint, and validates responses.
metadata:
  version: "1.1.0"
argument-hint: "[--yes] [--all] [OpenAPI doc URL or file path] [target base URL]"
allowed-tools: Bash(find:*) Bash(curl:*) Bash(grep:*) Bash(ls:*) Bash(echo:*) Bash(sleep:*) Bash(rm -f .cache/test-api/*) Read Write WebFetch
---

# API Test Rules

Follow these rules when testing APIs against an OpenAPI specification.

## Arguments

Parse the invocation arguments:

- `--yes` — autonomous mode: skip the pre-flight pause (see Step 3)
- `--all` — include mutating endpoints; fully honored only against a local
  target (see Step 3)
- The **first non-flag argument** is the spec source
  (e.g. `/test-api https://api.example.com/openapi.json` or
  `/test-api ./docs/openapi.yaml`)
- The **second non-flag argument** is a target base URL override: requests go
  there instead of the spec's `servers` entry
  (e.g. `/test-api api/openapi.yaml http://localhost:8080` to test a locally
  running service whose spec advertises a deployed URL)

If no spec source was provided, search the project for API documentation.

---

## Step 1: Locate the API specification

### If a spec source was provided

- If it starts with `http://` or `https://`, fetch it via WebFetch
- If it's a file path, read it with the Read tool

### If no argument was provided

Search the project for OpenAPI/Swagger files:

```!
find . -type f \( -name "openapi.yaml" -o -name "openapi.yml" -o -name "openapi.json" -o -name "swagger.yaml" -o -name "swagger.yml" -o -name "swagger.json" \) | grep -v vendor | grep -v node_modules | grep -v ".git" | head -10
```

Also search for files with embedded spec markers:

```!
grep -rl "openapi:" . --include="*.yaml" --include="*.yml" --include="*.json" 2>/dev/null | grep -v vendor | grep -v node_modules | grep -v ".git" | head -10
```

If multiple files are found, list them and ask the user which to use.

If none are found, stop and tell the user:
"No OpenAPI spec found in this project. Provide a path or URL as an argument: `/test-api <path-or-url>`"

---

## Step 2: Parse the specification

From the spec, extract:

- **Version**: OpenAPI 3.x (`openapi:` field) or Swagger 2.x (`swagger:` field)
- **Base URL**:
  - A target base URL override argument always wins when one was passed
  - Otherwise OpenAPI 3.x: `servers[0].url`
  - Otherwise Swagger 2.x: combine `host` + `basePath` + `schemes[0]`
- **Endpoints**: every path + HTTP method combination
- **Operations**: for each endpoint, its `operationId`, parameters, request body schema, and expected response codes/schemas

A base URL is **local** when its host is `localhost`, `127.0.0.1`, `::1`, or
`0.0.0.0`; everything else is a shared environment, and the mutating-endpoint
rules below treat it accordingly.

If the resolved base URL contains template variables (e.g. `https://{host}`),
ask the user to fill them in (or pass an override) before continuing.

---

## Step 3: Pre-flight check

Mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) can modify or destroy data.
By default, only `GET` and `HEAD` endpoints are tested.

Show the user a summary before running any tests:

```
Spec:       <file path or URL>
Base URL:   <resolved base URL>
Endpoints:  <N> total  (<R> read-only, <M> mutating)

Read-only endpoints (will test):
  GET    /users
  GET    /users/{id}
  HEAD   /users

Mutating endpoints (skipped by default):
  POST   /users
  PUT    /users/{id}
  PATCH  /users/{id}
  DELETE /users/{id}

Authentication: <none detected | Bearer token | API key>

Options:
  yes               — test read-only endpoints only
  include mutating  — test all endpoints (confirm again before each DELETE)
  configure auth    — set auth credentials before testing
  cancel            — stop
```

Do not run any requests until the user responds (unless `--yes` was passed;
see below).

**Autonomous mode (`--yes`).** Print the summary above, then proceed without
pausing:

- **Read-only endpoints always run.** This is the safe default on any target.
- **Mutating endpoints run only with `--all` AND a local base URL** (as
  defined in Step 2) — a fully autonomous run against your own machine,
  including `POST`/`PUT`/`PATCH`/`DELETE` with no per-request confirmation.
- **Against a non-local target, `--all` is ignored:** mutating endpoints are
  skipped and listed as warnings. Testing them against shared infrastructure
  always requires an interactive run and its confirmations.
- **Auth:** if the spec declares a security scheme and no credential was
  provided beforehand, proceed unauthenticated; report auth-rejected
  endpoints (401/403) as warnings with a hint to re-run with configured
  auth, not as plain failures.

---

## Step 4: Authentication (if needed)

If the spec declares a security scheme or the user chose "configure auth":

- Ask for the required credential (token, API key, etc.)
- Never log it or embed it in output shown to the user
- **Never place the raw credential in a Bash command line** — it would land
  in the session transcript, shell history, and process list. Instead, write
  the header line to `.cache/test-api/headers` with the Write tool:
  ```
  Authorization: Bearer <token>
  ```
  and make sure `.cache/test-api/` is listed in `.gitignore` first (add the
  entry if missing, before the file exists)
- Pass it to curl with `-H @.cache/test-api/headers` on all subsequent
  requests
- Delete the file when testing completes: `rm -f .cache/test-api/headers`

---

## Step 5: Execute tests

Process endpoints in the order they appear in the spec.

For each endpoint:

### 5a. Resolve path parameters

Use values in this priority order:
1. `example` field on the parameter in the spec
2. `x-example` extension
3. Sensible defaults: `1` for numeric IDs, `550e8400-e29b-41d4-a716-446655440000` for UUIDs, `"test"` for strings, `"2024-01-01"` for dates

### 5b. Build the curl command

```bash
curl -s -w "\n%{http_code}" \
  -X <METHOD> \
  -H "Accept: application/json" \
  [-H "Content-Type: application/json"] \
  [-H @.cache/test-api/headers] \
  [-d '<minimal valid request body>'] \
  "<base_url><resolved_path>[?<query_params>]"
```

For `POST`, `PUT`, and `PATCH`, build a minimal valid request body from the spec's request schema:
- Include all `required` fields with example or default values
- Omit optional fields

For `DELETE` endpoints: pause and ask the user to confirm before running,
even if "include mutating" was selected — except in an autonomous
`--yes --all` run against a local base URL, where DELETE runs like any other
mutating endpoint (Step 3).

### 5c. Validate the response

For each response:
1. **Status code** — check it matches one of the documented response codes for that operation
2. **Content-Type** — if the spec declares `application/json`, verify the response includes it
3. **Schema** — for 2xx responses with a documented schema, spot-check that the response body contains the required top-level fields

---

## Step 6: Report results

After all tests complete, print a summary:

```
Results: <pass>/<total> endpoints tested

✅  GET    /users              200 OK
✅  GET    /users/{id}         200 OK  (id=1)
❌  GET    /products/{id}      404 Not Found  (expected: 200)
⚠️   DELETE /users/{id}         skipped — requires confirmation
...

─────────────────────────────────────────────────
Failures (<N>):

  ❌ GET /products/{id}
     Path param: id = 1
     Expected:   200
     Got:        404
     Hint:       No record with id=1 exists — try a different example value

Warnings (<N>):
  ⚠️  DELETE /users/{id} — skipped (mutating, not confirmed)
  ⚠️  POST   /orders     — skipped (mutating, not confirmed)
─────────────────────────────────────────────────
```

One line per endpoint in the summary. Expand only failures. Keep warnings grouped at the bottom.

---

## Constraints

- **Read-only by default** — do not run mutating methods without explicit user confirmation; the only exception is an autonomous `--yes --all` run against a local base URL (Step 3)
- **No destructive defaults** — confirm individually before each `DELETE` outside that local autonomous exception
- **No secrets in output or command lines** — never print auth tokens, API keys, or passwords in any command or result shown to the user (redact them as `<redacted>`), and pass credentials to curl only via the `-H @.cache/test-api/headers` file, never inline
- **No side-effect assumptions** — when testing `POST`/`PUT`/`PATCH`, note that the test may create or modify real data and inform the user
- **Respect rate limits** — if the spec documents rate limits or the server returns `429`, add a 1-second pause (`sleep 1`) between requests and note it in the output
