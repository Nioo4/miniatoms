# Internal database contract

All functions return JSONB, use `SECURITY INVOKER` and an empty search path, and are executable only by `service_role`. The API must verify the Bearer user first and pass that identity as `p_actor`. Returned rows use PostgreSQL snake_case; they are internal data and **must be mapped to public DTOs**. In particular, never forward a `run` row directly to the browser.

Every parameter below has the `p_` prefix, including `actor`. Parameter order is shown for SQL tools; PostgREST calls use named arguments.

| Function | Parameters after `actor uuid` | Successful JSON shape |
|---|---|---|
| `ma_create_project` | `project_id uuid, title text, fingerprint text` | `{applied, action: created/duplicate, project}` |
| `ma_start_run` | `run_id uuid, project_id uuid, kind text, prompt text, input_diagnostics jsonb, base_version_id uuid, restore_target_version_id uuid, fingerprint text` | `{applied, action: created/duplicate, run, token}` |
| `ma_get_run_context` | `run_id uuid` | `{applied:true, run, project, token, currentVersion, restoreVersion, messages}` |
| `ma_update_run` | `run_id uuid, token uuid, expected_status text, next_status text, patch jsonb` | `{applied, run, token?}` |
| `ma_reserve_model_call` | `run_id uuid, token uuid, purpose text, user_daily_limit int, global_daily_limit int` | `{applied, run, token?}` |
| `ma_stage_candidate` | `run_id uuid, token uuid, artifact jsonb, plan jsonb, summary text, source_hash text, agent_messages jsonb` | `{applied, run, candidate}` |
| `ma_accept_feedback` | `run_id uuid, candidate_version_id uuid, source_hash text, feedback_request_id uuid, fingerprint text, outcome text, data_revision bigint, diagnostics jsonb` | `{applied, action: committed/repair/terminal/duplicate, run, candidate, project, token}` |
| `ma_finish_run` | `run_id uuid, token uuid, terminal_status text, error jsonb` | `{applied, run}` |
| `ma_cancel_run` | `run_id uuid, reason text` | `{applied, run}` |
| `ma_expire_project_runs` | `project_id uuid` | `{applied, runs}` (only runs expired by this invocation) |
| `ma_put_app_data` | `project_id uuid, request_id uuid, version_id uuid, expected_revision bigint, state jsonb, fingerprint text` | `{applied, action: updated/duplicate, result:{revision,savedAt}}` |

`currentVersion` and `restoreVersion` are nullable version rows. Context `messages` contains the current epoch's latest six request/result messages from succeeded runs, in ascending chronological order. No app business state is included. The returned `token` is server-only. A duplicate start/feedback returns `token:null`; it never acquires a worker. A failed worker CAS returns `applied:false` and the current row, including when cancellation or expiry already won. `stage_candidate` then returns `candidate:null`.

`patch` keys are strictly `plan`, `agentMessages`, `diagnostics`, `callRecords` (camelCase). Call records must preserve array length and all reservation identity fields. They can complete a reserved entry once, with status `ok/error/aborted`, a non-null finish timestamp, provider ID and nullable actual usage. Record a finished/error reservation before trying another model call; reservations are serialized even under the same token.

Business exceptions use SQLSTATE `P0001`, `MESSAGE=<stable code>`, `DETAIL=<safe JSON object>`. Accepted feedback that ends a run returns a normal terminal result. Do not throw away that committed outcome by treating it as an RPC exception. No RPC calls external services or executes generated code.

## Local verification

`config.toml` identifies the isolated `miniatoms-test` stack. Production is configured separately and must keep the platform's default anonymous signup protections. The local anonymous rate limit is enlarged only for the permission test users.

- Start/reset the local Supabase stack, then run the integration suite. `tests/integration/local-config.mjs` refuses non-loopback URLs and reads local CLI keys without printing them. Alternatively supply `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY`, and `DATABASE_TEST_URL` in an ignored `.env.test`.
- `tests/integration/reset-test-db.mjs` only invokes `supabase db reset --local --no-seed` after checking the test project and configured addresses. It cannot reset a linked project.
- `database.test.mjs` contains real Supabase Auth/REST/PostgreSQL D-01..D-14 scenarios, including concurrent RPCs and a temporary, narrowly scoped rollback trigger. It creates fixture users/projects and leaves evidence intact; use the isolated local reset for subsequent clean runs.
- Optional `sql-smoke.mjs` runs migrations and sequential SQL checks in PGlite PostgreSQL. `npm run test:sql` uses the pinned development dependency; `PGLITE_MODULE` can override its entry file for isolated tooling. Auth roles/functions are explicitly a test shim. This does **not** prove real Supabase Auth, PostgREST or concurrent locking and never reports those as passed.

Do not run the integration suite or reset script against production. No test hook is installed by migrations.
