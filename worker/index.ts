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
  capture(page: Page, name: string): Promise<void>;
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

  return {
    async capture(page, name) {
      const baseName = slug(name);
      const html = await page.content();

      assertSafeEvidence(html);

      await page.screenshot({
        path: path.join(directory, `${baseName}.png`),
        fullPage: true
      });
      fs.writeFileSync(
        path.join(directory, `${baseName}.html`),
        html,
        "utf8"
      );
      ledger.append("evidence.captured", "SUCCESS", {
        files: ["png", "html"].map((extension) =>
          `evidence/${runId}/${baseName}.${extension}`
        )
      });
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
  const uiCourseTitles = await page.locator(".grid > .card h2").allTextContents();
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
  return page.locator("form .card").evaluateAll((cards) =>
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
  await evidence.capture(page, `${course.id}-recording-start`);
  ledger.append("recording.started", "STARTED", {
    courseId: course.id,
    activityId: recording.id,
    durationSeconds: recording.duration_seconds
  });

  const heartbeats: HeartbeatResponse[] = [];
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
        ledger.append("recording.heartbeat", "OBSERVED", {
          courseId: course.id,
          activityId: recording.id,
          serverResponse: body
        });
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

  await evidence.capture(page, `${course.id}-recording-complete`);
  ledger.append("recording.completed", "SUCCESS", {
    courseId: course.id,
    activityId: recording.id,
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

  if (blockedStatus !== 403 || !(await page.getByText("Assignment Locked").count())) {
    throw new Error(`Assignment ${assignment.id} was not blocked before recording completion`);
  }

  const submission = await page.request.post(
    `${baseUrl}/assignments/${encodeURIComponent(assignment.id)}/submit`,
    { form: {} }
  );
  if (submission.status() !== 403) {
    throw new Error("College accepted a submission while the recording gate was closed");
  }

  await evidence.capture(page, `${course.id}-assignment-blocked`);
  ledger.append("assignment.blocked", "BLOCKED", {
    courseId: course.id,
    activityId: assignment.id,
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
        ledger.append("assignment.blocked", "REFUSED", {
          courseId: course.id, activityId: assignment.id,
          providerCalled: false, httpStatus: response?.status()
        });
        throw new Error("College refused assignment access");
      }
      await evidence.capture(page, `${course.id}-assignment-questions`);
      return extractQuestions(page);
    }
  });
  await fillAnswers(page, answers);

  const [submissionResponse] = await Promise.all([
    page.waitForResponse((response) =>
      response.url() === `${baseUrl}/assignments/${encodeURIComponent(assignment.id)}/submit` &&
      response.request().method() === "POST"
    ),
    page.getByRole("button", { name: "Submit assignment" }).click()
  ]);
  if (!submissionResponse.ok()) {
    if (submissionResponse.status() === 403) {
      ledger.append("assignment.blocked", "REFUSED", {
        courseId: course.id, activityId: assignment.id, providerCalled: true,
        phase: "submission", httpStatus: 403
      });
    }
    throw new Error(`Assignment ${assignment.id} was not accepted by the server`);
  }
  await page.getByRole("heading", { name: "Assignment Submitted ✓" }).waitFor();

  await evidence.capture(page, `${course.id}-assignment-submitted`);
  ledger.append("assignment.submitted", "SUCCESS", {
    courseId: course.id,
    activityId: assignment.id,
    requiredRecordingId,
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

  ledger.append("run.started", "STARTED", {
    collegeOrigin: new URL(baseUrl).origin,
    automation: "playwright",
    provider: provider.name
  });

  try {
    ownedServer = await waitForServer();
    browser = await chromium.launch({
      headless: process.env.HEADLESS !== "false"
    });
    const page = await browser.newPage();

    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill(loginEmail);
    await page.getByLabel("Password").fill(loginPassword);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(`${baseUrl}/courses`);
    ledger.append("login.completed", "SUCCESS", { method: "UI_FORM", browser: browser.version() });
    await evidence.capture(page, "login-complete-courses");

    const courses = await discoverCourses(page);
    ledger.append("courses.discovered", "SUCCESS", {
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

      await probeLockedAssignment(page, assignment, course, ledger, evidence);
      await watchRecording(page, recording, ledger, evidence, course);
      await submitAssignment(page, assignment, course, recording.id, provider, ledger, evidence);
    }

    await page.goto(`${baseUrl}/courses`, { waitUntil: "domcontentloaded" });
    if (await page.locator(".status.submitted").count() !== courses.length) {
      throw new Error("College overview did not confirm every assignment submitted");
    }
    await evidence.capture(page, "all-courses-submitted");

    const invariantErrors = checkRunInvariants(ledger.records);

    if (invariantErrors.length > 0) {
      throw new Error(`Run invariants failed: ${invariantErrors.join("; ")}`);
    }

    ledger.append("run.completed", "SUCCESS", {
      invariantCheck: "PASS",
      courseCount: courses.length
    });

    return {
      runId,
      ledgerPath: ledger.filePath,
      evidenceDirectory: path.resolve("evidence", runId),
      provider: provider.name
    };
  } catch (error) {
    ledger.append("run.failed", "FAILED", {
      error: safeError(error),
      invariantCheck: checkRunInvariants(ledger.records).length === 0 ? "PASS" : "FAIL"
    });
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
