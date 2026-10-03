import { ApiError } from "../../api/client";

// A plain-language message for a failed account change.
export function accountError(e: unknown, messages: { forbidden: string; conflict?: string }): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return messages.forbidden;
    if (e.status === 409 && messages.conflict) return messages.conflict;
    if (e.status === 429) return "Too many attempts. Please wait a minute and try again.";
    if (e.status === 400) return "Please check what you entered and try again.";
  }
  return "Something went wrong. Please try again.";
}
