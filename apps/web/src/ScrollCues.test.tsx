import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollCues } from "./hooks/useScrollCues";

// jsdom lays nothing out, so the sizes a browser would measure are set by hand.
function setSizes(el: Element, sizes: { scrollWidth: number; clientWidth: number; scrollLeft: number }) {
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(el, key, { configurable: true, value });
  }
}

function Page({ pressed = "b" }: { pressed?: string }) {
  useScrollCues();
  return (
    <div className="toggle" role="group" aria-label="Category">
      {["a", "b", "c"].map((id) => (
        <button key={id} type="button" aria-pressed={pressed === id}>
          {id}
        </button>
      ))}
    </div>
  );
}

const block = (container: HTMLElement) => container.querySelector(".toggle") as HTMLElement;
const edges = (el: Element) => ({ start: el.hasAttribute("data-more-start"), end: el.hasAttribute("data-more-end") });

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

describe("the scroll cues on filter blocks", () => {
  it("marks no edge on a block that fits", () => {
    const { container } = render(<Page />);
    setSizes(block(container), { scrollWidth: 100, clientWidth: 100, scrollLeft: 0 });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(edges(block(container))).toEqual({ start: false, end: false });
  });

  it("marks the end that has more buttons beyond it, and both ends in the middle", () => {
    const { container } = render(<Page />);
    const el = block(container);

    setSizes(el, { scrollWidth: 300, clientWidth: 100, scrollLeft: 0 });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(edges(el)).toEqual({ start: false, end: true });

    setSizes(el, { scrollWidth: 300, clientWidth: 100, scrollLeft: 80 });
    act(() => void el.dispatchEvent(new Event("scroll")));
    expect(edges(el)).toEqual({ start: true, end: true });

    setSizes(el, { scrollWidth: 300, clientWidth: 100, scrollLeft: 200 });
    act(() => void el.dispatchEvent(new Event("scroll")));
    expect(edges(el)).toEqual({ start: true, end: false });
  });

  it("clears the marks when the block stops overflowing", () => {
    const { container } = render(<Page />);
    const el = block(container);
    setSizes(el, { scrollWidth: 300, clientWidth: 100, scrollLeft: 0 });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(edges(el).end).toBe(true);
    setSizes(el, { scrollWidth: 100, clientWidth: 100, scrollLeft: 0 });
    act(() => void window.dispatchEvent(new Event("resize")));
    expect(edges(el)).toEqual({ start: false, end: false });
  });

  it("picks up a block that appears later", async () => {
    render(<Page />);
    const late = document.createElement("div");
    late.className = "toggle";
    setSizes(late, { scrollWidth: 300, clientWidth: 100, scrollLeft: 0 });
    document.body.append(late);
    await waitFor(() => expect(late).toHaveAttribute("data-more-end"));
    late.remove();
  });
});

describe("keeping the selected button in the middle", () => {
  // The block is 100 wide, scrolled to 0; the button is 40 wide and starts 200 along.
  const geometry = (container: HTMLElement) => {
    const el = block(container);
    setSizes(el, { scrollWidth: 400, clientWidth: 100, scrollLeft: 0 });
    el.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    for (const button of el.querySelectorAll("button")) {
      button.getBoundingClientRect = () => ({ left: 200, width: 40 }) as DOMRect;
    }
    return el;
  };

  it("scrolls the block so that a newly selected button is in the middle", async () => {
    const { container, rerender } = render(<Page pressed="a" />);
    const el = geometry(container);
    const scrollTo = vi.fn();
    el.scrollTo = scrollTo;

    rerender(<Page pressed="c" />);
    // Centre of the button is 220 along; the middle of the block is 50, so scroll to 170.
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ left: 170, behavior: "smooth" }));
  });

  it("does not scroll a block that fits", async () => {
    const { container, rerender } = render(<Page pressed="a" />);
    const el = geometry(container);
    setSizes(el, { scrollWidth: 100, clientWidth: 100, scrollLeft: 0 });
    const scrollTo = vi.fn();
    el.scrollTo = scrollTo;
    rerender(<Page pressed="c" />);
    await act(async () => void (await Promise.resolve()));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("scrolls without animation when the person asks for less motion", async () => {
    // jsdom has no matchMedia; this one says the person prefers reduced motion.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: query.includes("reduce"), media: query }),
    });
    const { container, rerender } = render(<Page pressed="a" />);
    const el = geometry(container);
    const scrollTo = vi.fn();
    el.scrollTo = scrollTo;
    rerender(<Page pressed="c" />);
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ left: 170, behavior: "auto" }));
  });
});
