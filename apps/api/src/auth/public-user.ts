import { ADD_WORDS_DIRECTION, type LanguageCode, type PublicUser, type UserRole } from "@flashcards/shared";
import { users } from "../db/schema.js";

// The columns a PublicUser is made from.
export const publicUserColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  emailVerifiedAt: users.emailVerifiedAt,
  activeFrom: users.activeFrom,
  activeTo: users.activeTo,
};

type Row = { activeFrom: string | null; activeTo: string | null };
type UserRow = Row & {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  emailVerifiedAt: Date | null;
};

/** What the user is learning: their choice, or the default until they make one. */
export function activeDirection(row: Row): { from: LanguageCode; to: LanguageCode } {
  return row.activeFrom && row.activeTo
    ? { from: row.activeFrom as LanguageCode, to: row.activeTo as LanguageCode }
    : { ...ADD_WORDS_DIRECTION };
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: row.emailVerifiedAt !== null,
    direction: activeDirection(row),
  };
}
