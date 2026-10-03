import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data");
const configuredDbPath = process.env.DB_PATH;
const resolvedDbPath = configuredDbPath
  ? configuredDbPath === ":memory:"
    ? configuredDbPath
    : path.resolve(configuredDbPath)
  : path.join(dataDir, "mock-college.db");
export const DB_PATH = process.env.VITEST === "true"
  ? ":memory:"
  : resolvedDbPath;

if (DB_PATH !== ":memory:") {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY,
      code TEXT,
      title TEXT NOT NULL,
      instructor TEXT,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('MEETING_RECORDING', 'ASSIGNMENT')),
      title TEXT NOT NULL,
      duration_seconds INTEGER,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(course_id) REFERENCES courses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      activity_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('MULTIPLE_CHOICE', 'TEXT')),
      prompt TEXT NOT NULL,
      options_json TEXT,
      expected_answer TEXT NOT NULL,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recording_progress (
      user_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      contiguous_seconds REAL NOT NULL DEFAULT 0,
      last_position_seconds REAL NOT NULL DEFAULT 0,
      watched_seconds REAL NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, activity_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assignment_submissions (
      user_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('SUBMITTED')),
      answers_json TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      PRIMARY KEY(user_id, activity_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_activities_course
      ON activities(course_id, sort_order);

    CREATE INDEX IF NOT EXISTS idx_questions_activity
      ON questions(activity_id);
  `);

  const columns = db
    .pragma("table_info(courses)") as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  for (const [name, definition] of [
    ["code", "TEXT"],
    ["instructor", "TEXT"],
    ["description", "TEXT"]
  ] as const) {
    if (!existing.has(name)) {
      db.exec(`ALTER TABLE courses ADD COLUMN ${name} ${definition}`);
    }
  }
}
