import express from "express";
import fs from "node:fs";
import path from "node:path";
import { db, initSchema } from "../db/db";
import {
  getAssignmentEligibility,
  processRecordingHeartbeat
} from "./gate";
import { DESIGN_SYSTEM_CSS } from "./ui";

initSchema();

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

type AuthedRequest = express.Request & {
  userId?: string;
};

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie || "";

  return Object.fromEntries(
    header
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");

        if (index === -1) {
          return [item, ""];
        }

        const decode = (value: string) => {
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        };

        return [
          decode(item.slice(0, index)),
          decode(item.slice(index + 1))
        ];
      })
  );
}

function getRouteParam(
  req: express.Request,
  name: string
): string | undefined {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

function requireAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction
) {
  const cookies = parseCookies(req);
  const sessionId = cookies.mockCollegeSession;
  const user = sessionId
    ? (db
        .prepare("SELECT id FROM users WHERE id = ?")
        .get(sessionId) as { id: string } | undefined)
    : undefined;

  if (!user) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ error: "UNAUTHENTICATED" });
    }

    return res.redirect("/login");
  }

  req.userId = user.id;
  next();
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | Mock College</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    background: #f5f7fb;
    color: #172033;
  }
  header {
    background: #13233f;
    color: white;
    padding: 18px 28px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  header a { color: white; text-decoration: none; }
  main {
    max-width: 980px;
    margin: 40px auto;
    padding: 0 20px;
  }
  .card {
    background: white;
    border: 1px solid #dde3ec;
    border-radius: 16px;
    padding: 22px;
    margin-bottom: 18px;
    box-shadow: 0 6px 24px rgba(20, 35, 60, .06);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit,minmax(280px,1fr));
    gap: 18px;
  }
  button, .button {
    display: inline-block;
    background: #1d4ed8;
    color: white;
    border: 0;
    border-radius: 9px;
    padding: 11px 16px;
    cursor: pointer;
    text-decoration: none;
    font-weight: 600;
  }
  button:disabled, .disabled {
    opacity: .45;
    cursor: not-allowed;
  }
  input {
    width: 100%;
    padding: 11px;
    margin: 6px 0 14px;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
  }
  .status {
    display: inline-block;
    padding: 5px 9px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
  }
  .locked { background: #fee2e2; color: #991b1b; }
  .open { background: #dcfce7; color: #166534; }
  .submitted { background: #dbeafe; color: #1e40af; }
  .progress-track {
    height: 14px;
    border-radius: 999px;
    overflow: hidden;
    background: #e5e7eb;
  }
  .progress-bar {
    height: 100%;
    width: 0%;
    background: #2563eb;
    transition: width .25s linear;
  }
  .recording {
    background: #0f172a;
    color: white;
    min-height: 250px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    text-align: center;
    padding: 30px;
    margin-bottom: 18px;
  }
  .muted { color: #64748b; }
  .error { color: #b91c1c; }
  label { font-weight: 600; }
  ${DESIGN_SYSTEM_CSS}
</style>
</head>
<body>
<header class="site-header" data-testid="site-header">
  <div class="header-inner">
    <a class="brand" href="/courses" data-testid="brand-link">
      <span class="brand-mark" aria-hidden="true">M</span>
      <strong>Mock College LMS</strong>
    </a>
    <div class="header-meta">
      <span class="header-kicker">Student learning workspace</span>
      <span class="env-badge">DEMO</span>
    </div>
  </div>
</header>
<main class="page-shell">${body}</main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;"
      })[character] ?? character
  );
}

interface DemoRunSummary {
  runId: string;
  provider: string;
  model: string;
  status: string;
  timestamp: string;
  courseCount: number;
  blockedAttempts: number;
  assignmentsSubmitted: number;
  ledgerPath: string;
  evidenceDirectory: string;
}

function humanProviderLabel(provider: string, model: string): string {
  if (provider === "deterministic-dev") return "Deterministic development provider";
  if (model === "openai/gpt-oss-20b") return "NVIDIA · GPT-OSS 20B";
  return "OpenAI-compatible real provider";
}

function readLatestRunSummary(): DemoRunSummary | null {
  const ledgerDirectory = path.resolve("ledger");

  if (!fs.existsSync(ledgerDirectory)) {
    return null;
  }

  const files = fs
    .readdirSync(ledgerDirectory)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => ({
      file,
      modifiedAt: fs.statSync(path.join(ledgerDirectory, file)).mtimeMs
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const entry of files) {
    try {
      const records = fs
        .readFileSync(path.join(ledgerDirectory, entry.file), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const started = records.find((record) => record.event === "run.started");
      const finished = [...records]
        .reverse()
        .find(
          (record) =>
            record.event === "run.completed" || record.event === "run.failed"
        );
      const runId = typeof started?.runId === "string" ? started.runId : entry.file.replace(/\.jsonl$/, "");
      const rawProvider = typeof started?.provider === "string" ? started.provider : "Unknown";
      const model = typeof started?.model === "string"
        ? started.model
        : rawProvider.startsWith("openai-compatible:")
          ? rawProvider.slice("openai-compatible:".length)
          : rawProvider;
      const completedRecord = records.find((record) => record.event === "courses.discovered");

      return {
        runId,
        provider: humanProviderLabel(rawProvider, model),
        model,
        status: typeof finished?.status === "string" ? finished.status : "IN_PROGRESS",
        timestamp: typeof finished?.timestamp === "string" ? finished.timestamp : "",
        courseCount: typeof completedRecord?.courseCount === "number" ? completedRecord.courseCount : 0,
        blockedAttempts: records.filter((record) => record.event === "assignment.blocked").length,
        assignmentsSubmitted: records.filter(
          (record) => record.event === "assignment.submitted" && record.status === "SUCCESS"
        ).length,
        ledgerPath: `ledger/${entry.file}`,
        evidenceDirectory: `evidence/${runId}`
      };
    } catch {
      continue;
    }
  }

  return null;
}

export function getDemoStatusSnapshot(userId: string) {
  const courses = db
    .prepare("SELECT id, code, title, instructor, description FROM courses ORDER BY title")
    .all() as Array<{
      id: string;
      code: string | null;
      title: string;
      instructor: string | null;
      description: string | null;
    }>;

  const courseStatus = courses.map((course) => {
    const activities = db
      .prepare(`
        SELECT id, type, title, duration_seconds
        FROM activities
        WHERE course_id = ?
        ORDER BY sort_order
      `)
      .all(course.id) as Array<{
        id: string;
        type: "MEETING_RECORDING" | "ASSIGNMENT";
        title: string;
        duration_seconds: number | null;
      }>;
    const recording = activities.find((activity) => activity.type === "MEETING_RECORDING");
    const assignment = activities.find((activity) => activity.type === "ASSIGNMENT");
    const progress = recording
      ? (db
          .prepare(`
            SELECT watched_seconds, complete
            FROM recording_progress
            WHERE user_id = ? AND activity_id = ?
          `)
          .get(userId, recording.id) as
          | { watched_seconds: number; complete: number }
          | undefined)
      : undefined;
    const submission = assignment
      ? (db
          .prepare(`
            SELECT status
            FROM assignment_submissions
            WHERE user_id = ? AND activity_id = ?
          `)
          .get(userId, assignment.id) as { status: string } | undefined)
      : undefined;
    const eligibility = assignment
      ? getAssignmentEligibility(userId, assignment.id)
      : { eligible: false, reason: "NO_ASSIGNMENT" };
    const durationSeconds = recording?.duration_seconds ?? 0;
    const progressPercent = durationSeconds
      ? Math.min(100, Math.round(((progress?.watched_seconds ?? 0) / durationSeconds) * 100))
      : 0;

    return {
      id: course.id,
      code: course.code,
      title: course.title,
      instructor: course.instructor,
      description: course.description,
      activityCount: activities.length,
      recordingComplete: Boolean(progress?.complete),
      progressPercent: progress?.complete ? 100 : progressPercent,
      assignmentState: submission
        ? "SUBMITTED"
        : eligibility.eligible
          ? "OPEN"
          : "LOCKED"
    };
  });

  return {
    courses: courseStatus,
    activityCount: courseStatus.reduce((total, course) => total + course.activityCount, 0),
    latestRun: readLatestRunSummary()
  };
}

app.get("/", (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies.mockCollegeSession;
  const user = sessionId
    ? (db
        .prepare("SELECT id FROM users WHERE id = ?")
        .get(sessionId) as { id: string } | undefined)
    : undefined;

  if (user) {
    return res.redirect("/courses");
  }

  res.redirect("/login");
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "mock-college-lms" });
});

app.get("/login", (_req, res) => {
  res.send(
    htmlPage(
      "Login",
      `
      <div class="card auth-card" data-testid="login-card">
        <div class="auth-mark" aria-hidden="true">M</div>
        <p class="eyebrow">Mock College · Demo environment</p>
        <h1>Welcome back</h1>
        <p class="muted">Sign in to continue your server-verified learning session.</p>

        <form method="post" action="/login" data-testid="login-form">
          <label for="email">Email</label>
          <input
            id="email"
            data-testid="email-input"
            name="email"
            value="student@mockcollege.local"
            autocomplete="username"
          />

          <label for="password">Password</label>
          <input
            id="password"
            data-testid="password-input"
            type="password"
            name="password"
            value="demo123"
            autocomplete="current-password"
          />

          <button class="button" data-testid="login-submit" type="submit">Sign in</button>
        </form>
        <p class="muted" style="margin:20px 0 0;font-size:12px;">Seeded demo account · student@mockcollege.local</p>
      </div>
      `
    )
  );
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;

  const user = db
    .prepare(`
      SELECT id
      FROM users
      WHERE email = ? AND password = ?
    `)
    .get(email, password) as { id: string } | undefined;

  if (!user) {
    return res.status(401).send(
      htmlPage(
        "Login failed",
        `<div class="card"><h2>Invalid credentials</h2>
        <a class="button" href="/login">Try again</a></div>`
      )
    );
  }

  res.setHeader(
    "Set-Cookie",
    `mockCollegeSession=${encodeURIComponent(user.id)}; HttpOnly; Path=/; SameSite=Lax`
  );

  res.redirect("/courses");
});

app.post("/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    "mockCollegeSession=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
  );

  res.redirect("/login");
});

