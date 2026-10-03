import { useState } from "react";
import type { UpdateSettingsInput } from "@flashcards/shared";
import { useUpdateSettings } from "../../api/hooks";
import { useFlash } from "../../components/SaveButton";

/** How long "Saved" stays on screen. */
export const SAVED_MS = 1200;

// Saves one setting on its own and tracks how it went, so the result can be shown right next to
// the control that changed. Use one per control.
export function useFieldSave() {
  const update = useUpdateSettings();
  const [flash, fire] = useFlash(SAVED_MS);
  const [failed, setFailed] = useState(false);

  function save(input: UpdateSettingsInput, onError?: () => void) {
    setFailed(false);
    update.mutate(input, {
      onSuccess: fire,
      onError: () => {
        setFailed(true);
        onError?.();
      },
    });
  }
  return { save, flash, failed };
}

// "✓ Saved" for a moment after a save, or a short error, to sit beside the control.
export function FieldStatus({ flash, failed }: { flash: boolean; failed: boolean }) {
  return (
    <span role="status" className={failed ? "field-status form-error" : "field-status"}>
      {failed ? (
        "Could not save. Try again."
      ) : flash ? (
        <>
          <span aria-hidden="true">✓</span> Saved
        </>
      ) : (
        ""
      )}
    </span>
  );
}
