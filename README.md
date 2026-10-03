# Mock College LMS Automation

A credible, server-verified student learning portal and Playwright automation
demo. It demonstrates a strict recording-before-assignment invariant, a
swappable AI answer provider, structured audit logging, and evidence capture.

## Live demo

Public Railway URL: _to be added after deployment approval_

## Demo login

`DEMO ACCOUNT — NOT FOR PRODUCTION`

- Email: `student@mockcollege.local`
- Password: `demo123`

## Quick start

```bash
npm install
cp .env.example .env
# Set AI_API_KEY only when intentionally running the worker with NVIDIA.
npm run seed
npm run dev
```

Open <http://localhost:3001>. The public/manual LMS works without NVIDIA
credentials. The worker starts a local LMS automatically when one is not
already running.

## Architecture

```text
Student browser / Playwright worker
        │ UI + authenticated APIs
        ▼
Express Mock College LMS ── server gate ── better-sqlite3
        │                         │
        ├─ recordings / assignments │ recording progress / submissions
        ├─ AIAnswerProvider          └─ server-owned eligibility
        └─ PNG + HTML evidence + JSONL ledger
```

The server is the source of truth. If a recording is incomplete, assignment GET
and POST are denied, the worker records a refusal, and the AI provider is not
called. Only a server-confirmed sequential recording completion unlocks an
assignment. Direct seeking to the end never satisfies the gate.

The project automates only this fictional Mock College LMS. It contains no
external production LMS integration, anti-bot bypass, stealth automation,
CAPTCHA bypass, or fingerprint spoofing. Any future external LMS integration
would require explicit authorization and a dedicated provider.

## Manual student flow

1. Run `npm run seed` to reset the four-course demo catalog.
2. Start `npm run dev` and sign in with the demo account.
3. Open **My Courses**, then open a course detail page.
4. Open its recording and play sequentially until the server reports `COMPLETE`.
5. Open the now-eligible four-question assignment and submit responses.
6. Review `/demo-status` for current database state and the latest safe run summary.

Routes:

- `/login` — student login
- `/courses` — dashboard and all seeded courses
- `/courses/:id` — course detail and activity dependency
- `/recordings/:id` — server-validated recording player
- `/assignments/:id` — assignment, only when eligible
- `/demo-status` — reviewer-facing, secret-safe run console
- `/healthz` — public Railway health check

## Automated worker flow

```bash
npm run seed
npm run worker
```

For each seeded course, the worker logs in through the UI, discovers activities,
verifies the assignment is blocked, watches the recording, waits for the
college server's completion response, extracts all four questions, calls
`AIAnswerProvider`, fills the answers, submits through the UI, and captures
milestone evidence. It supports any number of courses returned by the catalog;
there is no two-course orchestration assumption.

The terminal reports real server milestones, for example:

```text
[BUS101] Business Fundamentals
✓ Assignment initially blocked
▶ Recording 25% / 50% / 75%
✓ Recording server-confirmed complete
✓ 4 questions discovered
✓ AI answers received
✓ Assignment submitted
```

## AI provider

The existing `AIAnswerProvider` boundary supports a real OpenAI-compatible
provider and a deterministic development provider when no real key is set.
The verified real configuration is NVIDIA NIM:

```text
AI_API_KEY=
OPENAI_API_URL=https://integrate.api.nvidia.com/v1/chat/completions
OPENAI_MODEL=openai/gpt-oss-20b
```

The key belongs only in the ignored local `.env`. Real-provider errors fail
honestly and never silently fall back. AI is an answerer only; it does not own
eligibility or bypass the server gate.

## Evidence and ledger

Each worker run writes PNG/HTML milestones under `evidence/` and ordered JSONL
events under `ledger/`. Runtime output is ignored by git. The tracked
`submission-artifacts/` directory contains representative successful NVIDIA
evidence and its ledger.

Important ledger events include login, catalog/activity discovery, blocked
assignments, recording progress/completion, eligibility, AI request/response,
submission, evidence capture, and run outcome. Per course, the invariant is:

```text
recording.completed
  < assignment.started
  < ai.answers.completed
  < assignment.submitted
```

Failures are classified as `AUTH_FAILED`, `COURSE_DISCOVERY_FAILED`,
`RECORDING_FAILED`, `GATE_CLOSED`, `AI_PROVIDER_FAILED`,
`ASSIGNMENT_SUBMIT_FAILED`, or `BROWSER_FAILED`. Failure evidence is captured
when the current page is safe, and browser/server cleanup runs in `finally`.

## Testing

```bash
npm run seed
npm run typecheck
npm test
npm run build
npm run demo       # full deterministic browser flow when keys are blank
npm run worker     # full worker flow; uses NVIDIA when .env is configured
```

The test suite covers exact end-of-recording truthfulness, direct-seek rejection,
locked GET/POST behavior, catalog shape, provider fallback rules, AI ordering,
secret-safe artifacts, health checks, and reviewer UI state.

## Railway deployment

### Public demo deployment — Railway

1. Connect the GitHub repository and deploy the approved `showcase-v3` branch.
2. Use the native Node commands: `npm run build` during build and `npm run start` at runtime.
3. Add a persistent volume mounted at `/app/data`.
4. Configure `DB_PATH=/app/data/mock-college.db` for the web service.
5. Set the health check path to `/healthz`.
6. Generate a Railway public domain and share it as the live demo URL.
7. Seed the database once using a controlled shell/deploy step: `npm run seed`.

The web service does not require an NVIDIA key for ordinary manual LMS use.
The NVIDIA key is required only when intentionally running the external worker.
Do not expose a public automation trigger. Keep worker execution local or in a
controlled CI/test context.

Railway restarts do not wipe the database: schema initialization is safe and
`npm run seed` is the explicit reset operation. The persistent volume path is
`/app/data`.

## Engineering skills

See [docs/ENGINEERING-SKILLS.md](docs/ENGINEERING-SKILLS.md) for a truthful
map from demonstrated implementation to engineering skill.

## Known limitations

- Credentials are intentionally demo-only and stored as seeded exercise data.
- Recordings are time-compressed UI simulations rather than media files.
- The worker processes courses sequentially for deterministic evidence.
- Submission is stored, but no subjective grading system is implemented.
