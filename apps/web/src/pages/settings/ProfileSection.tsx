import { useRef, useState, type FormEvent } from "react";
import { NAME_MAX, changeEmailSchema, updateSettingsSchema, type Settings } from "@flashcards/shared";
import { useChangeEmail } from "../../api/hooks";
import { SaveButton, useFlash } from "../../components/SaveButton";
import { accountError } from "./errors";
import { FieldStatus, useFieldSave } from "./useFieldSave";

export function ProfileSection({ settings }: { settings: Settings }) {
  return (
    <>
      <NameForm saved={settings.name} />
      <EmailForm email={settings.email} />
    </>
  );
}

// The name saves when the box loses focus after a change (or on Enter), with "Saved" beside it.
function NameForm({ saved }: { saved: string | null }) {
  const { save, failed } = useFieldSave();
  const [name, setName] = useState(saved ?? "");
  const [error, setError] = useState<string | null>(null);
  // The last value sent, so Enter followed by leaving the box does not save it twice.
  const sent = useRef<string | null>(null);

  function commit() {
    const trimmed = name.trim();
    if (trimmed === (saved ?? "") || trimmed === sent.current) return;
    if (!updateSettingsSchema.safeParse({ name: trimmed }).success) {
      setError(`Use ${NAME_MAX} characters or fewer.`);
      return;
    }
    setError(null);
    sent.current = trimmed;
    setName(trimmed);
    save({ name: trimmed }, () => {
      sent.current = null;
    });
  }

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault();
        commit();
      }}
      noValidate
    >
      <div className="setting">
        <label htmlFor="display-name">What should we call you?</label>
        <div className="inline-field">
          <input
            id="display-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onBlur={commit}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "display-name-error" : undefined}
          />
          <FieldStatus failed={failed} />
        </div>
        {error && (
          <p id="display-name-error" role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

function EmailForm({ email }: { email: string }) {
  const change = useChangeEmail();
  const [next, setNext] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // The address a confirmation link was last sent to; the email only changes when it is opened.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [flash, fire] = useFlash();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = changeEmailSchema.safeParse({ email: next, password });
    if (!parsed.success) {
      setError(
        parsed.error.issues.some((i) => i.path[0] === "email")
          ? "Enter a valid email address."
          : "Enter your current password.",
      );
      return;
    }
    setError(null);
    change.mutate(parsed.data, {
      onSuccess: ({ pendingEmail }) => {
        setNext("");
        setPassword("");
        setSentTo(pendingEmail);
        fire();
      },
    });
  }

  return (
    <form className="settings section-gap" onSubmit={onSubmit} noValidate>
      <div className="setting">
        <h2 className="setting-title">Email address</h2>
        <p className="muted">
          Your email is <strong>{email}</strong>. To change it, enter the new address and your password.
          We will send a link to the new address; the change happens when you open it.
        </p>
        {sentTo && (
          <p role="status">
            We sent a link to <strong>{sentTo}</strong>. Open it to finish the change. Until then, your email
            stays <strong>{email}</strong>.
          </p>
        )}
      </div>
      <div className="setting">
        <label htmlFor="new-email">New email address</label>
        <input
          id="new-email"
          type="email"
          autoComplete="email"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div className="setting">
        <label htmlFor="email-password">Current password</label>
        <input
          id="email-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="setting-actions">
        <SaveButton
          pending={change.isPending}
          flash={flash}
          disabled={next.trim() === "" || password === ""}
          label="Change email"
          pendingLabel="Sending link"
          doneLabel="Link sent"
        />
        <span role="alert" className="form-error">
          {error ??
            (change.isError
              ? accountError(change.error, {
                  forbidden: "That password is not right.",
                  conflict: "That email address is already registered.",
                })
              : "")}
        </span>
      </div>
    </form>
  );
}
