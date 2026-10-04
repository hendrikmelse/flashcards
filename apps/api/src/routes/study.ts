import type { FastifyInstance, FastifyReply } from "fastify";
import {
  pairQuerySchema,
  studyQuerySchema,
  submitReviewSchema,
} from "@flashcards/shared";
import type { Scheduler } from "../srs/engine.js";
import type { Db } from "../db/types.js";
import { getStudyBatch, getStudyCounts } from "../study/queue.js";
import { submitReview } from "../study/review.js";

const invalid = (reply: FastifyReply, issues: unknown) =>
  reply.code(400).send({ error: "Invalid input", issues });

export async function studyRoutes(
  app: FastifyInstance,
  { db, scheduler }: { db: Db; scheduler: Scheduler },
) {
  // Read-only: the next batch of cards to study. Safe to call repeatedly;
  // unanswered cards simply come back.
  app.get("/study", { preHandler: app.requireAuth }, async (req, reply) => {
    const d = pairQuerySchema.safeParse(req.query);
    const l = studyQuerySchema.safeParse(req.query);
    if (!d.success) return invalid(reply, d.error.issues);
    if (!l.success) return invalid(reply, l.error.issues);

    return getStudyBatch(
      db,
      req.user!.id,
      { limit: l.data.limit, early: l.data.early === "1", ...d.data },
      new Date(),
      scheduler,
    );
  });

  // Just the counts, for the dashboard: no cards are ranked or loaded.
  app.get("/study/counts", { preHandler: app.requireAuth }, async (req, reply) => {
    const d = pairQuerySchema.safeParse(req.query);
    if (!d.success) return invalid(reply, d.error.issues);
    return getStudyCounts(db, req.user!.id, d.data, new Date());
  });

  app.post("/reviews", { preHandler: app.requireAuth }, async (req, reply) => {
    const body = submitReviewSchema.safeParse(req.body);
    if (!body.success) return invalid(reply, body.error.issues);

    const outcome = await submitReview(db, scheduler, req.user!.id, body.data, new Date());
    switch (outcome.kind) {
      case "not_found":
        return reply.code(404).send({ error: "Card not found" });
      case "conflict":
        return reply
          .code(409)
          .send({ error: "clientReviewId was already used for a different card" });
      case "ok":
        return outcome.result;
    }
  });
}