app.get("/courses", requireAuth, (req: AuthedRequest, res) => {
  const courses = db
    .prepare(`
      SELECT id, code, title, instructor, description
      FROM courses
      ORDER BY title
    `)
    .all() as Array<{
      id: string;
      code: string | null;
      title: string;
      instructor: string | null;
      description: string | null;
    }>;
  const completedRecordings = (db
    .prepare("SELECT COUNT(*) AS count FROM recording_progress WHERE user_id = ? AND complete = 1")
    .get(req.userId) as { count: number }).count;
  const submittedAssignments = (db
    .prepare("SELECT COUNT(*) AS count FROM assignment_submissions WHERE user_id = ? AND status = 'SUBMITTED'")
    .get(req.userId) as { count: number }).count;
  const greetingHour = new Date().getHours();
  const greeting = greetingHour < 12 ? "Good morning" : greetingHour < 18 ? "Good afternoon" : "Good evening";

  const cards = courses
    .map((course) => {
      const activities = db
        .prepare(`
          SELECT id, type, title, duration_seconds
          FROM activities
          WHERE course_id = ?
          ORDER BY sort_order
        `)
        .all(course.id) as Array<{
          id: string;
          type: string;
          title: string;
          duration_seconds: number | null;
        }>;

      const recording = activities.find(
        (a) => a.type === "MEETING_RECORDING"
      );

      const assignment = activities.find(
        (a) => a.type === "ASSIGNMENT"
      );

      const progress = recording
        ? (db
            .prepare(`
              SELECT complete, watched_seconds
              FROM recording_progress
              WHERE user_id = ? AND activity_id = ?
            `)
            .get(req.userId, recording.id) as
              | { complete: number; watched_seconds: number }
              | undefined)
        : undefined;

      const eligibility = assignment
        ? getAssignmentEligibility(req.userId!, assignment.id)
        : { eligible: false, reason: "NO_ASSIGNMENT" };

      const submission = assignment
        ? db
            .prepare(`
              SELECT status
              FROM assignment_submissions
              WHERE user_id = ? AND activity_id = ?
            `)
            .get(req.userId, assignment.id) as
            | { status: string }
            | undefined
        : undefined;

      const state = submission
        ? "SUBMITTED"
        : eligibility.eligible
          ? "OPEN"
          : "LOCKED";

      const statusClass =
        state === "SUBMITTED"
          ? "submitted"
          : state === "OPEN"
            ? "open"
            : "locked";

      const durationSeconds = recording?.duration_seconds ?? 0;
      const watchedSeconds = progress?.watched_seconds ?? 0;
      const progressPercent = progress?.complete
        ? 100
        : durationSeconds
        ? Math.min(100, Math.round((watchedSeconds / durationSeconds) * 100))
        : 0;
      const recordingState = progress?.complete
        ? "Complete"
        : watchedSeconds > 0
          ? "In progress"
          : "Not started";

      return `
        <article class="card course-card" data-testid="course-card" data-course-id="${escapeHtml(course.id)}">
          <div class="course-card-header">
            <div>
              <p class="eyebrow">${escapeHtml(course.code || "COURSE")} · Course workspace</p>
              <h2 data-testid="course-title">${escapeHtml(course.title)}</h2>
              <p class="muted" style="margin:0;font-size:13px;">${escapeHtml(course.description || "A focused Mock College learning experience.")}</p>
            </div>
            <span class="status ${statusClass}" data-testid="assignment-status" data-state="${state}">${state}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Recording progress</span>
            <strong class="metric-value" data-testid="recording-state">${recordingState}</strong>
          </div>
          <div class="progress-track" role="progressbar" aria-label="${escapeHtml(course.title)} recording progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
            <div class="progress-bar" data-testid="recording-progress" style="width:${progressPercent}%"></div>
          </div>
          <div class="progress-caption">
            <span data-testid="recording-progress-percent">${progressPercent}% server accepted</span>
            <span>${activities.length} activities · ${durationSeconds || "—"} sec</span>
          </div>
          <p class="muted" style="font-size:12px;margin:12px 0 0;">Instructor: ${escapeHtml(course.instructor || "Mock College Faculty")}</p>

          <div class="course-next" data-testid="course-next-action">
            ${submission
              ? "Submission recorded. This course milestone is complete."
              : eligibility.eligible
                ? "Next step: open the assignment and submit your answers."
                : "Next step: watch the recording to unlock the assignment."}
          </div>

          <div class="button-row">
            <a class="button secondary" data-testid="course-link" href="/courses/${encodeURIComponent(course.id)}">Open course</a>
            ${recording
              ? `<a class="button secondary" data-testid="recording-link" href="/recordings/${encodeURIComponent(recording.id)}">Open recording</a>`
              : ""}
            ${assignment && eligibility.eligible
              ? `<a class="button" data-testid="assignment-link" href="/assignments/${encodeURIComponent(assignment.id)}">Open assignment</a>`
              : ""}
          </div>
        </article>
      `;
    })
    .join("");

  res.send(
    htmlPage(
      "Courses",
      `
      <div class="page-heading" data-testid="courses-heading">
        <div>
          <p class="eyebrow">Student workspace</p>
          <h1>${greeting}, Demo Student</h1>
          <p class="muted">
            Your learning overview · server truth keeps every assignment safely behind its required recording.
          </p>
        </div>
        <div class="heading-actions">
          <span class="student-chip">Demo Student</span>
          <a class="button secondary" data-testid="demo-status-link" href="/demo-status">Demo status</a>
          <form method="post" action="/logout">
            <button class="button ghost" data-testid="logout-button" type="submit">Log out</button>
          </form>
        </div>
      </div>

      <div class="status-grid" data-testid="dashboard-summary">
        <div class="status-metric"><span class="metric-label">My courses</span><strong>${courses.length}</strong></div>
        <div class="status-metric"><span class="metric-label">Recordings complete</span><strong>${completedRecordings} / ${courses.length}</strong></div>
        <div class="status-metric"><span class="metric-label">Assignments submitted</span><strong>${submittedAssignments} / ${courses.length}</strong></div>
      </div>

      <div class="course-grid" data-testid="course-grid">
        ${cards}
      </div>
      `
    )
  );
});

