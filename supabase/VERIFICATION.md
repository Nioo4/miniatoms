# Database verification record

Update 2026-09-20: GitHub Actions run [35465265115](https://github.com/Nioo4/miniatoms/actions/runs/35465265115), commit `5408dd4fabe3f25fab7b8e08a349e3a373c14703`, executed all **14 integration tests successfully** against actual local Supabase on Linux. Downloaded artifact `local-supabase-integration-report/integration.json`: total 14, passed 14, failed 0, success true. This supersedes the local-only database blocker below; it does not make the subsequent workbench job or live DeepSeek verification pass. The six workbench browser tests failed during candidate checks in this run.

Recorded 2026-09-20, local Windows / Node 24.15.0, pre-first-commit working tree. Model mode: fixture; no model HTTP request. Database target: isolated in-memory PostgreSQL/PGlite 0.5.8. No production database was accessed.

| Command / check | Actual result | Boundary |
|---|---|---|
| `node tests/integration/sql-smoke.mjs` | PASS, 73 assertions | Three migrations execute in PostgreSQL WASM; sequential SQL paths only; auth schema/function/roles are explicit test shims |
| `npm run lint` | PASS | Includes database test helpers and workflow-adjacent JS; not a database runtime proof |
| `node --check` on integration suite/config/reset helper | PASS | JavaScript syntax |
| `node node_modules/supabase/dist/supabase.js --version` | 2.117.0 | Pinned CLI wrapper resolves on Windows; same Node entry point selects the Linux binary in CI |
| `npm run test:integration` | BLOCKED, exit 1; 14 tests collected, no test passed | Before-all refuses unavailable local Supabase; Vitest labels the unexecuted tests skipped after suite setup fails |
| `docker info` | FAIL: `dockerDesktopLinuxEngine` pipe absent | Docker backend unavailable |

The 73 SQL assertions cover start idempotency, duplicate token suppression, active-run exclusion, actor checks, illegal state/patch rejection, null-token CAS, zero quota, reservations, malformed call-record changes, staged candidates, preview-error repair, old candidate rejection, atomic success tool results, ready replay after data changes, data receipts/CAS, stale data checks, successful/failed restore and epoch filtering, late cancelled/expired workers, expired candidates, three-write/four-call exhaustion, real SQL role/column enforcement, composite FK rejection, invalid/oversized app state, project count boundary, and trigger-induced publication rollback. They do not exercise independent concurrent transactions or real anonymous authentication/PostgREST.

`tests/integration/database.test.mjs` implements D-01..D-14 against actual local Supabase, including concurrent starts/create capacity/feedback/quota/data writes. These remain BLOCKED locally. `.github/workflows/verify.yml` provides an Ubuntu Docker job to run those cases, then reset the local test database and run the workbench with an explicit model fixture. A configured workflow is not a passing workflow; update the main acceptance record only after actual run results are reviewed.

Docker's local backend log reports startup failure in the inference manager while removing its `dockerInference` socket: “The file cannot be accessed by the system” with an invalid filename/directory syntax listener error. This investigation only read logs. No virtualization changes, Docker factory reset, or Docker data deletion was performed by the database agent.

Database scope is implemented and SQL-smoke-verified. Overall CODE_VERIFIED remains pending full Supabase and workbench execution. LIVE_VERIFIED and DELIVERY_COMPLETE are not claimed.
