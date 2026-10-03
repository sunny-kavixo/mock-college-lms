import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { chromium, type Page } from "playwright";
import { startServer } from "../college/server/index";
import { createAIAnswerProvider, type AssignmentQuestion } from "./ai/provider";
import { checkRunInvariants, RunLedger } from "./ledger";
import { assertSafeEvidence, safeError } from "./artifacts";
import { answerEligibleAssignment } from "./orchestrator/assignment";

interface CourseActivity {
  id: string;
  course_id: string;
  type: "MEETING_RECORDING" | "ASSIGNMENT";
  title: string;
  duration_seconds: number | null;
  sort_order: number;
}

interface DiscoveredCourse {
  id: string;
  title: string;
  activities: CourseActivity[];
}

interface HeartbeatResponse {
  activityId: string;
  complete: boolean;
  positionSeconds: number;
  watchedSeconds: number;
  contiguousSeconds: number;
  reason: string;
}

interface EvidenceWriter {
  capture(
    page: Page,
    name: string,
    context?: Record<string, unknown>
  ): Promise<void>;
  captureFailure(
    page: Page,
    name: string,
    context: Record<string, unknown>
  ): Promise<void>;
}

export type WorkerFailureCode =
  | "AUTH_FAILED"
  | "COURSE_DISCOVERY_FAILED"
  | "RECORDING_FAILED"
  | "GATE_CLOSED"
  | "AI_PROVIDER_FAILED"
  | "ASSIGNMENT_SUBMIT_FAILED"
  | "BROWSER_FAILED"
  | "WORKER_FAILED";

export function classifyFailure(error: unknown): WorkerFailureCode {
  const message = safeError(error).toLowerCase();

  if (message.includes("login") || message.includes("sign in") || message.includes("unauthenticated")) {
    return "AUTH_FAILED";
  }
  if (message.includes("course") || message.includes("activity")) {
    return "COURSE_DISCOVERY_FAILED";
  }
  if (message.includes("recording") || message.includes("heartbeat")) {
    return "RECORDING_FAILED";
  }
  if (message.includes("locked") || message.includes("gate") || message.includes("eligib")) {
    return "GATE_CLOSED";
  }
  if (message.includes("ai provider") || message.includes("provider") || message.includes("answer")) {
    return "AI_PROVIDER_FAILED";
  }
  if (message.includes("assignment") || message.includes("submission")) {
    return "ASSIGNMENT_SUBMIT_FAILED";
  }
  if (message.includes("browser") || message.includes("page") || message.includes("playwright")) {
    return "BROWSER_FAILED";
  }
  return "WORKER_FAILED";
}

