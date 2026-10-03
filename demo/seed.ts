import { db, DB_PATH } from "../college/db/db";
import { seedDatabase } from "./seed-data";

const counts = seedDatabase();

console.log("✅ Mock College database seeded");
console.log("DB:", DB_PATH);
console.log("Demo login: student@mockcollege.local / demo123");
console.log(counts);

db.close();
