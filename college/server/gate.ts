import { db } from "../db/db";
import {
  evaluateRecordingHeartbeat,
  type RecordingGateState
} from "../../shared/gate-policy";

interface ActivityRow {
  id: string;
  course_id: string;
  type: "MEETING_RECORDING" | "ASSIGNMENT";
  duration_seconds: number | null;
}

interface ProgressRow {
  contiguous_seconds: number;
  last_position_seconds: number;
  watched_seconds: number;
  complete: number;
  updated_at: string;
}

export function processRecordingHeartbeat(params: {
  userId: string;
  activityId: string;
  positionSeconds: number;
  now?: Date;
}) {
  const {
    userId,
    activityId,
    positionSeconds,
    now = new Date()
  } = params;

  const activity = db
    .prepare(`
      SELECT id, course_id, type, duration_seconds
      FROM activities
      WHERE id = ?
    `)
    .get(activityId) as ActivityRow | undefined;

  if (!activity) {
    throw new Error("Activity not found");
  }

  if (
    activity.type !== "MEETING_RECORDING" ||
    activity.duration_seconds === null
  ) {
    throw new Error("Activity is not a recording");
  }

  const progress = db
    .prepare(`
      SELECT
        contiguous_seconds,
        last_position_seconds,
        watched_seconds,
        complete,
        updated_at
      FROM recording_progress
      WHERE user_id = ? AND activity_id = ?
    `)
    .get(userId, activityId) as ProgressRow | undefined;

  if (!progress) {
    throw new Error("Recording progress row not found");
  }

  const previous: RecordingGateState = {
    contiguousSeconds: progress.contiguous_seconds,
    lastPositionSeconds: progress.last_position_seconds,
    watchedSeconds: progress.watched_seconds,
    complete: Boolean(progress.complete),
    updatedAtMs: new Date(progress.updated_at).getTime()
  };

  const result = evaluateRecordingHeartbeat({
    durationSeconds: activity.duration_seconds,
    reportedPositionSeconds: positionSeconds,
    nowMs: now.getTime(),
    previous
  });

  db.prepare(`
    UPDATE recording_progress
    SET
      contiguous_seconds = ?,
      last_position_seconds = ?,
      watched_seconds = ?,
      complete = ?,
      updated_at = ?
    WHERE user_id = ? AND activity_id = ?
  `).run(
    result.contiguousSeconds,
    result.lastPositionSeconds,
    result.watchedSeconds,
    result.complete ? 1 : 0,
    now.toISOString(),
    userId,
    activityId
  );

  return {
    activityId,
    durationSeconds: activity.duration_seconds,
    positionSeconds: result.lastPositionSeconds,
    watchedSeconds: result.watchedSeconds,
    contiguousSeconds: result.contiguousSeconds,
    complete: result.complete,
    acceptedSeconds: result.acceptedSeconds,
    reason: result.reason
  };
}

export function getAssignmentEligibility(
  userId: string,
  assignmentId: string
): {
  eligible: boolean;
  reason: string;
} {
  const assignment = db
    .prepare(`
      SELECT id, course_id, type
      FROM activities
      WHERE id = ?
    `)
    .get(assignmentId) as ActivityRow | undefined;

  if (!assignment) {
    return {
      eligible: false,
      reason: "ASSIGNMENT_NOT_FOUND"
    };
  }

  if (assignment.type !== "ASSIGNMENT") {
    return {
      eligible: false,
      reason: "NOT_AN_ASSIGNMENT"
    };
  }

  const recording = db
    .prepare(`
      SELECT id
      FROM activities
      WHERE course_id = ?
        AND type = 'MEETING_RECORDING'
      ORDER BY sort_order ASC
      LIMIT 1
    `)
    .get(assignment.course_id) as { id: string } | undefined;

  if (!recording) {
    return {
      eligible: false,
      reason: "REQUIRED_RECORDING_NOT_FOUND"
    };
  }

  const progress = db
    .prepare(`
      SELECT complete
      FROM recording_progress
      WHERE user_id = ? AND activity_id = ?
    `)
    .get(userId, recording.id) as
      | { complete: number }
      | undefined;

  if (!progress || !Boolean(progress.complete)) {
    return {
      eligible: false,
      reason: "RECORDING_INCOMPLETE"
    };
  }

  return {
    eligible: true,
    reason: "ELIGIBLE"
  };
}