app.get("/demo-status", requireAuth, (req: AuthedRequest, res) => {
  const snapshot = getDemoStatusSnapshot(req.userId!);
  const latestRun = snapshot.latestRun;
  const runStatusClass = latestRun?.status === "SUCCESS" ? "submitted" : "locked";
  const courseRows = snapshot.courses
    .map(
      (course) => `
        <tr data-testid="demo-status-course" data-course-id="${escapeHtml(course.id)}">
          <td><strong>${escapeHtml(course.code || "COURSE")}</strong><br />${escapeHtml(course.title)}</td>
          <td>${course.activityCount}</td>
          <td>${course.recordingComplete ? "Complete" : "Incomplete"} · ${course.progressPercent}%</td>
          <td><span class="status ${course.assignmentState === "SUBMITTED" ? "submitted" : course.assignmentState === "OPEN" ? "open" : "locked"}" data-testid="demo-status-assignment">${course.assignmentState}</span></td>
        </tr>
      `
    )
    .join("");

  res.send(
    htmlPage(
      "Demo status",
      `
      <div class="page-heading" data-testid="demo-status">
        <div>
          <p class="eyebrow">Reviewer console · DEMO</p>
          <h1>Run visibility</h1>
          <p class="muted">A secret-safe snapshot of server state and the latest worker run.</p>
        </div>
        <a class="button secondary" data-testid="demo-status-back" href="/courses">← Back to courses</a>
      </div>

      <div class="status-grid">
        <div class="status-metric"><span class="metric-label">Seeded courses</span><strong data-testid="demo-course-count">${snapshot.courses.length}</strong></div>
        <div class="status-metric"><span class="metric-label">Activities</span><strong data-testid="demo-activity-count">${snapshot.activityCount}</strong></div>
        <div class="status-metric"><span class="metric-label">Latest run status</span><strong data-testid="demo-run-status">${latestRun ? escapeHtml(latestRun.status) : "No run yet"}</strong></div>
        <div class="status-metric"><span class="metric-label">Provider</span><strong data-testid="demo-run-provider">${latestRun ? escapeHtml(latestRun.provider) : "No run yet"}</strong></div>
      </div>

      <section class="card" data-testid="demo-run-card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Latest worker run</p>
            <h2>${latestRun ? escapeHtml(latestRun.runId) : "Waiting for first run"}</h2>
          </div>
          <span class="status ${runStatusClass}" data-testid="demo-run-badge">${latestRun ? escapeHtml(latestRun.status) : "NOT RUN"}</span>
        </div>
        <p class="muted" data-testid="demo-run-model">Model: ${latestRun ? escapeHtml(latestRun.model) : "—"}</p>
        <p class="muted">Courses: ${latestRun?.courseCount ?? "—"} · Blocked attempts: ${latestRun?.blockedAttempts ?? "—"} · Assignments submitted: ${latestRun?.assignmentsSubmitted ?? "—"}</p>
        <p class="muted" data-testid="demo-evidence-directory">Evidence: ${latestRun ? escapeHtml(latestRun.evidenceDirectory) : "—"}</p>
        <p class="muted">Ledger: ${latestRun ? escapeHtml(latestRun.ledgerPath) : "—"}</p>
        <p class="muted" style="margin-bottom:0;">Historical automation evidence remains available after the demo database is reset.</p>
        <p class="muted" style="margin-bottom:0;">Credentials, cookies, authorization headers, and provider secrets are intentionally excluded.</p>
      </section>

      <section class="card">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Server truth</p>
            <h2>Course milestones</h2>
          </div>
        </div>
        <table class="status-table">
          <thead><tr><th>Course</th><th>Activities</th><th>Recording</th><th>Assignment</th></tr></thead>
          <tbody>${courseRows}</tbody>
        </table>
      </section>
      `
    )
  );
});

