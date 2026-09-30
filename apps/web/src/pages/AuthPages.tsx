import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { loginSchema, registerSchema } from "@flashcards/shared";
import { ApiError } from "../api/client";
import { useLogin, useRegister } from "../api/hooks";

type Mode = "login" | "register";
type FieldErrors = { email?: string; password?: string };

function describeError(mode: Mode, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Invalid email or password.";
    if (e.status === 409) return "That email is already registered. Try logging in.";
    if (e.status === 429) return "Too many attempts. Please wait a minute and try again.";
    if (e.status === 400) return "Please check your details and try again.";
  }
  return mode === "login"
    ? "Could not log in. Please try again."
    : "Could not create your account. Please try again.";
}

function AuthForm({ mode }: { mode: Mode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();
  const register = useRegister();
  const mutation = mode === "login" ? login : register;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const isLogin = mode === "login";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = (isLogin ? loginSchema : registerSchema).safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "email") errors.email = "Enter a valid email address.";
        if (issue.path[0] === "password") {
          errors.password = isLogin ? "Enter your password." : "Use at least 8 characters.";
        }
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    mutation.mutate(parsed.data, { onSuccess: () => navigate(from, { replace: true }) });
  }

  return (
    <main className="auth">
      <h1>{isLogin ? "Log in" : "Create your account"}</h1>
      <form onSubmit={onSubmit} noValidate>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
        </label>
        {fieldErrors.email && (
          <p id="email-error" className="field-error">
            {fieldErrors.email}
          </p>
        )}

        <label>
          Password
          <input
            type="password"
            autoComplete={isLogin ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
          />
        </label>
        {fieldErrors.password && (
          <p id="password-error" className="field-error">
            {fieldErrors.password}
          </p>
        )}

        <div role="alert" className="form-error">
          {mutation.isError ? describeError(mode, mutation.error) : null}
        </div>

        <button type="submit" className="primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Please wait…" : isLogin ? "Log in" : "Sign up"}
        </button>
      </form>
      <p className="alt">
        {isLogin ? (
          <>
            New here? <Link to="/register">Create an account</Link>
          </>
        ) : (
          <>
            Already have an account? <Link to="/login">Log in</Link>
          </>
        )}
      </p>
    </main>
  );
}

export const LoginPage = () => <AuthForm mode="login" />;
export const RegisterPage = () => <AuthForm mode="register" />;
