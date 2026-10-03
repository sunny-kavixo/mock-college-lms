# Mock College LMS

A small TypeScript/Express learning-management demo. Students sign in, watch
course meeting recordings, and submit assignments that unlock only after the
server confirms the required recording was watched sequentially.

## Quick start

```bash
npm install
cp .env.example .env
# Set AI_API_KEY in .env without committing that file.
npm run seed
npm run dev
```

Open <http://localhost:3001> and use:

- Email: `student@mockcollege.local`
- Password: `demo123`

The SQLite database is stored at `data/mock-college.db`. Running `npm run seed`
resets the demo data to its initial state.

## Verification commands

```bash
npm test          # all deterministic tests
npm run typecheck # strict TypeScript check
npm run build     # compile to dist/
npm run demo      # run the complete Playwright recording-to-assignment flow
npm run worker    # run the same worker against a fresh seed
```

For a reproducible browser run:

```bash
npm run seed
npm run worker
```

The worker starts the local LMS automatically when one is not already running.
It signs in through the UI, discovers both courses and all activities, records
blocked assignment attempts before watching, waits for server-confirmed
recording completion, obtains answers through `AIAnswerProvider`, and submits
through the UI. It writes milestone PNG/HTML artifacts under `evidence/` and a
JSONL audit trail under `ledger/`. Generated run artifacts are ignored by git.

The successful real verification used NVIDIA's OpenAI-compatible endpoint with
model `openai/gpt-oss-20b`. Configure it using the tracked `.env.example`
template and a local, ignored `.env` file. The `AIAnswerProvider` abstraction is
swappable: it supports an OpenAI-compatible real provider and the deterministic
development provider when no real key is configured. It never silently falls
back after a real-provider error.

The successful real-run sample ledger and representative evidence are preserved
under `submission-artifacts/`. Runtime-generated `evidence/` and `ledger/`
directories remain ignored.

## Architecture

```text
Playwright worker
  ├─ UI login / course discovery / recording playback
  ├─ server-confirmed gate checks
  ├─ AIAnswerProvider → NVIDIA OpenAI-compatible chat completions
  ├─ assignment submission through the UI
  └─ evidence + JSONL RunLedger
             │
             ▼
Express mock LMS ── better-sqlite3 ── recording progress / submissions
```

The server is the source of truth. The worker never overrides a locked state;
it records the refusal and only asks the AI provider questions after a server
completion response. Browser automation is deterministic and uses stable UI
selectors. AI is an answerer only. No anti-bot evasion, stealth fingerprinting,
CAPTCHA bypass, or production-LMS automation is implemented.

## Reviewer visibility

After signing in, open <http://localhost:3001/demo-status> to see the seeded
course milestones and secret-safe metadata for the latest worker run: run ID,
provider, status, and evidence directory. It does not display credentials,
cookies, authorization headers, or API keys.

The worker records structured events such as `login.started`,
`assignment.blocked`, `recording.progress`, `recording.completed`,
`assignment.eligible`, `ai.answers.started`, `ai.answers.completed`,
`assignment.submitted`, `evidence.captured`, and `run.failed`. A successful
ledger proves `recording.completed` precedes assignment start and submission.

Failures are classified as `AUTH_FAILED`, `COURSE_DISCOVERY_FAILED`,
`RECORDING_FAILED`, `GATE_CLOSED`, `AI_PROVIDER_FAILED`,
`ASSIGNMENT_SUBMIT_FAILED`, or `BROWSER_FAILED`. The worker captures safe
failure evidence when the current page contains no credentials and always
cleans up its browser and any server it started.

## Completion gate

Recording progress is persisted per user and activity. Each heartbeat is
validated by `shared/gate-policy.ts`:

1. The reported position must move sequentially within a small playback-jitter
   allowance.
2. The server credits only time justified by the heartbeat timestamps rather
   than trusting the browser's position delta.
3. A large seek resets the contiguous-watch streak.
4. An assignment becomes eligible only when the required recording is both near
   its end and at least 90% continuously watched.

The same eligibility check is applied to both the assignment page and the
submission endpoint, so hiding the client-side button does not bypass the
gate.

## Useful endpoints

- `GET /courses` — authenticated course overview
- `GET /recordings/:id` — recording player and persisted progress
- `POST /api/recordings/:id/heartbeat` — server-validated progress update
- `GET /api/assignments/:id/eligibility` — current assignment gate state
- `GET /demo-status` — authenticated, secret-safe reviewer status
- `GET /assignments/:id` — assignment form when eligible
- `POST /assignments/:id/submit` — persist a submission when eligible

## Submission verification

```bash
npm run seed
npm run worker
npm run typecheck
npm test
npm run build
```

## Interview discussion points

- The gate is enforced twice: the assignment UI and the submission endpoint.
- The worker verifies server responses instead of trusting browser position.
- The provider boundary allows NVIDIA/OpenAI-compatible implementations to be
  swapped without changing browser orchestration.
- JSONL evidence creates a deterministic audit trail for both success and
  refusal paths.

Known limitations: credentials are intentionally demo-only, recordings are
time-compressed UI simulations, and the sample worker processes the seeded
courses sequentially rather than acting as a general LMS integration.