const baseUrl = (process.env.COLLEGE_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3001}`)
  .replace(/\/$/, "");
const loginEmail = "student@mockcollege.local";
const loginPassword = "demo123";

function makeRunId(): string {
  return `run-${new Date().toISOString().replace(/[.:]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function createEvidenceWriter(runId: string, ledger: RunLedger): EvidenceWriter {
  const directory = path.resolve("evidence", runId);
  fs.mkdirSync(directory, { recursive: true });
  const write = async (
    page: Page,
    name: string,
    context: Record<string, unknown>,
    failure: boolean
  ) => {
    const baseName = slug(name);
    const html = await page.content();

    try {
      assertSafeEvidence(html);
    } catch {
      ledger.append("evidence.captured", "SKIPPED", {
        ...context,
        reason: "SENSITIVE_PAGE",
        evidencePath: `evidence/${runId}/${baseName}`
      });
      return;
    }

    await page.screenshot({
      path: path.join(directory, `${baseName}.png`),
      fullPage: true
    });
    fs.writeFileSync(
      path.join(directory, `${baseName}.html`),
      html,
      "utf8"
    );
    ledger.append("evidence.captured", failure ? "FAILURE" : "SUCCESS", {
      ...context,
      evidencePath: `evidence/${runId}/${baseName}`,
      files: ["png", "html"].map((extension) =>
        `evidence/${runId}/${baseName}.${extension}`
      )
    });
  };

  return {
    async capture(page, name, context = {}) {
      await write(page, name, context, false);
    },
    async captureFailure(page, name, context) {
      await write(page, name, context, true);
    }
  };
}

async function waitForServer(): Promise<Server | undefined> {
  try {
    const response = await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error("College login page is unavailable");
    return undefined;
  } catch {
    if (process.env.COLLEGE_BASE_URL) {
      throw new Error("Configured college server is unavailable");
    }
    const server = startServer();

    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        await fetch(`${baseUrl}/login`, { signal: AbortSignal.timeout(3_000) });
        return server;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    server.close();
    throw new Error(`College server did not become ready at ${baseUrl}`);
  }
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function discoverCourses(page: Page): Promise<DiscoveredCourse[]> {
  const uiCourseTitles = await page
    .locator('[data-testid="course-card"] [data-testid="course-title"]')
    .allTextContents();
  const response = await page.evaluate(async () => {
    const result = await fetch("/api/courses");

    if (!result.ok) {
      throw new Error(`Course discovery failed with HTTP ${result.status}`);
    }

    return result.json();
  });
  const courses = response as DiscoveredCourse[];

  if (courses.length !== 2) {
    throw new Error(`Expected two courses, discovered ${courses.length}`);
  }

  if (
    courses.some(
      (course) =>
        !uiCourseTitles.some((title) => title.trim() === course.title.trim())
    )
  ) {
    throw new Error("Course API discovery did not match the logged-in UI");
  }

  for (const course of courses) {
    const recordings = course.activities.filter(
      (activity) => activity.type === "MEETING_RECORDING"
    );
    const assignments = course.activities.filter(
      (activity) => activity.type === "ASSIGNMENT"
    );

    if (recordings.length !== 1 || assignments.length !== 1) {
      throw new Error(`Course ${course.id} does not have one recording and assignment`);
    }
  }

  return courses;
}

async function extractQuestions(page: Page): Promise<AssignmentQuestion[]> {
  return page.locator('[data-testid="question-card"]').evaluateAll((cards) =>
    cards.map((card) => {
      const inputs = Array.from(card.querySelectorAll("input"));
      const firstInput = inputs[0];
      const questionId = firstInput?.getAttribute("name") || "";
      const type = firstInput?.getAttribute("type") === "radio"
        ? "MULTIPLE_CHOICE"
        : "TEXT";
      const prompt =
        card.querySelector("p strong")?.textContent?.trim() ||
        card.querySelector("label")?.textContent?.trim() ||
        "";
      const options = inputs
        .filter((input) => input.getAttribute("type") === "radio")
        .map((input) => input.getAttribute("value") || "");

      return { id: questionId, type, prompt, options };
    }) as AssignmentQuestion[]
  );
}

async function fillAnswers(
  page: Page,
  answers: Record<string, string>
): Promise<void> {
  for (const input of await page.locator("form input").all()) {
    const name = await input.getAttribute("name");
    const answer = name ? answers[name] : undefined;
    if (answer === undefined) throw new Error("AI provider omitted an answer");
    if (await input.getAttribute("type") === "radio") {
      if (await input.getAttribute("value") === answer) await input.check();
    } else {
      await input.fill(answer);
    }
  }
}

async function watchRecording(
  page: Page,
  recording: CourseActivity,
  ledger: RunLedger,
  evidence: EvidenceWriter,
  course: DiscoveredCourse
): Promise<HeartbeatResponse> {
  if (!recording.duration_seconds || recording.duration_seconds <= 0) {
    throw new Error(`Recording ${recording.id} has no valid duration`);
  }

  await page.goto(`${baseUrl}/recordings/${encodeURIComponent(recording.id)}`, {
    waitUntil: "domcontentloaded"
  });
  await evidence.capture(page, `${course.id}-recording-start`, {
    courseId: course.id,
    activityId: recording.id,
    activityType: recording.type
  });
  ledger.append("recording.started", "STARTED", {
    courseId: course.id,
    activityId: recording.id,
    activityType: recording.type,
    reason: "PLAYBACK_STARTED",
    durationSeconds: recording.duration_seconds
  });

  const heartbeats: HeartbeatResponse[] = [];
  const announcedMilestones = new Set<number>();
  const responseListener = (response: import("playwright").Response) => {
    if (
      new URL(response.url()).pathname !== `/api/recordings/${encodeURIComponent(recording.id)}/heartbeat` ||
      !response.ok()
    ) {
      return;
    }

    void response
      .json()
      .then((body: HeartbeatResponse) => {
        heartbeats.push(body);
        ledger.append("recording.progress", "OBSERVED", {
          courseId: course.id,
          activityId: recording.id,
          activityType: recording.type,
          reason: body.reason,
          serverResponse: body
        });
        const percent = Math.min(
          100,
          Math.round((body.positionSeconds / recording.duration_seconds!) * 100)
        );
        for (const milestone of [25, 50, 75]) {
          if (percent >= milestone && !announcedMilestones.has(milestone)) {
            announcedMilestones.add(milestone);
            console.log(`    ${milestone}% server progress`);
          }
        }
        if (body.complete && !announcedMilestones.has(100)) {
          announcedMilestones.add(100);
          console.log("    ✓ Server reports recording complete");
        }
      })
      .catch(() => undefined);
  };
  page.on("response", responseListener);

  try {
    await page.getByRole("button", { name: "Play recording" }).click();
    await page.waitForURL(`${baseUrl}/courses`, {
      timeout: (recording.duration_seconds + 10) * 2_000,
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(100);
  } finally {
    page.off("response", responseListener);
  }

  const completion = [...heartbeats]
    .reverse()
    .find((heartbeat) => heartbeat.complete === true);

  if (!completion) {
    throw new Error(`College server never reported ${recording.id} complete`);
  }

  await evidence.capture(page, `${course.id}-recording-complete`, {
    courseId: course.id,
    activityId: recording.id,
    activityType: recording.type,
    reason: "SERVER_CONFIRMED_COMPLETE"
  });
  ledger.append("recording.completed", "SUCCESS", {
    courseId: course.id,
    activityId: recording.id,
    activityType: recording.type,
    reason: "SERVER_CONFIRMED_COMPLETE",
    serverReportedComplete: true,
    completionPositionSeconds: completion.positionSeconds,
    watchedSeconds: completion.watchedSeconds,
    contiguousSeconds: completion.contiguousSeconds,
    completionReason: completion.reason
  });

  return completion;
}

async function probeLockedAssignment(
  page: Page,
  assignment: CourseActivity,
  course: DiscoveredCourse,
  ledger: RunLedger,
  evidence: EvidenceWriter
): Promise<void> {
  const blockedResponse = await page.goto(
    `${baseUrl}/assignments/${encodeURIComponent(assignment.id)}`,
    { waitUntil: "domcontentloaded" }
  );
  const blockedStatus = blockedResponse?.status();

  if (blockedStatus !== 403 || !(await page.getByTestId("assignment-locked").count())) {
    throw new Error(`Assignment ${assignment.id} was not blocked before recording completion`);
  }

  const submission = await page.request.post(
    `${baseUrl}/assignments/${encodeURIComponent(assignment.id)}/submit`,
    { form: {} }
  );
  if (submission.status() !== 403) {
    throw new Error("College accepted a submission while the recording gate was closed");
  }

  await evidence.capture(page, `${course.id}-assignment-blocked`, {
    courseId: course.id,
    activityId: assignment.id,
    activityType: assignment.type,
    reason: "RECORDING_INCOMPLETE"
  });
  ledger.append("assignment.blocked", "BLOCKED", {
    courseId: course.id,
    activityId: assignment.id,
    activityType: assignment.type,
    reason: "RECORDING_INCOMPLETE",
    decision: "REFUSED",
    providerCalled: false,
    httpStatus: blockedStatus,
    submissionHttpStatus: submission.status()
  });
}

async function submitAssignment(
  page: Page,
  assignment: CourseActivity,
  course: DiscoveredCourse,
  requiredRecordingId: string,
  provider: ReturnType<typeof createAIAnswerProvider>,
  ledger: RunLedger,
  evidence: EvidenceWriter
): Promise<void> {
  const gateResponse = await page.request.get(
    `${baseUrl}/api/assignments/${encodeURIComponent(assignment.id)}/eligibility`
  );
  if (!gateResponse.ok()) throw new Error("College eligibility check failed");
  const eligibility = await gateResponse.json() as { eligible: boolean; reason: string };
  ledger.append("assignment.eligible", eligibility.eligible ? "SUCCESS" : "BLOCKED", {
    courseId: course.id,
    activityId: assignment.id,
    requiredRecordingId,
    activityType: assignment.type,
    reason: eligibility.reason,
    serverEligible: eligibility.eligible
  });
  const answers = await answerEligibleAssignment({
    courseId: course.id,
    activityId: assignment.id,
    requiredRecordingId,
    eligibility,
    ledger,
    provider,
    loadQuestions: async () => {
      const response = await page.goto(
        `${baseUrl}/assignments/${encodeURIComponent(assignment.id)}`,
        { waitUntil: "domcontentloaded" }
      );
      if (response?.status() !== 200) {
        ledger.append("assignment.submit.failed", "FAILED", {
          courseId: course.id, activityId: assignment.id,
          activityType: assignment.type,
          reason: "SERVER_REFUSED_ASSIGNMENT",
          providerCalled: false, httpStatus: response?.status()
        });
        throw new Error("College refused assignment access");
      }
      await evidence.capture(page, `${course.id}-assignment-questions`, {
        courseId: course.id,
        activityId: assignment.id,
        activityType: assignment.type,
        reason: "SERVER_ELIGIBLE"
      });
      return extractQuestions(page);
    }
  });
  await fillAnswers(page, answers);

  const [submissionResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url() === `${baseUrl}/assignments/${encodeURIComponent(assignment.id)}/submit` &&
      response.request().method() === "POST"
    ),
    page.getByTestId("assignment-submit").click()
  ]);
  if (!submissionResponse.ok()) {
    if (submissionResponse.status() === 403) {
      ledger.append("assignment.submit.failed", "FAILED", {
        courseId: course.id, activityId: assignment.id, providerCalled: true,
        activityType: assignment.type,
        reason: "SERVER_REFUSED_AFTER_AI", phase: "submission", httpStatus: 403
      });
    }
    throw new Error(`Assignment ${assignment.id} was not accepted by the server`);
  }
  await page.getByTestId("submission-success").waitFor();

  await evidence.capture(page, `${course.id}-assignment-submitted`, {
    courseId: course.id,
    activityId: assignment.id,
    activityType: assignment.type,
    reason: "SERVER_ACCEPTED"
  });
  ledger.append("assignment.submitted", "SUCCESS", {
    courseId: course.id,
    activityId: assignment.id,
    requiredRecordingId,
    activityType: assignment.type,
    reason: "SERVER_ACCEPTED",
    serverAccepted: true,
    httpStatus: submissionResponse.status(),
    provider: provider.name
  });
}

export async function runWorker(): Promise<{
  runId: string;
  ledgerPath: string;
  evidenceDirectory: string;
  provider: string;
}> {
  const runId = makeRunId();
  const ledger = new RunLedger(runId);
  const evidence = createEvidenceWriter(runId, ledger);
  const provider = createAIAnswerProvider();
  let ownedServer: Server | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let page: Page | undefined;
  const browserErrors: string[] = [];

  ledger.append("run.started", "STARTED", {
    collegeOrigin: new URL(baseUrl).origin,
    automation: "playwright",
    provider: provider.name,
    reason: "WORKER_STARTED"
  });
  console.log(`RUN: ${runId}`);
  console.log(`Provider: ${provider.name}`);

  try {
    ownedServer = await waitForServer();
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false"
    });
    page = await browser.newPage();
    page.on("pageerror", (error) => browserErrors.push(safeError(error)));
    page.on("console", (message) => {
      const text = safeError(message.text());
      // The worker deliberately probes the locked assignment and a browser may
      // report its expected HTTP 403 navigation as a console resource error.
      if (message.type() === "error" && !/failed to load resource.*403/i.test(text)) {
        browserErrors.push(text);
      }
    });

    ledger.append("login.started", "STARTED", {
      reason: "UI_FORM",
      activityType: "AUTHENTICATION"
    });
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("email-input").fill(loginEmail);
    await page.getByTestId("password-input").fill(loginPassword);
    await page.getByTestId("login-submit").click();
    await page.waitForURL(`${baseUrl}/courses`);
    ledger.append("login.completed", "SUCCESS", {
      method: "UI_FORM",
      activityType: "AUTHENTICATION",
      reason: "SESSION_ESTABLISHED",
      browser: browser.version()
    });
    console.log("LOGIN\n  ✓ Signed in");
    await evidence.capture(page, "login-complete-courses", {
      activityType: "AUTHENTICATION",
      reason: "LOGIN_COMPLETE"
    });

    const courses = await discoverCourses(page);
    for (const course of courses) {
      ledger.append("course.discovered", "SUCCESS", {
        courseId: course.id,
        activityType: "COURSE",
        reason: "COURSE_DISCOVERED",
        title: course.title
      });
      for (const activity of course.activities) {
        ledger.append("activity.discovered", "SUCCESS", {
          courseId: course.id,
          activityId: activity.id,
          activityType: activity.type,
          reason: "ACTIVITY_DISCOVERED",
          title: activity.title
        });
      }
    }
    ledger.append("courses.discovered", "SUCCESS", {
      activityType: "COURSE_CATALOG",
      reason: "CATALOG_MATCHED_UI_AND_API",
      courseCount: courses.length,
      activityCount: courses.reduce(
        (count, course) => count + course.activities.length,
        0
      ),
      courses: courses.map((course) => ({
        id: course.id,
        title: course.title,
        activities: course.activities.map((activity) => ({
          id: activity.id,
          type: activity.type,
          title: activity.title
        }))
      }))
    });

    for (const course of courses) {
      const recording = course.activities.find(
        (activity) => activity.type === "MEETING_RECORDING"
      );
      const assignment = course.activities.find(
        (activity) => activity.type === "ASSIGNMENT"
      );

      if (!recording || !assignment) {
        throw new Error(`Course ${course.id} is missing required activities`);
      }

      console.log(`\nCOURSE: ${course.title}`);
      console.log("  ✓ Activities discovered");
      await probeLockedAssignment(page, assignment, course, ledger, evidence);
      console.log("  ✓ Assignment initially blocked");
      console.log("  ▶ Watching recording...");
      await watchRecording(page, recording, ledger, evidence, course);
      console.log("  ✓ Assignment eligible");
      await submitAssignment(page, assignment, course, recording.id, provider, ledger, evidence);
      console.log("  ✓ AI answers received");
      console.log("  ✓ Assignment submitted");
      console.log("  ✓ Evidence captured");
    }

    await page.goto(`${baseUrl}/courses`, { waitUntil: "domcontentloaded" });
    if (await page.locator('[data-testid="assignment-status"][data-state="SUBMITTED"]').count() !== courses.length) {
      throw new Error("College overview did not confirm every assignment submitted");
    }
    await evidence.capture(page, "all-courses-submitted", {
      activityType: "COURSE_CATALOG",
      reason: "ALL_ASSIGNMENTS_SUBMITTED"
    });

    if (browserErrors.length > 0) {
      throw new Error(`Browser reported ${browserErrors.length} client error(s)`);
    }

    const invariantErrors = checkRunInvariants(ledger.records);

    if (invariantErrors.length > 0) {
      throw new Error(`Run invariants failed: ${invariantErrors.join("; ")}`);
    }

    ledger.append("run.completed", "SUCCESS", {
      activityType: "RUN",
      reason: "ALL_COURSES_COMPLETE",
      invariantCheck: "PASS",
      courseCount: courses.length
    });
    console.log(`\nRUN COMPLETE\n  Status: SUCCESS\n  Ledger: ${ledger.filePath}\n  Evidence: ${path.resolve("evidence", runId)}`);

    return {
      runId,
      ledgerPath: ledger.filePath,
      evidenceDirectory: path.resolve("evidence", runId),
      provider: provider.name
    };
  } catch (error) {
    const failureCode = classifyFailure(error);
    const failureMessage = browserErrors.length > 0
      ? `${safeError(error)}: ${browserErrors.join(" | ")}`
      : safeError(error);
    if (typeof page !== "undefined") {
      try {
        await evidence.captureFailure(page, `failure-${failureCode.toLowerCase()}`, {
          failureCode,
          reason: safeError(error)
        });
      } catch {
        // Failure evidence is best effort and must not mask the root failure.
      }
    }
    ledger.append("run.failed", "FAILED", {
      activityType: "RUN",
      failureCode,
      error: failureMessage,
      invariantCheck: checkRunInvariants(ledger.records).length === 0 ? "PASS" : "FAIL"
    });
    console.error(`RUN FAILED [${failureCode}]: ${failureMessage}`);
    throw error;
  } finally {
    try {
      await browser?.close();
    } finally {
      await closeServer(ownedServer);
    }
  }
}

if (require.main === module) {
  runWorker()
    .then((result) => {
      console.log("✅ Playwright LMS worker completed");
      console.log(result);
    })
    .catch((error: unknown) => {
      console.error(`❌ Playwright LMS worker failed: ${safeError(error)}`);
      process.exitCode = 1;
    });
}
