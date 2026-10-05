// The database error (code 23505) may be wrapped by the query layer, so look through its causes.
export const isUniqueViolation = (e: unknown): boolean => {
  if (typeof e !== "object" || e === null) return false;
  if ((e as { code?: unknown }).code === "23505") return true;
  return isUniqueViolation((e as { cause?: unknown }).cause);
};
