import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { db, DB_PATH } from "../college/db/db";
import { app, getDemoStatusSnapshot } from "../college/server/index";
import {
  getAssignmentEligibility,
  processRecordingHeartbeat
} from "../college/server/gate";
import { seedDatabase } from "../demo/seed-data";

describe("server recording gate", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    expect(DB_PATH).toBe(":memory:");
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  });

  beforeEach(() => {
    seedDatabase();
  });

  async function login() {
    const response = await fetch(`${origin}/login`, {
      method: "POST", body: new URLSearchParams({ email: "student@mockcollege.local", password: "demo123" }),
      redirect: "manual"
    });
    expect(response.status).toBe(302);
    return response.headers.get("set-cookie")!.split(";")[0];
  }

  test.each(["econ", "business"])("blocks direct assignment GET and POST before completion for %s", async (course) => {
    const cookie = await login();
    const assignment = `${origin}/assignments/assignment-${course}`;
    expect((await fetch(assignment, { headers: { cookie } })).status).toBe(403);
    const post = await fetch(`${assignment}/submit`, {
      method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: "{}"
    });
    expect(post.status).toBe(403);
    expect(await post.json()).toMatchObject({ error: "ASSIGNMENT_BLOCKED", reason: "RECORDING_INCOMPLETE" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM assignment_submissions").get()).toEqual({ count: 0 });
  });

  test("server ignores client claims of completion", async () => {
    const cookie = await login();
    const response = await fetch(`${origin}/api/recordings/recording-econ/heartbeat`, {
      method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ positionSeconds: 24, complete: true, watchedSeconds: 24 })
    });
    expect(await response.json()).toMatchObject({ complete: false, reason: "LARGE_JUMP_REJECTED" });
    expect(getAssignmentEligibility("user-demo", "assignment-econ").eligible).toBe(false);
  });

  test("dashboard and reviewer status expose stable, secret-safe state", async () => {
    const cookie = await login();
    const courses = await fetch(`${origin}/courses`, { headers: { cookie } });
    const coursesHtml = await courses.text();
    expect(courses.status).toBe(200);
    expect(coursesHtml).toContain('data-testid="course-grid"');
    expect(coursesHtml).toContain('data-testid="assignment-status"');
    expect(coursesHtml).toContain('data-state="LOCKED"');
    expect(coursesHtml).not.toContain("mockCollegeSession");

    const status = await fetch(`${origin}/demo-status`, { headers: { cookie } });
    const statusHtml = await status.text();
    expect(status.status).toBe(200);
    expect(statusHtml).toContain('data-testid="demo-status"');
    expect(statusHtml).toContain("Run visibility");
    expect(statusHtml).not.toContain("demo123");
    expect(getDemoStatusSnapshot("user-demo").courses).toHaveLength(4);
  });

  test("healthz is public and does not expose application state", async () => {
    const response = await fetch(`${origin}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "mock-college-lms"
    });
  });

  test("keeps an assignment locked until the recording is complete", () => {
    expect(
      getAssignmentEligibility("user-demo", "assignment-econ")
    ).toEqual({
      eligible: false,
      reason: "RECORDING_INCOMPLETE"
    });

    const result = processRecordingHeartbeat({
      userId: "user-demo",
      activityId: "recording-econ",
      positionSeconds: 24,
      now: new Date(Date.now() + 1000)
    });

    expect(result.complete).toBe(false);
    expect(
      getAssignmentEligibility("user-demo", "assignment-econ").eligible
    ).toBe(false);
  });

  test("unlocks the assignment after valid sequential heartbeats", () => {
    const start = Date.now() + 1000;
    let latest: ReturnType<typeof processRecordingHeartbeat> | undefined;

    for (let second = 1; second <= 24; second += 1) {
      latest = processRecordingHeartbeat({
        userId: "user-demo",
        activityId: "recording-econ",
        positionSeconds: second,
        now: new Date(start + second * 1000)
      });
    }

    expect(latest?.complete).toBe(true);
    expect(getAssignmentEligibility("user-demo", "assignment-business").eligible).toBe(false);
    expect(getAssignmentEligibility("other-user", "assignment-econ").eligible).toBe(false);
    expect(
      getAssignmentEligibility("user-demo", "assignment-econ")
    ).toEqual({
      eligible: true,
      reason: "ELIGIBLE"
    });
  });

  test("keeps the 28-second course locked at 27/28 and opens at 28/28", () => {
    const start = Date.now() + 1000;
    let latest: ReturnType<typeof processRecordingHeartbeat> | undefined;
    for (let second = 1; second <= 27; second += 1) {
      latest = processRecordingHeartbeat({
        userId: "user-demo",
        activityId: "recording-business",
        positionSeconds: second,
        now: new Date(start + second * 1000)
      });
    }
    expect(latest?.positionSeconds).toBe(27);
    expect(latest?.complete).toBe(false);
    expect(getAssignmentEligibility("user-demo", "assignment-business").eligible).toBe(false);

    latest = processRecordingHeartbeat({
      userId: "user-demo",
      activityId: "recording-business",
      positionSeconds: 28,
      now: new Date(start + 28 * 1000)
    });
    expect(latest.positionSeconds).toBe(28);
    expect(latest.complete).toBe(true);
    expect(getAssignmentEligibility("user-demo", "assignment-business").eligible).toBe(true);
  });

  test("rejects a heartbeat for a missing progress row", () => {
    expect(() =>
      processRecordingHeartbeat({
        userId: "missing-user",
        activityId: "recording-econ",
        positionSeconds: 1
      })
    ).toThrow("Recording progress row not found");

    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM assignment_submissions"
        )
        .get()
    ).toEqual({ count: 0 });
  });
});
