import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { checkRunInvariants, RunLedger, type LedgerRecord } from "../worker/ledger";
import { answerEligibleAssignment } from "../worker/orchestrator/assignment";
import { assertSafeEvidence } from "../worker/artifacts";
import { classifyFailure } from "../worker/index";

function record(sequence: number, event: string, status: string, fields: Record<string, unknown> = {}): LedgerRecord {
  return {
    runId: "test-run", sequence,
    timestamp: new Date(sequence * 30_000).toISOString(),
    event, status, courseId: "course-econ", ...fields
  };
}

function validRun(): LedgerRecord[] {
  const assignment = { activityId: "assignment-econ", requiredRecordingId: "recording-econ" };
  return [
    record(1, "courses.discovered", "SUCCESS", { courses: [{ id: "course-econ" }] }),
    record(2, "assignment.blocked", "BLOCKED", { ...assignment, providerCalled: false }),
    record(3, "recording.started", "STARTED", { activityId: "recording-econ", durationSeconds: 24 }),
    record(4, "recording.completed", "SUCCESS", {
      activityId: "recording-econ", serverReportedComplete: true,
      contiguousSeconds: 23, completionPositionSeconds: 23
    }),
    record(5, "assignment.started", "STARTED", assignment),
    record(6, "ai.answers.completed", "SUCCESS", assignment),
    record(7, "assignment.submitted", "SUCCESS", { ...assignment, serverAccepted: true }),
    record(8, "run.completed", "SUCCESS")
  ];
}

const tempDirectories: string[] = [];
function testLedger() {
  const directory = fs.mkdtempSync(path.resolve("ledger", ".test-"));
  tempDirectories.push(directory);
  return new RunLedger("test-run", directory);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of tempDirectories.splice(0)) fs.rmSync(directory, { recursive: true });
});

describe("worker ordering invariants", () => {
  test("classifies failures without exposing provider credentials", () => {
    expect(classifyFailure(new Error("AI provider request failed with HTTP 503"))).toBe("AI_PROVIDER_FAILED");
    expect(classifyFailure(new Error("Assignment was not accepted by the server"))).toBe("ASSIGNMENT_SUBMIT_FAILED");
    expect(classifyFailure(new Error("College server never reported recording complete"))).toBe("RECORDING_FAILED");
    expect(classifyFailure(new Error("Assignment Locked"))).toBe("GATE_CLOSED");
  });

  test("accepts completion followed by answering and submission", () => {
    expect(checkRunInvariants(validRun())).toEqual([]);
  });

  test.each(["assignment.started", "ai.answers.completed", "assignment.submitted"])(
    "rejects %s without college completion", (event) => {
      expect(checkRunInvariants([record(1, event, "SUCCESS")]).length).toBeGreaterThan(0);
    }
  );

  test.each([false, undefined])("rejects unconfirmed completion (%s)", (confirmation) => {
    const records = validRun();
    records[3].serverReportedComplete = confirmation;
    expect(checkRunInvariants(records).length).toBeGreaterThan(0);
  });

  test("one course's completion cannot unlock another course", () => {
    const records = validRun();
    records[3].courseId = "course-business";
    expect(checkRunInvariants(records).length).toBeGreaterThan(0);
  });

  test("another recording's completion cannot unlock the assignment", () => {
    const records = validRun();
    records[3].activityId = "wrong-recording";
    expect(checkRunInvariants(records).length).toBeGreaterThan(0);
  });

  test("rejects fabricated instantaneous completion", () => {
    const records = validRun();
    records[3].timestamp = records[2].timestamp;
    expect(checkRunInvariants(records).length).toBeGreaterThan(0);
  });

  test("blocked attempts are never successes", () => {
    const records = validRun();
    records[1].status = "SUCCESS";
    expect(checkRunInvariants(records)).toContain("Blocked assignment event 2 has status SUCCESS");
  });

  test("requires provider answers and server acceptance before submission success", () => {
    const records = validRun();
    records[5].status = "FAILED";
    records[6].serverAccepted = false;
    expect(checkRunInvariants(records).length).toBeGreaterThan(0);
  });

  test("cannot mark a run complete with a discovered course unfinished", () => {
    const records = validRun();
    records[0].courses = [{ id: "course-econ" }, { id: "course-business" }];
    expect(checkRunInvariants(records)).toContain("Successful run is missing a submission for course-business");
  });

  test.each([false, true])("refusal prevents question extraction and AI work (eligible=%s)", async (eligible) => {
    const ledger = testLedger();
    const loadQuestions = vi.fn();
    const provider = { name: "spy", answerQuestions: vi.fn() };
    await expect(answerEligibleAssignment({
      courseId: "course-econ", activityId: "assignment-econ", requiredRecordingId: "recording-econ",
      eligibility: { eligible, reason: eligible ? "ELIGIBLE" : "RECORDING_INCOMPLETE" },
      loadQuestions, provider, ledger
    })).rejects.toThrow("Assignment refused");
    expect(loadQuestions).not.toHaveBeenCalled();
    expect(provider.answerQuestions).not.toHaveBeenCalled();
    const written = JSON.parse(fs.readFileSync(ledger.filePath, "utf8"));
    expect(written).toMatchObject({ event: "assignment.blocked", status: "REFUSED", providerCalled: false });
    expect(checkRunInvariants(ledger.records)).toEqual([]);
  });
});

describe("artifact credential exclusion", () => {
  test("rejects credential fields and redacts secrets even in error strings", () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-private-test-value");
    const ledger = testLedger();
    expect(() => ledger.append("run.failed", "FAILED", { nested: { apiKey: "test" } })).toThrow();
    ledger.append("run.failed", "FAILED", { error: "Error: synthetic-private-test-value" });
    const text = fs.readFileSync(ledger.filePath, "utf8");
    expect(text).not.toContain("synthetic-private-test-value");
    expect(text).toContain("[REDACTED]");
  });

  test("rejects login HTML and configured secrets before a screenshot can be captured", () => {
    vi.stubEnv("AI_API_KEY", "synthetic-evidence-test-value");
    expect(() => assertSafeEvidence('<input type="password" value="demo123">')).toThrow();
    expect(() => assertSafeEvidence("<p>synthetic-evidence-test-value</p>")).toThrow();
    expect(() => assertSafeEvidence("<h1>Assignment Submitted ✓</h1>")).not.toThrow();
  });

  test("ledger metadata cannot be overwritten by event fields", () => {
    const ledger = testLedger();
    const entry = ledger.append("assignment.blocked", "REFUSED", {
      event: "run.completed", status: "SUCCESS", sequence: 999, providerCalled: false
    });
    expect(entry).toMatchObject({ event: "assignment.blocked", status: "REFUSED", sequence: 1 });
  });
});
