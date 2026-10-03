import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../college/db/db";
import { COURSE_CATALOG } from "../demo/catalog";
import { seedDatabase } from "../demo/seed-data";

describe("seeded course catalog", () => {
  beforeEach(() => {
    seedDatabase();
  });

  test("seeds every catalog course with one recording and one assignment", () => {
    const courses = db
      .prepare("SELECT id, code, instructor FROM courses ORDER BY id")
      .all() as Array<{ id: string; code: string; instructor: string }>;
    expect(courses).toHaveLength(COURSE_CATALOG.length);

    for (const catalogCourse of COURSE_CATALOG) {
      const course = courses.find((item) => item.id === catalogCourse.id);
      expect(course).toMatchObject({
        id: catalogCourse.id,
        code: catalogCourse.code,
        instructor: catalogCourse.instructor
      });
      const activities = db
        .prepare("SELECT id, type FROM activities WHERE course_id = ? ORDER BY sort_order")
        .all(catalogCourse.id) as Array<{ id: string; type: string }>;
      expect(activities).toEqual([
        { id: catalogCourse.recording.id, type: "MEETING_RECORDING" },
        { id: catalogCourse.assignment.id, type: "ASSIGNMENT" }
      ]);
      const questions = db
        .prepare("SELECT type FROM questions WHERE activity_id = ? ORDER BY id")
        .all(catalogCourse.assignment.id) as Array<{ type: string }>;
      expect(questions).toHaveLength(4);
      expect(questions.filter((question) => question.type === "MULTIPLE_CHOICE")).toHaveLength(2);
      expect(questions.filter((question) => question.type === "TEXT")).toHaveLength(2);
    }
  });
});
