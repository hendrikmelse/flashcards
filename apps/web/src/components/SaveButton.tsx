import { useEffect, useRef, useState, type ReactNode } from "react";

/** How long the checkmark shows after a successful save. */
const FLASH_MS = 1500;

/** A flag that turns on when fired and off again after `ms`. */
export function useFlash(ms = FLASH_MS): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  function fire() {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), ms);
  }
  return [on, fire];
}

type Props = {
  pending: boolean;
  /** Show the checkmark (see useFlash). */
  flash: boolean;
  disabled?: boolean;
  /** The label at rest, while saving and just after, which also name the button for screen readers. */
  label?: string;
  pendingLabel?: string;
  doneLabel?: string;
  variant?: "primary" | "danger";
  children?: ReactNode;
};

// A submit button that shows a spinner while it works, then a checkmark for a moment, then its
// label again. The label stays in the layout (hidden) so the button keeps its width throughout.
export function SaveButton({
  pending,
  flash,
  disabled = false,
  label = "Save",
  pendingLabel = "Saving",
  doneLabel = "Saved",
  variant = "primary",
}: Props) {
  return (
    <button
      type="submit"
      className={flash ? `${variant} done` : variant}
      disabled={disabled || pending}
      aria-busy={pending}
      aria-label={pending ? pendingLabel : flash ? doneLabel : undefined}
    >
      <span style={pending || flash ? { visibility: "hidden" } : undefined}>{label}</span>
      {pending && <span className="spinner" aria-hidden="true" />}
      {flash && !pending && (
        <span className="check" aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  );
}
