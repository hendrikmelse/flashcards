import { useState } from "react";
import type { UpdateSettingsInput } from "@flashcards/shared";
import { useUpdateSettings } from "../../api/hooks";

// Saves one setting on its own and tracks whether it failed, so the error can be shown right next
// to the control that changed. A setting that saves says nothing: the change just stays. Use one
// per control.
export function useFieldSave() {
  const update = useUpdateSettings();
  const [failed, setFailed] = useState(false);

  function save(input: UpdateSettingsInput, onError?: () => void) {
    setFailed(false);
    update.mutate(input, {
      onError: () => {
        setFailed(true);
        onError?.();
      },
    });
  }
  return { save, failed };
}

// A short error beside the control when a save did not go through, and nothing otherwise.
export function FieldStatus({ failed }: { failed: boolean }) {
  if (!failed) return null;
  return (
    <span role="alert" className="field-status form-error">
      Could not save. Try again.
    </span>
  );
}
