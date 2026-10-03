import { useState, type FormEvent } from "react";
import { useDeleteAccount } from "../../api/hooks";
import { accountError } from "./errors";

export function DataSection() {
  return (
    <>
      <div className="setting">
        <h2 className="setting-title">Download your data</h2>
        <p className="muted">
          Everything we keep about you as one file: your account details, every card with its schedule, and your full
          review history. It never includes your password.
        </p>
        <p>
          <a className="button secondary" href="/api/account/export" download>
            Download my data
          </a>
        </p>
      </div>
      <DeleteAccount />
    </>
  );
}

function DeleteAccount() {
  const del = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    del.mutate({ password });
  }

  return (
    <div className="setting danger-zone section-gap">
      <h2 className="setting-title">Delete your account</h2>
      <p className="muted">
        This permanently deletes your account, your cards, and your review history. It cannot be undone. Download your
        data first if you want to keep it. Problem reports you made are kept, but will no longer be linked to your account.
      </p>
      {!open ? (
        <p>
          <button type="button" className="secondary danger-outline" onClick={() => setOpen(true)}>
            Delete my account…
          </button>
        </p>
      ) : (
        <form className="settings" onSubmit={onSubmit} noValidate>
          <div className="setting">
            <label htmlFor="delete-password">Enter your password to confirm</label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="setting-actions">
            <button
              type="submit"
              className="danger"
              disabled={password === "" || del.isPending}
              aria-busy={del.isPending}
            >
              <span style={del.isPending ? { visibility: "hidden" } : undefined}>Permanently delete my account</span>
              {del.isPending && <span className="spinner" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setOpen(false);
                setPassword("");
                del.reset();
              }}
              disabled={del.isPending}
            >
              Cancel
            </button>
          </div>
          <p role="alert" className="form-error">
            {del.isError ? accountError(del.error, { forbidden: "That password is not right." }) : ""}
          </p>
        </form>
      )}
    </div>
  );
}
