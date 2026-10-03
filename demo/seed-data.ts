import { db, initSchema } from "../college/db/db";

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
      INSERT INTO courses (id, title)
      VALUES (?, ?)
    `);

    insertCourse.run("course-econ", "Introduction to Economics");
    insertCourse.run("course-business", "Business Fundamentals");

    const insertActivity = db.prepare(`
      INSERT INTO activities
        (id, course_id, type, title, duration_seconds, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertActivity.run(
      "recording-econ",
      "course-econ",
      "MEETING_RECORDING",
      "Economics Meeting Recording",
      24,
      1
    );

    insertActivity.run(
      "assignment-econ",
      "course-econ",
      "ASSIGNMENT",
      "Economics Assignment",
      null,
      2
    );

    insertActivity.run(
      "recording-business",
      "course-business",
      "MEETING_RECORDING",
      "Business Fundamentals Meeting Recording",
      28,
      1
    );

    insertActivity.run(
      "assignment-business",
      "course-business",
      "ASSIGNMENT",
      "Business Fundamentals Assignment",
      null,
      2
    );

    const insertQuestion = db.prepare(`
      INSERT INTO questions
        (id, activity_id, type, prompt, options_json, expected_answer)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertQuestion.run(
      "q-econ-1",
      "assignment-econ",
      "MULTIPLE_CHOICE",
      "Which concept describes the next best alternative given up when making a choice?",
      JSON.stringify([
        "Opportunity cost",
        "Inflation",
        "Revenue",
        "Demand"
      ]),
      "Opportunity cost"
    );

    insertQuestion.run(
      "q-econ-2",
      "assignment-econ",
      "TEXT",
      "In one sentence, explain scarcity.",
      null,
      "Scarcity means limited resources are available to satisfy unlimited wants."
    );

    insertQuestion.run(
      "q-business-1",
      "assignment-business",
      "MULTIPLE_CHOICE",
      "Which statement best describes revenue?",
      JSON.stringify([
        "Money earned from sales before expenses",
        "Profit after tax only",
        "The cost of employees",
        "A company's debt"
      ]),
      "Money earned from sales before expenses"
    );

    insertQuestion.run(
      "q-business-2",
      "assignment-business",
      "TEXT",
      "In one sentence, explain why businesses track costs.",
      null,
      "Businesses track costs to understand spending and measure profitability."
    );

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

    insertProgress.run("user-demo", "recording-econ", now);
    insertProgress.run("user-demo", "recording-business", now);
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
