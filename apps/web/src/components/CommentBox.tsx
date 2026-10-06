import { useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { COMMENT_MAX } from "@flashcards/shared";
import { BusyLabel } from "./BusyLabel";

/** The part of a mutation the box needs: send one comment, and say when that worked. */
export interface SendComment {
  mutate: (input: { body: string }, options: { onSuccess: () => void }) => void;
  isPending: boolean;
  isError: boolean;
}

// A one-line box for a message in a report's conversation, with its button at the right. It grows
// with the text, up to a limit, and empties once the message is sent. Used by the report's sender
// and by admins replying, so the two look the same.
export function CommentBox({
  send,
  label,
  placeholder,
  buttonLabel,
  ariaLabel,
  extra,
}: {
  send: SendComment;
  /** The box's accessible name (it has no visible label). */
  label: string;
  placeholder: string;
  buttonLabel: string;
  /** The form's accessible name. */
  ariaLabel: string;
  /** Another button after the send button, in the same row; it is given what is typed so far. */
  extra?: (draft: { text: string; clear: () => void }) => ReactNode;
}) {
  const [body, setBody] = useState("");
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  // Whether the text has outgrown one line. The box then grows with it, up to the most the
  // stylesheet allows (max-height), and scrolls beyond that.
  const [grown, setGrown] = useState(false);

  // Start from the stretched, one-line height; if the text does not fit, make the box as tall as it.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "";
    el.style.overflowY = "hidden";
    const overflows = el.scrollHeight > el.clientHeight + 1;
    if (overflows) {
      // scrollHeight leaves out the borders, which the box (border-box) counts in its height.
      const wanted = el.scrollHeight + el.offsetHeight - el.clientHeight;
      el.style.height = `${wanted}px`;
      // Only a box held back by max-height scrolls. Below that it never does: scrollHeight is
      // rounded, so a box that fits exactly could still show a scrollbar for a fraction of a pixel.
      const max = parseFloat(getComputedStyle(el).maxHeight);
      if (Number.isFinite(max) && wanted > max) el.style.overflowY = "auto";
    }
    setGrown(overflows);
  }, [body]);

  const empty = body.trim() === "";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (empty || send.isPending) return;
    send.mutate({ body: body.trim() }, { onSuccess: () => setBody("") });
  }

  return (
    <form
      className={extra ? "my-report-comment-form has-extra" : "my-report-comment-form"}
      aria-label={ariaLabel}
      data-grown={grown || undefined}
      onSubmit={submit}
    >
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <textarea
        ref={area}
        id={id}
        rows={1}
        maxLength={COMMENT_MAX}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
      />
      <button type="submit" className="primary" disabled={empty} aria-busy={send.isPending}>
        <BusyLabel busy={send.isPending}>{buttonLabel}</BusyLabel>
      </button>
      {extra?.({ text: body.trim(), clear: () => setBody("") })}
      {send.isError && (
        <p role="alert" className="form-error">
          Could not send that. Please try again.
        </p>
      )}
    </form>
  );
}
