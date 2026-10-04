// Who may create an account.
//   open      anyone (development default)
//   allowlist only the emails in ALLOWED_EMAILS (invite-only)
//   closed    nobody; accounts can only be created another way
type RegistrationMode = "open" | "allowlist" | "closed";

export interface RegistrationPolicy {
  mode: RegistrationMode;
  /** Lowercased. Only consulted in allowlist mode. */
  allowedEmails: string[];
}

export const OPEN_REGISTRATION: RegistrationPolicy = { mode: "open", allowedEmails: [] };

/** `email` must already be normalized (trimmed, lowercased) by the input schema. */
export function mayRegister(policy: RegistrationPolicy, email: string): boolean {
  switch (policy.mode) {
    case "open":
      return true;
    case "allowlist":
      return policy.allowedEmails.includes(email);
    case "closed":
      return false;
  }
}

// Production must choose explicitly: forgetting the setting would otherwise
// leave sign-ups open to the internet. Misconfiguration fails at startup.
export function registrationPolicyFromEnv(env: NodeJS.ProcessEnv): RegistrationPolicy {
  const raw = env.REGISTRATION_MODE?.trim();

  if (!raw) {
    if (env.NODE_ENV === "production") {
      throw new Error("REGISTRATION_MODE must be set in production: open, allowlist or closed");
    }
    return OPEN_REGISTRATION;
  }
  if (raw !== "open" && raw !== "allowlist" && raw !== "closed") {
    throw new Error(`REGISTRATION_MODE must be open, allowlist or closed (got "${raw}")`);
  }

  const allowedEmails = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (raw === "allowlist" && allowedEmails.length === 0) {
    throw new Error("REGISTRATION_MODE=allowlist requires ALLOWED_EMAILS (comma-separated)");
  }
  return { mode: raw, allowedEmails };
}
