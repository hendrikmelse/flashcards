import { ApiError } from "../api/client";
import { useMe, useResendVerification } from "../api/hooks";

// Shown to someone whose email address is not confirmed yet. It does not block anything: the
// address matters for resetting a forgotten password, so it is worth a nudge, not a wall.
export function VerifyEmailNotice() {
  const { data: user } = useMe();
  const resend = useResendVerification();
  // Not `!user.emailVerified`: nothing is shown until the server has said the address is unconfirmed.
  if (!user || user.emailVerified !== false) return null;

  const tooSoon = resend.error instanceof ApiError && resend.error.status === 429;
  return (
    <div className="notice" role="region" aria-label="Confirm your email">
      <p>
        Please confirm your email address: we sent a link to <strong>{user.email}</strong>. Without it, a
        forgotten password cannot be reset.
      </p>
      <button type="button" className="secondary" onClick={() => resend.mutate()} disabled={resend.isPending || resend.isSuccess}>
        {resend.isSuccess ? "Link sent" : resend.isPending ? "Sending…" : "Send the link again"}
      </button>
      <span role="status" className="form-error">
        {tooSoon
          ? "A link was sent a moment ago. Wait a minute and try again."
          : resend.isError
            ? "Could not send the email. Please try again later."
            : ""}
      </span>
    </div>
  );
}
