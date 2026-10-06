import { relations, sql } from "drizzle-orm";
import {
  boolean,
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
// What a report is about: a word's card, a bug in the app, an idea for it, or a pack of words someone
// could not find.
export const reportKindEnum = pgEnum("report_kind", ["card", "bug", "suggestion", "pack_request"]);
export const reportReasonEnum = pgEnum("report_reason", ["translation", "forms", "sentence", "other"]);

// ---------------------------------------------------------------------------
// Users & auth
// ---------------------------------------------------------------------------

// What an account may do: everyone is a user; admins can also see and answer everyone's reports.
// Set with the `user-role` script (see deploy/README.md), never by the app.
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  role: userRoleEnum().notNull().default("user"),
  // Optional display name; the app shows the email when there is none.
  name: text(),
  passwordHash: text().notNull(),
  // When the user followed the link sent to this address; null until then.
  emailVerifiedAt: timestamp({ withTimezone: true }),
  timezone: text().notNull().default("UTC"),
  dailyNewCardLimit: integer().notNull().default(20),
  // What the study cards show.
  showSentences: boolean().notNull().default(true),
  showForms: boolean().notNull().default(true),
  // The user has read the explainer on the Add words page and dismissed it.
  addWordsIntroSeen: boolean().notNull().default(false),
  // What the user is learning, prompt language first: the pages and decks they see are for this
  // pair of languages. Null until they choose, which means ADD_WORDS_DIRECTION.
  activeFrom: text().references(() => languages.code),
  activeTo: text().references(() => languages.code),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const emailTokenPurposeEnum = pgEnum("email_token_purpose", [
  "verify_email",
  "reset_password",
  "change_email",
]);

// One-time links sent by email. Only the hash of the token is stored, like sessions.
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: text().primaryKey(), // hash of the token
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: emailTokenPurposeEnum().notNull(),
    // The address the email went to. For change_email this is the new address; the others
    // are only valid while it is still the account's address.
    email: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_tokens_user_idx").on(t.userId, t.purpose)],
);

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
  // Stable identifier used by the content files and never edited, e.g. "dog" or
  // "know-fact". It is how packs refer to a concept, so the gloss can be reworded.
  key: text().notNull().unique(),
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
  // One of PACK_CATEGORIES (see @flashcards/shared).
  category: text().notNull().default("topic"),
  // The language the pack teaches (a frequency list, a language's grammar words), or null for a
  // pack that suits any language. Only people learning that language are shown it.
  target: text().references(() => languages.code),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// A pack's name and description in other languages than the one in `packs` (PACK_TEXT_LANGUAGE),
// for learners who read that language. A learner whose language has no row gets the `packs` text.
export const packTexts = pgTable(
  "pack_texts",
  {
    packId: uuid()
      .notNull()
      .references(() => packs.id, { onDelete: "cascade" }),
    language: text()
      .notNull()
      .references(() => languages.code),
    name: text().notNull(),
    description: text(),
  },
  (t) => [primaryKey({ columns: [t.packId, t.language] })],
);

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

// What users send in: problems with a word's card, bugs, and feature suggestions (`kind`). The
// table keeps its first name, card_reports. The owner is emailed about each one, reads them
// with `npm run reports` or in the app's admin dashboard, talks to the sender through comments, fixes
// the content and marks the report resolved. The sender sees its status and the conversation.
export const cardReports = pgTable(
  "card_reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    // Who sent it. Cleared when they delete their account: the report is about the word, and
    // is still worth reading, but it should no longer be tied to a person.
    userId: uuid().references(() => users.id, { onDelete: "set null" }),
    kind: reportKindEnum().notNull().default("card"),
    // A short summary, for bugs and suggestions. Empty for a card problem, which is about a word.
    title: text().notNull().default(""),
    // The word, the direction the card was shown in, and what was wrong with it: only for a card
    // problem (see the check below).
    conceptId: uuid().references(() => concepts.id, { onDelete: "cascade" }),
    fromLanguage: text().references(() => languages.code),
    toLanguage: text().references(() => languages.code),
    reason: reportReasonEnum(),
    note: text().notNull().default(""),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("card_reports_open_idx").on(t.resolvedAt, t.createdAt),
    check(
      "card_reports_card_has_word",
      sql`${t.kind} <> 'card' or (${t.conceptId} is not null and ${t.fromLanguage} is not null and ${t.toLanguage} is not null and ${t.reason} is not null)`,
    ),
  ],
);

// The conversation about a report: what its sender adds while it is open (more details, an answer to
// a question), and the owner's replies (`fromAdmin`), in the order they were written.
export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid().primaryKey().defaultRandom(),
    reportId: uuid()
      .notNull()
      .references(() => cardReports.id, { onDelete: "cascade" }),
    body: text().notNull(),
    // Written by an admin, not by the report's sender.
    fromAdmin: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("report_comments_report_idx").on(t.reportId, t.createdAt)],
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
