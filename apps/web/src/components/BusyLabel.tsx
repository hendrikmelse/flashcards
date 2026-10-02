import type { ReactNode } from "react";

// A button's label that gives way to a spinner while busy. The label stays in the
// layout (hidden), so the button keeps its width.
export function BusyLabel({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <>
      <span style={busy ? { visibility: "hidden" } : undefined}>{children}</span>
      {busy && <span className="spinner" aria-hidden="true" />}
    </>
  );
}
