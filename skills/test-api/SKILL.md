---
name: test-api
description: Use when testing API endpoints against an OpenAPI/Swagger specification. Discovers or loads the spec, executes requests against each endpoint, and validates responses.
metadata:
  version: "1.0.0"
argument-hint: [optional OpenAPI doc URL or file path]
allowed-tools: Bash(find:*) Bash(curl:*) Bash(grep:*) Bash(ls:*) Bash(echo:*) Read WebFetch
---

# API Test Rules

Follow these rules when testing APIs against an OpenAPI specification.

## Arguments

If the user passed a URL or file path when invoking this skill
(e.g. `/test-api https://api.example.com/openapi.json` or `/test-api ./docs/openapi.yaml`),
use it as the API specification source.

If no argument was provided, search the project for API documentation.

---

## Step 1: Locate the API specification

### If an argument was provided

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
  - OpenAPI 3.x: `servers[0].url`
  - Swagger 2.x: combine `host` + `basePath` + `schemes[0]`
- **Endpoints**: every path + HTTP method combination
- **Operations**: for each endpoint, its `operationId`, parameters, request body schema, and expected response codes/schemas

If the base URL contains template variables (e.g. `https://{host}`) or is a localhost address, ask the user to confirm or override it before continuing.

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

Do not run any requests until the user responds.

---

## Step 4: Authentication (if needed)

If the spec declares a security scheme or the user chose "configure auth":

- Ask for the required credential (token, API key, etc.)
- Store it only in memory for this session — never log it or embed it in output shown to the user
- Apply it as a header on all subsequent requests (e.g. `Authorization: Bearer <token>`)

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
  [-H "Authorization: <scheme> <credential>"] \
  [-d '<minimal valid request body>'] \
  "<base_url><resolved_path>[?<query_params>]"
```

For `POST`, `PUT`, and `PATCH`, build a minimal valid request body from the spec's request schema:
- Include all `required` fields with example or default values
- Omit optional fields

For `DELETE` endpoints: pause and ask the user to confirm before running, even if "include mutating" was selected.

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

- **Read-only by default** — do not run mutating methods without explicit user confirmation
- **No destructive defaults** — confirm individually before each `DELETE`
- **No secrets in output** — never print auth tokens, API keys, or passwords in any command or result shown to the user; redact them as `<redacted>`
- **No side-effect assumptions** — when testing `POST`/`PUT`/`PATCH`, note that the test may create or modify real data and inform the user
- **Respect rate limits** — if the spec documents rate limits or the server returns `429`, add a 1-second pause between requests and note it in the output