app.get("/courses/:id", requireAuth, (req: AuthedRequest, res) => {
  const courseId = getRouteParam(req, "id");
  if (!courseId) return res.status(400).send("Invalid course id");

  const course = db
    .prepare("SELECT id, code, title, instructor, description FROM courses WHERE id = ?")
    .get(courseId) as
    | { id: string; code: string | null; title: string; instructor: string | null; description: string | null }
    | undefined;
  if (!course) return res.status(404).send("Course not found");

  const activities = db
    .prepare(`
      SELECT id, type, title, duration_seconds, sort_order
      FROM activities
      WHERE course_id = ?
      ORDER BY sort_order
    `)
    .all(course.id) as Array<{
    id: string;
    type: "MEETING_RECORDING" | "ASSIGNMENT";
    title: string;
    duration_seconds: number | null;
    sort_order: number;
  }>;
  const recording = activities.find((activity) => activity.type === "MEETING_RECORDING");
  const assignment = activities.find((activity) => activity.type === "ASSIGNMENT");
  const progress = recording
    ? (db
        .prepare(`
          SELECT watched_seconds, last_position_seconds, complete
          FROM recording_progress
          WHERE user_id = ? AND activity_id = ?
        `)
        .get(req.userId, recording.id) as
        | { watched_seconds: number; last_position_seconds: number; complete: number }
        | undefined)
    : undefined;
  const eligibility = assignment
    ? getAssignmentEligibility(req.userId!, assignment.id)
    : { eligible: false, reason: "NO_ASSIGNMENT" };
  const submission = assignment
    ? (db
        .prepare("SELECT status FROM assignment_submissions WHERE user_id = ? AND activity_id = ?")
        .get(req.userId, assignment.id) as { status: string } | undefined)
    : undefined;
  const recordingPercent = recording?.duration_seconds
    ? progress?.complete
      ? 100
      : Math.min(100, Math.round(((progress?.watched_seconds ?? 0) / recording.duration_seconds) * 100))
    : 0;
  const recordingState = progress?.complete
    ? "COMPLETE"
    : progress && progress.last_position_seconds > 0
      ? "IN PROGRESS"
      : "NOT STARTED";
  const assignmentState = submission ? "SUBMITTED" : eligibility.eligible ? "OPEN" : "LOCKED";

  res.send(
    htmlPage(
      course.title,
      `
      <div class="page-heading" data-testid="course-detail">
        <div>
          <p class="eyebrow">${escapeHtml(course.code || "COURSE")} · Course detail</p>
          <h1>${escapeHtml(course.title)}</h1>
          <p class="muted">${escapeHtml(course.description || "A focused Mock College learning experience.")}</p>
          <p class="muted" style="font-size:13px;margin-bottom:0;">Instructor: ${escapeHtml(course.instructor || "Mock College Faculty")}</p>
        </div>
        <a class="button secondary" data-testid="course-detail-back" href="/courses">← Dashboard</a>
      </div>

      <section class="card">
        <div class="section-heading">
          <div><p class="eyebrow">Course progress</p><h2>${recordingPercent}% complete</h2></div>
          <span class="status ${recordingState === "COMPLETE" ? "submitted" : "locked"}">${recordingState}</span>
        </div>
        <div class="progress-track" role="progressbar" aria-label="Course progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${recordingPercent}"><div class="progress-bar" style="width:${recordingPercent}%"></div></div>
      </section>

      <section class="card" data-testid="activity-list">
        <div class="section-heading"><div><p class="eyebrow">Learning path</p><h2>Activities</h2></div><span class="muted">${activities.length} activities</span></div>
        <div class="status-grid">
          <div class="status-metric" data-testid="recording-activity">
            <span class="metric-label">Meeting recording</span>
            <strong>${recording ? escapeHtml(recording.title) : "Not configured"}</strong>
            <p class="muted">${recordingState} · ${recordingPercent}%</p>
            ${recording ? `<a class="button secondary" href="/recordings/${encodeURIComponent(recording.id)}">Open recording</a>` : ""}
          </div>
          <div class="status-metric" data-testid="assignment-activity">
            <span class="metric-label">Assignment</span>
            <strong>${assignment ? escapeHtml(assignment.title) : "Not configured"}</strong>
            <p class="muted">${assignmentState}${assignmentState === "LOCKED" ? " · Complete the required meeting recording to unlock this assignment." : ""}</p>
            ${assignment && eligibility.eligible ? `<a class="button" href="/assignments/${encodeURIComponent(assignment.id)}">Open assignment</a>` : ""}
          </div>
        </div>
      </section>
      `
    )
  );
});

