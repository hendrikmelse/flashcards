import { eq } from "drizzle-orm";
import { USER_ROLES, type UserRole } from "@flashcards/shared";
import { db, sql } from "./client.js";
import { users } from "./schema.js";

// Sets an account's type. Accounts are users unless made admins here; the app never changes it.
//   npm run user-role -w @flashcards/api -- <email> <user|admin>
const [email, role] = process.argv.slice(2);

if (!email || !role || !(USER_ROLES as readonly string[]).includes(role)) {
  console.error(`Usage: user-role <email> <${USER_ROLES.join("|")}>`);
  process.exitCode = 1;
} else {
  const updated = await db
    .update(users)
    .set({ role: role as UserRole })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ email: users.email, role: users.role });
  if (updated.length === 0) {
    console.error(`No account with the email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${updated[0]!.email} is now ${updated[0]!.role}`);
  }
}

await sql.end();
