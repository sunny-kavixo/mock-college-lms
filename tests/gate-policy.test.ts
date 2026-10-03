import { describe, expect, test } from "vitest";
import {
  evaluateRecordingHeartbeat,
  type RecordingGateState
} from "../shared/gate-policy";

function initialState(): RecordingGateState {
  return {
    contiguousSeconds: 0,
    lastPositionSeconds: 0,
    watchedSeconds: 0,
    complete: false,
    updatedAtMs: 0
  };
}

describe("recording completion gate", () => {
  test("rapid small heartbeats cannot manufacture elapsed watch time", () => {
    let state = initialState();
    for (let tick = 1; tick <= 240; tick++) {
      state = evaluateRecordingHeartbeat({
        durationSeconds: 24, reportedPositionSeconds: tick / 10, nowMs: 0, previous: state
      });
    }
    expect(state.complete).toBe(false);
    expect(state.watchedSeconds).toBe(0);
  });

  test("paused/repeated positions cannot accumulate progress", () => {
    let state = initialState();
    for (let second = 1; second <= 100; second++) {
      state = evaluateRecordingHeartbeat({
        durationSeconds: 24, reportedPositionSeconds: 0, nowMs: second * 1000, previous: state
      });
    }
    expect(state.watchedSeconds).toBe(0);
    expect(state.complete).toBe(false);
  });

  test.each([NaN, Infinity, -Infinity])("rejects invalid numerical positions: %s", (position) => {
    expect(() => evaluateRecordingHeartbeat({
      durationSeconds: 24, reportedPositionSeconds: position, nowMs: 1000, previous: initialState()
    })).toThrow("Reported position must be finite");
  });

  test("seeking directly to the end does not complete the recording", () => {
    const result = evaluateRecordingHeartbeat({
      durationSeconds: 24,
      reportedPositionSeconds: 24,
      nowMs: 1000,
      previous: initialState()
    });

    expect(result.complete).toBe(false);
    expect(result.acceptedSeconds).toBe(0);
    expect(result.reason).toBe("LARGE_JUMP_REJECTED");
  });

  test("normal sequential playback eventually completes", () => {
    let state = initialState();

    for (let second = 1; second <= 24; second++) {
      const result = evaluateRecordingHeartbeat({
        durationSeconds: 24,
        reportedPositionSeconds: second,
        nowMs: second * 1000,
        previous: state
      });

      state = {
        contiguousSeconds: result.contiguousSeconds,
        lastPositionSeconds: result.lastPositionSeconds,
        watchedSeconds: result.watchedSeconds,
        complete: result.complete,
        updatedAtMs: result.updatedAtMs
      };
    }

    expect(state.complete).toBe(true);
    expect(state.watchedSeconds).toBeGreaterThanOrEqual(21.6);
  });

  test("a large seek breaks the continuous watch streak", () => {
    let state: RecordingGateState = {
      contiguousSeconds: 8,
      lastPositionSeconds: 8,
      watchedSeconds: 8,
      complete: false,
      updatedAtMs: 8000
    };

    const result = evaluateRecordingHeartbeat({
      durationSeconds: 24,
      reportedPositionSeconds: 22,
      nowMs: 9000,
      previous: state
    });

    expect(result.complete).toBe(false);
    expect(result.contiguousSeconds).toBe(0);
    expect(result.reason).toBe("LARGE_JUMP_REJECTED");
  });
});