app.get(
  "/recordings/:id",
  requireAuth,
  (req: AuthedRequest, res) => {
    const recordingId = getRouteParam(req, "id");

    if (!recordingId) {
      return res.status(400).send("Invalid recording id");
    }

    const activity = db
      .prepare(`
        SELECT id, title, duration_seconds
        FROM activities
        WHERE id = ? AND type = 'MEETING_RECORDING'
      `)
      .get(recordingId) as
      | {
          id: string;
          title: string;
          duration_seconds: number;
        }
      | undefined;

    if (!activity) {
      return res.status(404).send("Recording not found");
    }

    const progress = (db
      .prepare(`
        SELECT
          watched_seconds,
          last_position_seconds,
          complete
        FROM recording_progress
        WHERE user_id = ? AND activity_id = ?
      `)
      .get(req.userId, activity.id) as {
      watched_seconds: number;
      last_position_seconds: number;
      complete: number;
    } | undefined) ?? {
      watched_seconds: 0,
      last_position_seconds: 0,
      complete: 0
    };

    res.send(
      htmlPage(
        activity.title,
        `
        <div data-testid="recording-page">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Course recording</p>
              <h1>${escapeHtml(activity.title)}</h1>
              <p class="muted">Time-compressed meeting playback · ${activity.duration_seconds} seconds</p>
            </div>
            <a class="button secondary" data-testid="recording-back" href="/courses">← Back to courses</a>
          </div>

          <div class="recording-shell">
            <div class="recording" data-testid="recording-player">
              <div>
                <div class="recording-icon" aria-hidden="true">▶</div>
                <p class="eyebrow" style="color:#93c5fd;">Server-validated playback</p>
                <h2>Stay with the recording</h2>
                <p style="color:#c7d4e8;max-width:32rem;">Progress is accepted by the college server one heartbeat at a time.</p>
                <button class="button" data-testid="recording-play" id="playButton">
                  ${progress.complete ? "Completed ✓" : "Play recording"}
                </button>
              </div>
            </div>

            <div class="recording-controls">
              <div class="metric-row">
                <strong>Playback position</strong>
                <span class="recording-status" id="status" data-testid="playback-status">
                  ${progress.complete ? "College reports recording complete ✓" : "Ready to play"}
                </span>
              </div>
              <div class="progress-track" role="progressbar" aria-label="Recording playback progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <div class="progress-bar" id="progressBar" data-testid="recording-progress-bar"></div>
              </div>
              <div class="progress-caption">
                <span id="timeReadout" data-testid="recording-time">${progress.last_position_seconds.toFixed(0)} / ${activity.duration_seconds} sec</span>
                <span id="percentReadout" data-testid="recording-percent">0%</span>
              </div>
              <p class="recording-status" id="serverProgress" data-testid="server-progress" style="margin:18px 0 0;">
                Server-validated watch time: ${progress.watched_seconds.toFixed(1)} sec
              </p>
              <div class="gate-note" data-testid="gate-warning">
                <strong>Gate rule</strong>
                <span>Seeking to the end does not satisfy the completion gate. Only sequential server-accepted playback unlocks the assignment.</span>
              </div>
            </div>
          </div>
        </div>

<script>
(() => {
  const duration = ${JSON.stringify(activity.duration_seconds)};
  const activityId = ${JSON.stringify(activity.id)};
  let position = ${JSON.stringify(progress.last_position_seconds)};
  let watched = ${JSON.stringify(progress.watched_seconds)};
  let playing = false;
  let timer = null;
  let complete = ${Boolean(progress.complete)};

  const button = document.getElementById("playButton");
  const progressBar = document.getElementById("progressBar");
  const status = document.getElementById("status");
  const timeReadout = document.getElementById("timeReadout");
  const percentReadout = document.getElementById("percentReadout");
  const serverProgress = document.getElementById("serverProgress");
  const progressTrack = progressBar.parentElement;

  function render() {
    const percent = Math.min(100, Math.round((position / duration) * 100));
    progressBar.style.width = percent + "%";
    progressTrack.setAttribute("aria-valuenow", String(percent));
    timeReadout.textContent = position.toFixed(0) + " / " + duration + " sec";
    percentReadout.textContent = percent + "%";
    serverProgress.textContent = "Server-validated watch time: " + watched.toFixed(1) + " sec";

    if (complete) {
      button.textContent = "Completed ✓";
      button.disabled = true;
      status.textContent = "College reports recording complete ✓";
    } else {
      button.textContent = playing ? "Pause" : "Play recording";
      status.textContent = playing
        ? "Playback in progress"
        : position > 0
          ? "In progress"
          : "Ready to play";
    }
  }

  async function heartbeat() {
    const response = await fetch("/api/recordings/" + activityId + "/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positionSeconds: position })
    });

    const result = await response.json();

    if (!response.ok) {
      playing = false;
      clearInterval(timer);
      status.textContent = "Progress update failed";
      return;
    }

    complete = result.complete;
    watched = result.watchedSeconds;

    if (complete) {
      playing = false;
      clearInterval(timer);
      render();

      setTimeout(() => {
        window.location.href = "/courses";
      }, 800);
    }
  }

  button.addEventListener("click", () => {
    if (complete) return;

    playing = !playing;

    if (playing) {
      timer = setInterval(async () => {
        position = Math.min(duration, position + 1);
        render();
        await heartbeat();

        if (position >= duration && !complete) {
          playing = false;
          clearInterval(timer);
        }
      }, 1000);
    } else {
      clearInterval(timer);
    }

    render();
  });

  render();
})();
</script>
        `
      )
    );
  }
);

