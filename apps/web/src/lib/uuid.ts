// A random (version 4) UUID. crypto.randomUUID exists only on secure pages (https, or localhost), so on
// a phone that reaches the dev server over plain http at the computer's address it is missing and
// calling it throws. getRandomValues is available everywhere.
export function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const hex = [...b].map((x) => x.toString(16).padStart(2, "0"));
  return [hex.slice(0, 4), hex.slice(4, 6), hex.slice(6, 8), hex.slice(8, 10), hex.slice(10)]
    .map((part) => part.join(""))
    .join("-");
}
