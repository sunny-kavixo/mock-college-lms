# Engineering Skills Demonstrated

| Skill | Where it is demonstrated | What was implemented |
| --- | --- | --- |
| TypeScript | `college/`, `shared/`, `worker/`, `tests/` | Strictly typed server, catalog, worker, and tests. |
| Express.js | `college/server/index.ts` | Server-rendered LMS pages, authenticated routes, APIs, and `/healthz`. |
| SQLite / better-sqlite3 | `college/db/db.ts` | Persistent schema, safe initialization, migrations, and configurable `DB_PATH`. |
| REST API design | `college/server/index.ts` | Heartbeat, eligibility, course catalog, and health endpoints. |
| Server-side state gates | `college/server/gate.ts`, `shared/gate-policy.ts` | Sequential playback is required before assignment access or submission. |
| Playwright automation | `worker/index.ts` | UI login, N-course discovery, recording playback, answer filling, and submission. |
| End-to-end testing | `tests/server-gate.test.ts` and worker runs | Locked and successful paths are exercised against the mock LMS. |
| Vitest | `tests/` | Deterministic policy, catalog, provider, API, and ledger invariant tests. |
| AI API integration | `worker/ai/provider.ts` | OpenAI-compatible chat-completions requests with validated answer output. |
| Provider abstraction | `worker/ai/provider.ts` | Real and deterministic providers share `AIAnswerProvider`. |
| NVIDIA NIM/OpenAI-compatible API | `.env.example`, real run ledger | NVIDIA endpoint and `openai/gpt-oss-20b` were used successfully. |
| Structured JSONL audit logging | `worker/ledger.ts` | Ordered, secret-safe run events and invariant checks. |
| Evidence generation | `worker/index.ts`, `evidence/` | PNG and HTML milestones for success and safe failure states. |
| Failure handling | `worker/index.ts`, `worker/artifacts.ts` | Failure classification, safe diagnostics, evidence, and cleanup. |
| Responsive UI engineering | `college/server/ui.ts` | CSS variables, responsive layouts, course/player/status views. |
| Accessibility | Server-rendered forms and UI | Labels, semantic controls, focus styles, progress semantics, and keyboard-friendly forms. |
| Environment management | `.env.example`, `.gitignore` | Local secrets stay ignored; runtime DB and provider settings are configurable. |
| Railway deployment readiness | `README.md`, `DB_PATH`, `/healthz` | Native Node start/build flow, `/app/data` guidance, and health check. |
| Git/GitHub | Branches, commits, CI workflow | Reviewable showcase branch and simple GitHub Actions verification. |
