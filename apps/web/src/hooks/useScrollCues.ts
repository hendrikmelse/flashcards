import { useEffect } from "react";

const smooth = () => (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/** Scrolls a filter block, if it scrolls at all, so that its selected button is in the middle. */
function centerSelected(block: Element, behavior: ScrollBehavior) {
  if (block.scrollWidth <= block.clientWidth) return;
  const selected = block.querySelector('[aria-pressed="true"]');
  if (!selected) return;
  const at = selected.getBoundingClientRect();
  const blockAt = block.getBoundingClientRect();
  const left = block.scrollLeft + (at.left - blockAt.left) - (block.clientWidth - at.width) / 2;
  block.scrollTo?.({ left, behavior });
}

/**
 * Looks after the filter blocks (`.toggle`) that are wider than the screen and scroll sideways:
 *
 * - It marks which way each has more buttons to scroll to: `data-more-start` when some are hidden
 *   before the visible part, `data-more-end` when some are hidden after it. A phone's styles use them
 *   to fade that edge, as a cue to swipe (see mobile.css), the way the settings tabs do.
 * - When a button is selected, the block scrolls to put it in the middle, and one that is already
 *   selected when the block appears (a remembered filter) is put there at once.
 *
 * Call it once, high in the app: it covers every filter block on the page, including ones that appear
 * later (a new page, a filter that only shows when there is something to filter), so none needs
 * wiring up on its own.
 */
export function useScrollCues(selector = ".toggle") {
  useEffect(() => {
    const update = (el: Element) => {
      const more = el.scrollWidth - el.clientWidth > 1;
      el.toggleAttribute("data-more-start", more && el.scrollLeft > 1);
      el.toggleAttribute("data-more-end", more && el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };

    // Every block found, measured now and again whenever it scrolls or the page changes under it.
    // One seen for the first time shows its selected button without any scrolling to get there.
    const seen = new WeakSet<Element>();
    const scan = () =>
      document.querySelectorAll(selector).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          centerSelected(el, "auto");
        }
        update(el);
      });
    scan();

    // A page change, a count growing from 9 to 10, a filter appearing: all change what fits. So does
    // a button being selected, which is also the cue to bring it to the middle.
    const changes = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type !== "attributes" || !(r.target instanceof Element)) continue;
        if (r.target.getAttribute("aria-pressed") !== "true") continue;
        const block = r.target.closest(selector);
        if (block) centerSelected(block, smooth());
      }
      scan();
    });
    changes.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-pressed"],
    });

    // Scroll events do not bubble, but a capturing listener on the document hears all of them.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.matches(selector)) update(e.target);
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", scan);

    return () => {
      changes.disconnect();
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", scan);
    };
  }, [selector]);
}
