import express from "express";
import path from "node:path";
import { db, initSchema } from "../db/db";
import {
  getAssignmentEligibility,
  processRecordingHeartbeat
} from "./gate";

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
</style>
</head>
<body>
<header>
  <a href="/courses"><strong>Mock College LMS</strong></a>
  <span>Engineering Exercise</span>
</header>
<main>${body}</main>
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

app.get("/login", (_req, res) => {
  res.send(
    htmlPage(
      "Login",
      `
      <div class="card" style="max-width:480px;margin:70px auto;">
        <h1>Student Login</h1>
        <p class="muted">Seeded demo account</p>

        <form method="post" action="/login">
          <label for="email">Email</label>
          <input
            id="email"
            name="email"
            value="student@mockcollege.local"
            autocomplete="username"
          />

          <label for="password">Password</label>
          <input
            id="password"
            type="password"
            name="password"
            value="demo123"
            autocomplete="current-password"
          />

          <button type="submit">Sign in</button>
        </form>
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
      SELECT id, title
      FROM courses
      ORDER BY title
    `)
    .all() as Array<{ id: string; title: string }>;

  const cards = courses
    .map((course) => {
      const activities = db
        .prepare(`
          SELECT id, type, title
          FROM activities
          WHERE course_id = ?
          ORDER BY sort_order
        `)
        .all(course.id) as Array<{
          id: string;
          type: string;
          title: string;
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

      return `
        <div class="card">
          <h2>${escapeHtml(course.title)}</h2>

          <p>
            Recording:
            <strong>${progress?.complete ? "Complete" : "Incomplete"}</strong>
          </p>

          <p>
            Assignment:
            <span class="status ${statusClass}">${state}</span>
          </p>

          ${
            recording
               ? `<a class="button" href="/recordings/${encodeURIComponent(recording.id)}">
                   Open recording
                 </a>`
              : ""
          }

          ${
            assignment && eligibility.eligible
               ? `<a class="button" href="/assignments/${encodeURIComponent(assignment.id)}">
                   Open assignment
                 </a>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  res.send(
    htmlPage(
      "Courses",
      `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <h1>Your Courses</h1>
          <p class="muted">
            Recordings must be server-confirmed complete before assignments unlock.
          </p>
        </div>

        <form method="post" action="/logout">
          <button type="submit">Logout</button>
        </form>
      </div>

      <div class="grid">
        ${cards}
      </div>
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
        <div class="card">
          <a href="/courses">← Back to courses</a>

           <h1>${escapeHtml(activity.title)}</h1>

          <div class="recording">
            <div>
              <h2>Meeting Recording</h2>
              <p>
                Time-compressed demo recording:
                        ${activity.duration_seconds} seconds
              </p>
              <button id="playButton">
                ${progress.complete ? "Completed ✓" : "Play recording"}
              </button>
            </div>
          </div>

          <div class="progress-track">
            <div class="progress-bar" id="progressBar"></div>
          </div>

          <p id="status">
            ${progress.complete
              ? "College reports recording complete ✓"
              : "Recording incomplete"}
          </p>

          <p class="muted">
            The server validates sequential playback heartbeats.
            Seeking directly to the end will not complete the recording.
          </p>
        </div>

<script>
(() => {
  const duration = ${JSON.stringify(activity.duration_seconds)};
  const activityId = ${JSON.stringify(activity.id)};
  let position = ${JSON.stringify(progress.last_position_seconds)};
  let playing = false;
  let timer = null;
  let complete = ${Boolean(progress.complete)};

  const button = document.getElementById("playButton");
  const progressBar = document.getElementById("progressBar");
  const status = document.getElementById("status");

  function render() {
    progressBar.style.width =
      Math.min(100, (position / duration) * 100) + "%";

    if (complete) {
      button.textContent = "Completed ✓";
      button.disabled = true;
      status.textContent = "College reports recording complete ✓";
    } else {
      button.textContent = playing ? "Pause" : "Play recording";
      status.textContent =
        "Playback: " +
        position.toFixed(0) +
        " / " +
        duration +
        " seconds";
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
        SELECT id, title
        FROM activities
        WHERE id = ? AND type = 'ASSIGNMENT'
      `)
      .get(assignmentId) as
      | { id: string; title: string }
      | undefined;

    if (!activity) {
      return res.status(404).send("Assignment not found");
    }

    const eligibility = getAssignmentEligibility(
      req.userId!,
      activity.id
    );

    if (!eligibility.eligible) {
      return res.status(403).send(
        htmlPage(
          "Assignment locked",
          `
          <div class="card">
            <h1>Assignment Locked</h1>
            <p class="error">
              Required recording is not yet complete.
            </p>
            <a class="button" href="/courses">
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
      .map((question) => {
        if (question.type === "MULTIPLE_CHOICE") {
          const options = JSON.parse(
            question.options_json || "[]"
          ) as string[];

          return `
            <div class="card">
               <p><strong>${escapeHtml(question.prompt)}</strong></p>
              ${options
                .map(
                  (option) => `
                    <label style="display:block;margin:8px 0;">
                      <input
                        style="width:auto;"
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
          <div class="card">
            <label>${escapeHtml(question.prompt)}</label>
            <input name="${escapeHtml(question.id)}" required />
          </div>
        `;
      })
      .join("");

    res.send(
      htmlPage(
        activity.title,
        `
        <a href="/courses">← Back to courses</a>
         <h1>${escapeHtml(activity.title)}</h1>

         <form method="post" action="/assignments/${encodeURIComponent(activity.id)}/submit">
          ${fields}
          <button type="submit">Submit assignment</button>
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
        <div class="card">
          <h1>Assignment Submitted ✓</h1>
          <p>Your submission has been recorded.</p>
          <a class="button" href="/courses">
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
      SELECT id, title
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
