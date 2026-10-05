import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { forgotPasswordSchema, resetPasswordSchema } from "@flashcards/shared";
import { ApiError } from "../api/client";
import { useForgotPassword, useResetPassword, useVerifyEmail } from "../api/hooks";
import { usePageTitle } from "../hooks/usePageTitle";

// The pages the links in emails open, and the one that asks for the first email.

export function ForgotPasswordPage() {
  usePageTitle("Reset your password");
  const forgot = useForgotPassword();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError("Enter a valid email address.");
      return;
    }
    setFieldError(null);
    forgot.mutate(parsed.data);
  }

  if (forgot.isSuccess) {
    return (
      <main className="auth">
        <h1>Check your email</h1>
        {/* The same answer whether or not the address has an account. */}
        <p>
          If there is an account for <strong>{email.trim().toLowerCase()}</strong>, we have sent it a link to
          choose a new password. The link works for one hour.
        </p>
        <p className="muted">Nothing there? Look in your spam folder, or wait a minute and ask again.</p>
        <p>
          <Link to="/login" className="button primary">
            Back to log in
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="auth">
      <h1>Reset your password</h1>
      <p className="muted">Enter your email address and we will send you a link to choose a new password.</p>
      <form onSubmit={onSubmit} noValidate>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "email-error" : undefined}
          />
        </label>
        {fieldError && (
          <p id="email-error" className="field-error">
            {fieldError}
          </p>
        )}
        <div role="alert" className="form-error">
          {forgot.isError
            ? forgot.error instanceof ApiError && forgot.error.status === 429
              ? "Too many attempts. Please wait a minute and try again."
              : "Could not send the email. Please try again."
            : null}
        </div>
        <button type="submit" className="primary" disabled={forgot.isPending}>
          {forgot.isPending ? "Please wait…" : "Send reset link"}
        </button>
      </form>
      <p className="alt">
        <Link to="/login">Back to log in</Link>
      </p>
    </main>
  );
}

export function ResetPasswordPage() {
  usePageTitle("Choose a new password");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = resetPasswordSchema.safeParse({ token, newPassword: password });
    if (!parsed.success) {
      setFieldError("Use at least 8 characters.");
      return;
    }
    setFieldError(null);
    reset.mutate(parsed.data);
  }

  if (reset.isSuccess) {
    return (
      <main className="auth">
        <h1>Password changed</h1>
        <p className="muted">
          Your password has been changed and you have been signed out everywhere. Log in with the new one.
        </p>
        <p>
          <Link to="/login" className="button primary">
            Log in
          </Link>
        </p>
      </main>
    );
  }

  // The form checks the password first, so a refusal from the server means the link is no good.
  const expired = reset.error instanceof ApiError && reset.error.status === 400;
  if (!token || expired) {
    return (
      <main className="auth">
        <h1>This link does not work</h1>
        <p className="muted">
          It may have expired (they last an hour), or it may already have been used. You can ask for a new one.
        </p>
        <p>
          <Link to="/forgot-password" className="button primary">
            Send a new link
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="auth">
      <h1>Choose a new password</h1>
      <form onSubmit={onSubmit} noValidate>
        <label>
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? "password-error" : undefined}
          />
        </label>
        {fieldError && (
          <p id="password-error" className="field-error">
            {fieldError}
          </p>
        )}
        <div role="alert" className="form-error">
          {reset.isError
            ? reset.error instanceof ApiError && reset.error.status === 429
              ? "Too many attempts. Please wait a minute and try again."
              : "Could not change the password. Please try again."
            : null}
        </div>
        <button type="submit" className="primary" disabled={reset.isPending}>
          {reset.isPending ? "Please wait…" : "Change password"}
        </button>
      </form>
    </main>
  );
}

// Confirms an address as soon as the page opens: the person already chose to by clicking the link.
export function VerifyEmailPage() {
  usePageTitle("Confirm your email");
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const verify = useVerifyEmail();
  // The effect runs twice in development; the link works only once, so it must be sent once.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    verify.mutate({ token });
  }, [token, verify]);

  const taken = verify.error instanceof ApiError && verify.error.status === 409;
  return (
    <main className="auth">
      {verify.isSuccess ? (
        <>
          <h1>{verify.data.status === "changed" ? "Email changed" : "Email confirmed"}</h1>
          <p className="muted">
            {verify.data.status === "changed"
              ? "Your account now uses this address. Log in with it from now on."
              : "Thank you. Your email address is confirmed."}
          </p>
          <p>
            <Link to="/" className="button primary">
              Return to dashboard
            </Link>
          </p>
        </>
      ) : !token || verify.isError ? (
        <>
          <h1>{taken ? "That address is taken" : "This link does not work"}</h1>
          <p className="muted">
            {taken
              ? "Another account has started using this email address since you asked for the change."
              : "It may have expired, or it may already have been used. Log in to send a new link."}
          </p>
          <p>
            <Link to="/" className="button primary">
              Return to dashboard
            </Link>
          </p>
        </>
      ) : (
        <p className="status" role="status">
          Confirming your email…
        </p>
      )}
    </main>
  );
}
