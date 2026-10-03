import type { FastifyInstance } from "fastify";
import { eq, sql } from "drizzle-orm";
import { updateSettingsSchema, type Settings } from "@flashcards/shared";
import { userCards, users } from "../db/schema.js";
import type { Db } from "../db/types.js";
import { DAY_ROLLOVER_HOUR } from "../study/day.js";

export async function settingsRoutes(app: FastifyInstance, { db }: { db: Db }) {
  const read = async (userId: string): Promise<Settings> => {
    const [u] = await db
      .select({
        email: users.email,
        name: users.name,
        timezone: users.timezone,
        dailyNewCardLimit: users.dailyNewCardLimit,
        showSentences: users.showSentences,
        showForms: users.showForms,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (!u) throw new Error("User not found");
    return u;
  };

  app.get("/settings", { preHandler: app.requireAuth }, async (req) => read(req.user!.id));

  // Changes the name, the daily new-card limit, the time zone and/or what the study cards show. A new time zone moves the study
  // day, so review cards (which come due at the start of a study day) are moved to the start
  // of the same calendar day in the new zone rather than left at the old zone's 04:00.
  app.patch("/settings", { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = updateSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid input", issues: parsed.error.issues });
    }
    const userId = req.user!.id;
    const { name, timezone, dailyNewCardLimit, showSentences, showForms } = parsed.data;

    await db.transaction(async (tx) => {
      const [current] = await tx.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
      await tx
        .update(users)
        .set({
          ...(name !== undefined ? { name: name || null } : {}),
          ...(timezone !== undefined ? { timezone } : {}),
          ...(dailyNewCardLimit !== undefined ? { dailyNewCardLimit } : {}),
          ...(showSentences !== undefined ? { showSentences } : {}),
          ...(showForms !== undefined ? { showForms } : {}),
        })
        .where(eq(users.id, userId));

      if (timezone !== undefined && current && timezone !== current.timezone) {
        const rollover = sql`make_interval(hours => ${DAY_ROLLOVER_HOUR}::int)`;
        // The study day a card is due on, read in the old zone, then its start in the new one.
        await tx.execute(sql`
          update ${userCards}
          set due_at = (
            (date_trunc('day', (due_at at time zone ${current.timezone}) - ${rollover}) + ${rollover})
            at time zone ${timezone}
          )
          where user_id = ${userId} and state = 'review'
        `);
      }
    });

    return read(userId);
  });
}
