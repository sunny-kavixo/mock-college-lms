import { db, initSchema } from "../college/db/db";
import { COURSE_CATALOG } from "./catalog";

export interface SeedCounts {
  users: number;
  courses: number;
  activities: number;
  questions: number;
  progress: number;
}

export function seedDatabase(): SeedCounts {
  initSchema();

  const seed = db.transaction(() => {
    db.exec(`
      DELETE FROM assignment_submissions;
      DELETE FROM recording_progress;
      DELETE FROM questions;
      DELETE FROM activities;
      DELETE FROM courses;
      DELETE FROM users;
    `);

    db.prepare(`
      INSERT INTO users (id, email, password, name)
      VALUES (?, ?, ?, ?)
    `).run(
      "user-demo",
      "student@mockcollege.local",
      "demo123",
      "Demo Student"
    );

    const insertCourse = db.prepare(`
      INSERT INTO courses (id, code, title, instructor, description)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertActivity = db.prepare(`
      INSERT INTO activities
        (id, course_id, type, title, duration_seconds, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertQuestion = db.prepare(`
      INSERT INTO questions
        (id, activity_id, type, prompt, options_json, expected_answer)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const course of COURSE_CATALOG) {
      insertCourse.run(
        course.id,
        course.code,
        course.title,
        course.instructor,
        course.description
      );
      insertActivity.run(
        course.recording.id,
        course.id,
        "MEETING_RECORDING",
        course.recording.title,
        course.recording.durationSeconds,
        1
      );
      insertActivity.run(
        course.assignment.id,
        course.id,
        "ASSIGNMENT",
        course.assignment.title,
        null,
        2
      );

      for (const question of course.assignment.questions) {
        insertQuestion.run(
          question.id,
          course.assignment.id,
          question.type,
          question.prompt,
          question.options ? JSON.stringify(question.options) : null,
          question.expectedAnswer
        );
      }
    }

    const now = new Date().toISOString();
    const insertProgress = db.prepare(`
      INSERT INTO recording_progress
        (
          user_id,
          activity_id,
          contiguous_seconds,
          last_position_seconds,
          watched_seconds,
          complete,
          updated_at
        )
      VALUES (?, ?, 0, 0, 0, 0, ?)
    `);

    for (const course of COURSE_CATALOG) {
      insertProgress.run("user-demo", course.recording.id, now);
    }
  });

  seed();

  const count = (table: string): number => {
    const result = db
      .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number };
    return result.count;
  };

  return {
    users: count("users"),
    courses: count("courses"),
    activities: count("activities"),
    questions: count("questions"),
    progress: count("recording_progress")
  };
}
