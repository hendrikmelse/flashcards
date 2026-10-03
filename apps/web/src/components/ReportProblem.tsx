import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { REPORT_NOTE_MAX, REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from "@flashcards/shared";
import { useReportCard } from "../api/hooks";
import { BusyLabel } from "./BusyLabel";

// "Report a problem with this card": the content is not reviewed by a native speaker yet, so
// readers are asked to point out what is wrong. Folded away until asked for; after sending, it
// only says thanks. Give it a `key` so each card starts fresh.
export function ReportProblem({
  conceptId,
  fromLanguage,
  toLanguage,
}: {
  conceptId: string;
  fromLanguage: string;
  toLanguage: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("translation");
  const [note, setNote] = useState("");
  const report = useReportCard(conceptId);
  const id = useId();

  // Opening the form moves focus into it, and closing it moves focus back to the link, so the
  // keyboard (and Escape, in the card view) keeps working instead of losing its place.
  const select = useRef<HTMLSelectElement>(null);
  const link = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);
  useEffect(() => {
    if (open) select.current?.focus();
    else if (opened.current) link.current?.focus();
    opened.current = open;
  }, [open]);

  if (report.isSuccess) {
    return (
      <p className="report-done" role="status">
        Thanks! We’ll take a look.
      </p>
    );
  }

  if (!open) {
    return (
      <p className="report">
        <button ref={link} type="button" className="link" aria-expanded="false" onClick={() => setOpen(true)}>
          Report a problem
        </button>
      </p>
    );
  }

  const needsNote = reason === "other";
  const missingNote = needsNote && note.trim() === "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (missingNote || report.isPending) return;
    report.mutate({ fromLanguage, toLanguage, reason, note: note.trim() });
  }

  return (
    <form className="report-form" aria-label="Report a problem" onSubmit={submit}>
      <label htmlFor={`${id}-reason`}>What is wrong?</label>
      <select
        ref={select}
        id={`${id}-reason`}
        className="dropdown"
        value={reason}
        onChange={(e) => setReason(e.target.value as ReportReason)}
      >
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {REPORT_REASON_LABELS[r]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-note`}>
        Details{!needsNote && <span className="muted"> (optional)</span>}
      </label>
      <textarea
        id={`${id}-note`}
        rows={3}
        maxLength={REPORT_NOTE_MAX}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={needsNote ? "What should we look at?" : "What should it say instead?"}
      />
      {report.isError && (
        <p role="alert" className="form-error">
          Could not send your report. Please try again.
        </p>
      )}
      <div className="report-actions">
        <button type="submit" className="primary" disabled={missingNote} aria-busy={report.isPending}>
          <BusyLabel busy={report.isPending}>Send report</BusyLabel>
        </button>
        <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={report.isPending}>
          Cancel
        </button>
      </div>
    </form>
  );
}
