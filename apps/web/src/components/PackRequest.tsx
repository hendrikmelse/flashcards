import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { FEEDBACK_NOTE_MAX, FEEDBACK_TITLE_MAX } from "@flashcards/shared";
import { useSendFeedback } from "../api/hooks";
import { BusyLabel } from "./BusyLabel";

// Asking for a pack that a search did not find: a button that opens a small form, with the search
// as the pack's name. It is sent from here, to the same place as other reports, where the sender
// can follow it. Give it a `key` of the search so a new search starts fresh.
export function PackRequest({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(query.slice(0, FEEDBACK_TITLE_MAX));
  const [note, setNote] = useState("");
  const send = useSendFeedback();
  const id = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  if (send.isSuccess) {
    return (
      <p role="status" className="pack-request-done">
        Thanks! Your request is in. <Link to="/reports">See your reports</Link>
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="secondary" onClick={() => setOpen(true)}>
        Request this pack
      </button>
    );
  }

  const missing = title.trim() === "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (missing || send.isPending) return;
    send.mutate({ kind: "pack_request", title: title.trim(), note: note.trim() });
  }

  return (
    <form className="pack-request-form" aria-label="Request a pack" onSubmit={submit}>
      <label htmlFor={`${id}-title`}>What pack would you like?</label>
      <input
        ref={first}
        id={`${id}-title`}
        type="text"
        maxLength={FEEDBACK_TITLE_MAX}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <label htmlFor={`${id}-note`}>
        Details <span className="muted">(optional)</span>
      </label>
      <textarea
        id={`${id}-note`}
        rows={3}
        maxLength={FEEDBACK_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Which words or topics should it include?"
      />
      {send.isError && (
        <p role="alert" className="form-error">
          Could not send your request. Please try again.
        </p>
      )}
      <div className="report-actions feedback-actions">
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={send.isPending}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={missing} aria-busy={send.isPending}>
          <BusyLabel busy={send.isPending}>Send request</BusyLabel>
        </button>
      </div>
    </form>
  );
}
