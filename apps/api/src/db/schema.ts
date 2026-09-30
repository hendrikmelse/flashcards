import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const cardStateEnum = pgEnum("card_state", [
  "new",
  "learning",
  "review",
  "relearning",
]);
export const ratingEnum = pgEnum("rating", ["again", "hard", "good", "easy"]);

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  timezone: text().notNull().default("UTC"),
  dailyNewCardLimit: integer().notNull().default(20),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: text().primaryKey(), // hash of the session token
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------------------
// Shared content (public, curated, identical for every user)
//
// Hub model: each language's words (entries) point at a language-independent
// concept (a word sense). Any language pair is derived by following the
// concept: the English entry for a concept is the prompt, the Dutch entry is
// the answer, or vice versa. Adding a language is data, not schema.
// ---------------------------------------------------------------------------

export const languages = pgTable("languages", {
  code: text().primaryKey(), // BCP 47, e.g. "en", "nl"
  name: text().notNull(),
});

export const concepts = pgTable("concepts", {
  id: uuid().primaryKey().defaultRandom(),
  // Short human-readable description of the sense, for curators,
  // e.g. "run (move fast on foot)". Not shown to learners.
  gloss: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const entries = pgTable(
  "entries",
  {
    id: uuid().primaryKey().defaultRandom(),
    conceptId: uuid()
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    language: text()
      .notNull()
      .references(() => languages.code),
    lemma: text().notNull(),
    partOfSpeech: text(),
    // Language-specific extras: Dutch article/plural, Japanese reading, etc.
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Pronunciation hint or audio URL, etc. can go in details for now.
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("entries_concept_language_lemma_uq").on(
      t.conceptId,
      t.language,
      t.lemma,
    ),
    index("entries_concept_idx").on(t.conceptId),
    index("entries_language_lemma_idx").on(t.language, t.lemma),
  ],
);

export const sentences = pgTable(
  "sentences",
  {
    id: uuid().primaryKey().defaultRandom(),
    language: text()
      .notNull()
      .references(() => languages.code),
    text: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sentences_language_idx").on(t.language)],
);

// Which example sentences illustrate which entry.
export const entrySentences = pgTable(
  "entry_sentences",
  {
    entryId: uuid()
      .notNull()
      .references(() => entries.id, { onDelete: "cascade" }),
    sentenceId: uuid()
      .notNull()
      .references(() => sentences.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.sentenceId] })],
);

// A pack is a curated, language-agnostic list of concepts (e.g. "Top 1000",
// "Food"). The user chooses the direction (from -> to) when adding it.
export const packs = pgTable("packs", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  description: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const packConcepts = pgTable(
  "pack_concepts",
  {
    packId: uuid()
      .notNull()
      .references(() => packs.id, { onDelete: "cascade" }),
    conceptId: uuid()
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    position: integer().notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.packId, t.conceptId] }),
    index("pack_concepts_concept_idx").on(t.conceptId),
  ],
);

// ---------------------------------------------------------------------------
// Per-user learning state
// ---------------------------------------------------------------------------

// A user's card: one concept studied in one direction. The user's "active
// deck" is simply the set of their userCards rows. Each direction (en->nl,
// nl->en) is scheduled independently.
//
// SRS fields follow FSRS (see src/srs/engine.ts). stability and difficulty are
// null until the first review.
export const userCards = pgTable(
  "user_cards",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conceptId: uuid()
      .notNull()
      .references(() => concepts.id, { onDelete: "cascade" }),
    fromLanguage: text()
      .notNull()
      .references(() => languages.code),
    toLanguage: text()
      .notNull()
      .references(() => languages.code),
    addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // Position within the batch added together (the pack position), so new
    // cards are studied in pack order. Sorted after addedAt.
    sortKey: integer().notNull().default(0),

    state: cardStateEnum().notNull().default("new"),
    dueAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    intervalDays: real().notNull().default(0),
    stability: real(),
    difficulty: real(),
    // Position within the (re)learning steps while state is learning/relearning.
    learningStep: integer().notNull().default(0),
    repetitions: integer().notNull().default(0),
    lapses: integer().notNull().default(0),
    lastReviewedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("user_cards_user_concept_direction_uq").on(
      t.userId,
      t.conceptId,
      t.fromLanguage,
      t.toLanguage,
    ),
    check("user_cards_languages_differ", sql`${t.fromLanguage} <> ${t.toLanguage}`),
    // Serves the "what is due for this user" query.
    index("user_cards_due_idx").on(t.userId, t.dueAt),
  ],
);

// Append-only history of every answer. Never updated or deleted, so the
// schedule can be recomputed if the algorithm changes.
export const reviewLogs = pgTable(
  "review_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userCardId: uuid()
      .notNull()
      .references(() => userCards.id, { onDelete: "cascade" }),
    // Denormalized from userCards so per-user stats don't need a join.
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Client-generated id that makes retried submissions idempotent.
    clientReviewId: uuid().notNull(),
    rating: ratingEnum().notNull(),
    reviewedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    timeTakenMs: integer(),
    stateBefore: cardStateEnum().notNull(),
    stateAfter: cardStateEnum().notNull(),
    intervalBeforeDays: real().notNull(),
    intervalAfterDays: real().notNull(),
    dueAfter: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => [
    unique("review_logs_user_client_review_uq").on(t.userId, t.clientReviewId),
    index("review_logs_card_idx").on(t.userCardId, t.reviewedAt),
    index("review_logs_user_idx").on(t.userId, t.reviewedAt),
  ],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const conceptsRelations = relations(concepts, ({ many }) => ({
  entries: many(entries),
  packConcepts: many(packConcepts),
}));
export const entriesRelations = relations(entries, ({ one, many }) => ({
  concept: one(concepts, { fields: [entries.conceptId], references: [concepts.id] }),
  language: one(languages, { fields: [entries.language], references: [languages.code] }),
  entrySentences: many(entrySentences),
}));
export const entrySentencesRelations = relations(entrySentences, ({ one }) => ({
  entry: one(entries, { fields: [entrySentences.entryId], references: [entries.id] }),
  sentence: one(sentences, {
    fields: [entrySentences.sentenceId],
    references: [sentences.id],
  }),
}));
export const packsRelations = relations(packs, ({ many }) => ({
  packConcepts: many(packConcepts),
}));
export const packConceptsRelations = relations(packConcepts, ({ one }) => ({
  pack: one(packs, { fields: [packConcepts.packId], references: [packs.id] }),
  concept: one(concepts, {
    fields: [packConcepts.conceptId],
    references: [concepts.id],
  }),
}));
export const userCardsRelations = relations(userCards, ({ one, many }) => ({
  user: one(users, { fields: [userCards.userId], references: [users.id] }),
  concept: one(concepts, { fields: [userCards.conceptId], references: [concepts.id] }),
  reviews: many(reviewLogs),
}));