app.post(
  "/api/recordings/:id/heartbeat",
  requireAuth,
  (req: AuthedRequest, res) => {
    try {
      const activityId = getRouteParam(req, "id");

      if (!activityId) {
        return res.status(400).json({ error: "INVALID_ACTIVITY_ID" });
      }

      const positionSeconds = Number(req.body.positionSeconds);

      if (!Number.isFinite(positionSeconds)) {
        return res.status(400).json({
          error: "INVALID_POSITION"
        });
      }

      const result = processRecordingHeartbeat({
        userId: req.userId!,
        activityId,
        positionSeconds
      });

      res.json(result);
    } catch (error) {
      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "HEARTBEAT_FAILED"
      });
    }
  }
);

app.get(
  "/api/assignments/:id/eligibility",
  requireAuth,
  (req: AuthedRequest, res) => {
    const assignmentId = getRouteParam(req, "id");

    if (!assignmentId) {
      return res.status(400).json({ error: "INVALID_ASSIGNMENT_ID" });
    }

    res.json(
      getAssignmentEligibility(
        req.userId!,
        assignmentId
      )
    );
  }
);

app.get(
  "/assignments/:id",
  requireAuth,
  (req: AuthedRequest, res) => {
    const assignmentId = getRouteParam(req, "id");

    if (!assignmentId) {
      return res.status(400).send("Invalid assignment id");
    }

    const activity = db
      .prepare(`
        SELECT id, course_id, title
        FROM activities
        WHERE id = ? AND type = 'ASSIGNMENT'
      `)
      .get(assignmentId) as
      | { id: string; course_id: string; title: string }
      | undefined;

    if (!activity) {
      return res.status(404).send("Assignment not found");
    }

    const course = db
      .prepare("SELECT code, title FROM courses WHERE id = ?")
      .get(activity.course_id) as { code: string | null; title: string } | undefined;

    const eligibility = getAssignmentEligibility(
      req.userId!,
      activity.id
    );

    if (!eligibility.eligible) {
      return res.status(403).send(
        htmlPage(
          "Assignment locked",
          `
          <div class="card" data-testid="assignment-locked">
            <p class="eyebrow">Server-owned gate</p>
            <h1>Assignment locked</h1>
            <div class="notice error">
              Required recording is not yet complete. Assignment work is refused until the college server confirms completion.
            </div>
            <a class="button secondary" data-testid="locked-back" href="/courses">
              Back to courses
            </a>
          </div>
          `
        )
      );
    }

    const questions = db
      .prepare(`
        SELECT id, type, prompt, options_json
        FROM questions
        WHERE activity_id = ?
        ORDER BY id
      `)
      .all(activity.id) as Array<{
      id: string;
      type: "MULTIPLE_CHOICE" | "TEXT";
      prompt: string;
      options_json: string | null;
    }>;

    const fields = questions
      .map((question, index) => {
        if (question.type === "MULTIPLE_CHOICE") {
          const options = JSON.parse(
            question.options_json || "[]"
          ) as string[];

          return `
            <div class="card question-card" data-testid="question-card" data-question-id="${escapeHtml(question.id)}">
               <p class="eyebrow">Question ${index + 1} of ${questions.length} · Multiple choice</p>
               <p><strong>${escapeHtml(question.prompt)}</strong></p>
               ${options
                 .map(
                   (option) => `
                    <label class="option">
                      <input
                        data-testid="question-input"
                        type="radio"
                        name="${escapeHtml(question.id)}"
                        value="${escapeHtml(option)}"
                        required
                      />
                       ${escapeHtml(option)}
                    </label>
                  `
                )
                .join("")}
            </div>
          `;
        }

        return `
          <div class="card question-card" data-testid="question-card" data-question-id="${escapeHtml(question.id)}">
            <p class="eyebrow">Question ${index + 1} of ${questions.length} · Short answer</p>
            <label class="field-label" for="question-${escapeHtml(question.id)}">${escapeHtml(question.prompt)}</label>
            <textarea id="question-${escapeHtml(question.id)}" data-testid="question-input" name="${escapeHtml(question.id)}" rows="4" required></textarea>
          </div>
        `;
      })
      .join("");

    res.send(
      htmlPage(
        activity.title,
        `
        <div class="section-heading">
          <div>
            <p class="eyebrow">Assignment workspace</p>
            <h1>${escapeHtml(activity.title)}</h1>
            <p class="muted">${escapeHtml(course?.code || "COURSE")} · ${escapeHtml(course?.title || "Mock College")} · Answer each question, then submit once.</p>
          </div>
          <a class="button secondary" data-testid="assignment-back" href="/courses">← Back to courses</a>
        </div>
        <div class="notice" data-testid="assignment-eligibility">
          <strong>Eligible on the server.</strong> The required recording has been confirmed complete.
        </div>

         <form class="assignment-form" data-testid="assignment-form" method="post" action="/assignments/${encodeURIComponent(activity.id)}/submit">
           ${fields}
           <button class="button" data-testid="assignment-submit" type="submit">Submit assignment</button>
         </form>
        `
      )
    );
  }
);

