export interface RecordingGateState {
  contiguousSeconds: number;
  lastPositionSeconds: number;
  watchedSeconds: number;
  complete: boolean;
  updatedAtMs: number;
}

export interface RecordingGateResult extends RecordingGateState {
  acceptedSeconds: number;
  sequential: boolean;
  reason:
    | "SEQUENTIAL_PROGRESS"
    | "NO_PROGRESS"
    | "LARGE_JUMP_REJECTED"
    | "ALREADY_COMPLETE";
}

export function evaluateRecordingHeartbeat(params: {
  durationSeconds: number;
  reportedPositionSeconds: number;
  nowMs: number;
  previous: RecordingGateState;
}): RecordingGateResult {
  const {
    durationSeconds,
    reportedPositionSeconds,
    nowMs,
    previous
  } = params;

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Recording duration must be positive");
  }

  if (!Number.isFinite(reportedPositionSeconds)) {
    throw new Error("Reported position must be finite");
  }

  if (!Number.isFinite(nowMs)) {
    throw new Error("Heartbeat time must be finite");
  }

  if (previous.complete) {
    return {
      ...previous,
      updatedAtMs: nowMs,
      acceptedSeconds: 0,
      sequential: true,
      reason: "ALREADY_COMPLETE"
    };
  }

  const position = Math.max(
    0,
    Math.min(reportedPositionSeconds, durationSeconds)
  );

  const elapsedSeconds = Math.max(
    0,
    (nowMs - previous.updatedAtMs) / 1000
  );

  const positionDelta =
    position - previous.lastPositionSeconds;

  // Allow normal playback jitter, but reject large seeks.
  // A normal 1x playback heartbeat should move only a small amount.
  const maxForwardJump = Math.min(
    3,
    Math.max(2.5, elapsedSeconds + 0.75)
  );

  const sequential =
    positionDelta >= -0.5 &&
    positionDelta <= maxForwardJump;

  let acceptedSeconds = 0;
  let contiguousSeconds = previous.contiguousSeconds;

  if (sequential) {
    // Never trust the browser's position delta by itself.
    // Count at most the amount justified by server-observed elapsed time.
    acceptedSeconds = Math.max(
      0,
      Math.min(
        positionDelta,
        elapsedSeconds,
        2.5
      )
    );

    contiguousSeconds += acceptedSeconds;
  } else {
    // Large seek/jump breaks the continuous watch streak.
    contiguousSeconds = 0;
  }

  const watchedSeconds = Math.min(
    durationSeconds,
    previous.watchedSeconds + acceptedSeconds
  );

  // Require both:
  // 1. roughly 90% continuous valid playback
  // 2. playback position close to the real end
  const complete =
    contiguousSeconds >= durationSeconds * 0.9 &&
    position >= durationSeconds - 1;

  let reason: RecordingGateResult["reason"];

  if (!sequential) {
    reason = "LARGE_JUMP_REJECTED";
  } else if (acceptedSeconds === 0) {
    reason = "NO_PROGRESS";
  } else {
    reason = "SEQUENTIAL_PROGRESS";
  }

  return {
    contiguousSeconds,
    lastPositionSeconds: position,
    watchedSeconds,
    complete,
    updatedAtMs: nowMs,
    acceptedSeconds,
    sequential,
    reason
  };
}
