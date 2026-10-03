import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "./artifacts";

export interface LedgerRecord {
  runId: string;
  sequence: number;
  timestamp: string;
  event: string;
  status: string;
  [key: string]: unknown;
}

const forbiddenKeyPattern = /(password|secret|api[_-]?key|authorization|token|cookie)/i;

function assertNoSecrets(value: unknown, location = "record"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${location}[${index}]`));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeyPattern.test(key)) {
      throw new Error(`Refusing to write secret-like ledger field ${location}.${key}`);
    }

    assertNoSecrets(child, `${location}.${key}`);
  }
}

export class RunLedger {
  readonly filePath: string;
  readonly records: LedgerRecord[] = [];
  private nextSequence = 1;

  constructor(readonly runId: string, directory = path.resolve("ledger")) {
    fs.mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, `${runId}.jsonl`);
    fs.writeFileSync(this.filePath, "", { encoding: "utf8", flag: "wx" });
  }

  append(
    event: string,
    status: string,
    fields: Record<string, unknown> = {}
  ): LedgerRecord {
    const record: LedgerRecord = {
      ...fields,
      runId: this.runId,
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
      event,
      status
    };

    assertNoSecrets(record);
    const sanitized = JSON.parse(JSON.stringify(record, (_key, value) =>
      typeof value === "string" ? redactSecrets(value) : value
    )) as LedgerRecord;
    fs.appendFileSync(this.filePath, `${JSON.stringify(sanitized)}\n`, "utf8");
    this.records.push(sanitized);
    this.nextSequence += 1;
    return sanitized;
  }
}

function priorRecord(
  records: LedgerRecord[],
  courseId: string,
  event: string,
  sequence: number
): LedgerRecord | undefined {
  return records.find(
    (record) =>
      record.courseId === courseId &&
      record.event === event &&
      record.sequence < sequence
  );
}

export function checkRunInvariants(records: LedgerRecord[]): string[] {
  const errors: string[] = [];

  for (const [index, record] of records.entries()) {
    if (
      record.sequence !== index + 1 ||
      record.runId !== records[0].runId ||
      !Number.isFinite(Date.parse(record.timestamp)) ||
      (index > 0 && Date.parse(record.timestamp) < Date.parse(records[index - 1].timestamp))
    ) {
      errors.push(`Invalid ledger ordering at event ${index + 1}`);
    }

    if (record.event === "recording.completed") {
      const started = records.find((entry) =>
        entry.event === "recording.started" && entry.courseId === record.courseId &&
        entry.activityId === record.activityId && entry.sequence < record.sequence
      );
      const duration = Number(started?.durationSeconds);
      if (
        !started || !(duration > 0) || record.status !== "SUCCESS" ||
        record.serverReportedComplete !== true ||
        !(Number(record.contiguousSeconds) >= duration * 0.9) ||
        !(Number(record.completionPositionSeconds) >= duration) ||
        Date.parse(record.timestamp) - Date.parse(started.timestamp) < duration * 900
      ) {
        errors.push(`Invalid server completion evidence for ${record.activityId}`);
      }
    }

    if (record.event === "assignment.blocked") {
      if (record.status !== "BLOCKED" && record.status !== "REFUSED") {
        errors.push(
          `Blocked assignment event ${record.sequence} has status ${record.status}`
        );
      }

      if (record.providerCalled !== false) {
        errors.push(
          `Blocked assignment event ${record.sequence} called the AI provider`
        );
      }
    }

    if (
      record.event === "assignment.started" || record.event === "ai.answers.completed" ||
      record.event === "assignment.submitted"
    ) {
      const courseId = String(record.courseId || "");
      const completion = priorRecord(
        records,
        courseId,
        "recording.completed",
        record.sequence
      );

      if (
        !completion || completion.serverReportedComplete !== true ||
        completion.status !== "SUCCESS" ||
        completion.activityId !== record.requiredRecordingId
      ) {
        errors.push(
          `${record.event} for ${courseId} occurred before server-confirmed recording completion`
        );
      }
    }

    if (record.event === "assignment.submitted") {
      const courseId = String(record.courseId || "");
      const started = priorRecord(
        records,
        courseId,
        "assignment.started",
        record.sequence
      );

      if (!started || started.activityId !== record.activityId) {
        errors.push(`Assignment submission for ${courseId} had no start event`);
      }
      const answered = priorRecord(records, courseId, "ai.answers.completed", record.sequence);
      if (
        !answered || answered.activityId !== record.activityId ||
        answered.status !== "SUCCESS" || answered.sequence <= (started?.sequence ?? 0) ||
        record.serverAccepted !== true || record.status !== "SUCCESS"
      ) {
        errors.push(`Assignment submission for ${courseId} lacks successful answers or server acceptance`);
      }
    }

    if (record.event === "run.completed") {
      const discovery = records.find((entry) => entry.event === "courses.discovered");
      const courses = discovery?.courses as Array<{ id: string }> | undefined;
      if (!courses?.length || record.status !== "SUCCESS") {
        errors.push("Successful run requires discovered courses");
      }
      for (const course of courses ?? []) {
        if (!priorRecord(records, course.id, "assignment.submitted", record.sequence)) {
          errors.push(`Successful run is missing a submission for ${course.id}`);
        }
      }
    }
  }

  return errors;
}
