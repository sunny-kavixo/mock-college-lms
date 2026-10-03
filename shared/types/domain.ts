export type ActivityType = "MEETING_RECORDING" | "ASSIGNMENT";
export type AssignmentState = "LOCKED" | "OPEN" | "SUBMITTED";
export type QuestionType = "MULTIPLE_CHOICE" | "TEXT";

export interface Course {
  id: string;
  title: string;
}

export interface Activity {
  id: string;
  courseId: string;
  type: ActivityType;
  title: string;
  durationSeconds: number | null;
  sortOrder: number;
}

export interface RecordingProgress {
  userId: string;
  activityId: string;
  contiguousSeconds: number;
  lastPositionSeconds: number;
  watchedSeconds: number;
  complete: boolean;
  updatedAt: string;
}
