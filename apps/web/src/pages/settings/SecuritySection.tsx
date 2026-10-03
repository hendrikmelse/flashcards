import { useState, type FormEvent } from "react";
import { changePasswordSchema } from "@flashcards/shared";
import { useChangePassword } from "../../api/hooks";
import { SaveButton, useFlash } from "../../components/SaveButton";
import { accountError } from "./errors";

export function SecuritySection() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [flash, fire] = useFlash();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (!changePasswordSchema.safeParse({ currentPassword: current, newPassword: next }).success) {
      setError(next.length < 8 ? "Use at least 8 characters for the new password." : "Enter your current password.");
      return;
    }
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setError(null);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirm("");
          setDone(true);
          fire();
        },
      },
    );
  }

  return (
    <form className="settings" onSubmit={onSubmit} noValidate>
      <div className="setting">
        <h2 className="setting-title">Change password</h2>
        <p className="muted">Changing your password signs you out of other devices</p>
      </div>
      <div className="setting">
        <label htmlFor="current-password">Current password</label>
        <input
          id="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </div>
      <div className="setting">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </div>
      <div className="setting">
        <label htmlFor="confirm-password">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      <div className="setting-actions">
        <SaveButton
          pending={change.isPending}
          flash={flash}
          disabled={current === "" || next === "" || confirm === ""}
          label="Change password"
          pendingLabel="Changing password"
          doneLabel="Password changed"
        />
        <span role="alert" className="form-error">
          {error ??
            (change.isError ? accountError(change.error, { forbidden: "That current password is not right." }) : "")}
        </span>
      </div>
      {done && (
        <p role="status" className="muted">
          Password changed. Your other devices have been signed out.
        </p>
      )}
    </form>
  );
}