app.post(
  "/assignments/:id/submit",
  requireAuth,
  (req: AuthedRequest, res) => {
    const assignmentId = getRouteParam(req, "id");

    if (!assignmentId) {
      return res.status(400).json({ error: "INVALID_ASSIGNMENT_ID" });
    }

    const eligibility = getAssignmentEligibility(
      req.userId!,
      assignmentId
    );

    if (!eligibility.eligible) {
      return res.status(403).json({
        error: "ASSIGNMENT_BLOCKED",
        reason: eligibility.reason
      });
    }

    db.prepare(`
      INSERT INTO assignment_submissions
        (user_id, activity_id, status, answers_json, submitted_at)
      VALUES (?, ?, 'SUBMITTED', ?, ?)
      ON CONFLICT(user_id, activity_id)
      DO UPDATE SET
        answers_json = excluded.answers_json,
        submitted_at = excluded.submitted_at,
        status = 'SUBMITTED'
    `).run(
      req.userId,
      assignmentId,
      JSON.stringify(req.body),
      new Date().toISOString()
    );

    res.send(
      htmlPage(
        "Submitted",
        `
        <div class="card" data-testid="submission-success">
          <p class="eyebrow">Server response</p>
          <h1>Assignment submitted ✓</h1>
          <p class="muted">Your answers were accepted and recorded by Mock College.</p>
          <a class="button" data-testid="submission-back" href="/courses">
            Return to courses
          </a>
        </div>
        `
      )
    );
  }
);

app.get("/api/courses", requireAuth, (req: AuthedRequest, res) => {
  const courses = db
    .prepare(`
      SELECT id, code, title, instructor, description
      FROM courses
      ORDER BY title
    `)
    .all() as Array<{ id: string; title: string }>;

  const result = courses.map((course) => {
    const activities = db
      .prepare(`
        SELECT id, type, title, duration_seconds, sort_order
        FROM activities
        WHERE course_id = ?
        ORDER BY sort_order
      `)
      .all(course.id);

    return {
      ...course,
      activities
    };
  });

  res.json(result);
});

export function startServer() {
  return app.listen(PORT, () => {
    console.log(`✅ Mock College LMS running at http://localhost:${PORT}`);
    console.log("Demo login: student@mockcollege.local / demo123");
  });
}

export { app };

if (require.main === module) {
  startServer();
}
