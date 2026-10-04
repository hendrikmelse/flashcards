import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("randomUUID", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes a version 4 UUID", () => {
    expect(randomUUID()).toMatch(V4);
  });

  it("still works where crypto.randomUUID is missing, as on a page that is not secure", () => {
    vi.stubGlobal("crypto", { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    const a = randomUUID();
    expect(a).toMatch(V4);
    expect(randomUUID()).not.toBe(a);
  });
});
