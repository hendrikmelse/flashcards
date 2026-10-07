import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp, sentence } from "./test/harness";

const EN_NL = "fromLanguage=en&toLanguage=nl";
const NL_EN = "fromLanguage=nl&toLanguage=en";

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: "noun",
  details,
});

// Mutable fixture so adding a word changes what the next fetch returns.
let inDeck: Set<string>;

const concepts = [
  { conceptId: "c1", position: 0, available: true, entries: [entry("en", "dog"), entry("nl", "hond", { article: "de" })] },
  { conceptId: "c2", position: 1, available: true, entries: [entry("en", "house"), entry("nl", "huis", { article: "het" })] },
  { conceptId: "c3", position: 2, available: true, entries: [entry("en", "water"), entry("nl", "water", { article: "het" })] },
  { conceptId: "c4", position: 3, available: false, entries: [entry("en", "orphan")] },
];

const packDetail = () => ({
  pack: { id: "p1", slug: "sample", name: "Sample pack", description: "Demo data" },
  concepts: concepts.map((c) => ({ ...c, inDeck: inDeck.has(c.conceptId) })),
});

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  inDeck = new Set(["c1"]);

  mock.handlers[`GET /packs?${EN_NL}`] = () =>
    json(200, {
      packs: [
        {
          id: "p1",
          slug: "sample",
          name: "Sample pack",
          description: "Demo data",
          conceptCount: 4,
          availableCount: 3,
          addedCount: inDeck.size,
        },
      ],
    });
  // Words are added both ways round, so the other direction has the same progress.
  mock.handlers[`GET /packs?${NL_EN}`] = () =>
    json(200, {
      packs: [
        {
          id: "p1",
          slug: "sample",
          name: "Sample pack",
          description: null,
          conceptCount: 4,
          availableCount: 3,
          addedCount: inDeck.size,
        },
      ],
    });
  mock.handlers[`GET /packs/p1?${EN_NL}&limit=1000`] = () => json(200, packDetail());
  mock.handlers["POST /concepts/c2/add"] = () => {
    inDeck.add("c2");
    return json(201, { added: 1, alreadyInDeck: 0 });
  };
  mock.handlers["POST /packs/p1/add"] = () => {
    inDeck.add("c2").add("c3");
    return json(200, { added: 2, alreadyInDeck: 1, unavailable: 1 });
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("pack list", () => {
  it("is reachable from the nav and shows progress for English to Dutch", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Add words" }));

    expect(await screen.findByRole("heading", { name: "Add words" })).toBeInTheDocument();
    expect(screen.queryByText("Add word packs or individual words to your deck")).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Sample pack" })).toBeInTheDocument();
    expect(screen.getByText(/1 of 3 words in your deck/)).toBeInTheDocument();
    expect(screen.getByText(/1 not available yet/)).toBeInTheDocument();
  });

  it("has no direction to choose: it is always English to Dutch", async () => {
    renderApp("/add-words");
    await screen.findByRole("link", { name: "Sample pack" });
    expect(screen.queryByRole("group", { name: "Study direction" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(mock.calls).toContain(`GET /packs?${EN_NL}`);
    expect(mock.calls).not.toContain(`GET /packs?${NL_EN}`);
  });

  it("ignores a direction left in the address by an old link", async () => {
    renderApp("/add-words?from=nl&to=en");
    expect(await screen.findByText(/1 of 3 words in your deck/)).toBeInTheDocument();
    expect(mock.calls).not.toContain(`GET /packs?${NL_EN}`);
  });

  it("filters packs by name or description as you type", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await screen.findByRole("link", { name: "Sample pack" });
    const box = screen.getByRole("searchbox", { name: "Search packs" });

    await user.type(box, "demo");
    expect(screen.getByRole("link", { name: "Sample pack" })).toBeInTheDocument();

    await user.clear(box);
    await user.type(box, "zebra");
    expect(screen.queryByRole("link", { name: "Sample pack" })).not.toBeInTheDocument();
    expect(screen.getByText(/No packs match/)).toBeInTheDocument();
  });

  describe("when no pack matches the search", () => {
    const posts: unknown[] = [];
    beforeEach(() => {
      posts.length = 0;
      mock.handlers["POST /reports"] = (body) => {
        posts.push(body);
        return json(201, { ok: true });
      };
    });
    const searchFor = async (term: string) => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await screen.findByRole("link", { name: "Sample pack" });
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), term);
      return user;
    };

    it("says so, and offers to request the pack, but not when something matches", async () => {
      const user = await searchFor("demo");
      expect(screen.queryByRole("button", { name: "Request this pack" })).not.toBeInTheDocument();

      await user.clear(screen.getByRole("searchbox", { name: "Search packs" }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "cooking verbs");
      expect(screen.getByText("No packs match “cooking verbs”")).toBeInTheDocument();
      expect(screen.getByText(/ask for the pack you were hoping to find/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Request this pack" })).toBeInTheDocument();
    });

    it("sends the request from here, starting from the search, with the details optional", async () => {
      const user = await searchFor("cooking verbs");
      await user.click(screen.getByRole("button", { name: "Request this pack" }));
      const form = screen.getByRole("form", { name: "Request a pack" });
      expect(within(form).getByLabelText("What pack would you like?")).toHaveValue("cooking verbs");
      // Only the name is needed: it can be sent as it is.
      await user.click(within(form).getByRole("button", { name: "Send request" }));
      await waitFor(() => expect(posts).toEqual([{ kind: "pack_request", title: "cooking verbs", note: "" }]));
      expect(await screen.findByText(/Your request is in/)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "See your reports" })).toHaveAttribute("href", "/reports");
    });

    it("lets the name be changed and details added", async () => {
      const user = await searchFor("cooking");
      await user.click(screen.getByRole("button", { name: "Request this pack" }));
      const form = screen.getByRole("form", { name: "Request a pack" });
      const name = within(form).getByLabelText("What pack would you like?");
      await user.type(name, " verbs");
      await user.type(within(form).getByLabelText(/Details/), "  Chop, stir, fry. ");
      await user.click(within(form).getByRole("button", { name: "Send request" }));
      await waitFor(() => expect(posts).toEqual([{ kind: "pack_request", title: "cooking verbs", note: "Chop, stir, fry." }]));
    });

    it("cannot be sent without a name, and can be cancelled", async () => {
      const user = await searchFor("cooking");
      await user.click(screen.getByRole("button", { name: "Request this pack" }));
      const form = within(screen.getByRole("form", { name: "Request a pack" }));
      await user.clear(form.getByLabelText("What pack would you like?"));
      expect(form.getByRole("button", { name: "Send request" })).toBeDisabled();
      await user.click(form.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("form", { name: "Request a pack" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Request this pack" })).toBeInTheDocument();
      expect(posts).toEqual([]);
    });

    it("starts afresh for a new search", async () => {
      const user = await searchFor("cooking");
      await user.click(screen.getByRole("button", { name: "Request this pack" }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), " verbs");
      expect(screen.queryByRole("form", { name: "Request a pack" })).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Request this pack" }));
      expect(screen.getByLabelText("What pack would you like?")).toHaveValue("cooking verbs");
    });
  });

  it("lists name matches before packs that only match in the description", async () => {
    const user = userEvent.setup();
    const pack = (id: string, name: string, description: string) => ({
      id, slug: id, name, description, conceptCount: 1, availableCount: 1, addedCount: 0,
    });
    mock.handlers[`GET /packs?${EN_NL}`] = () =>
      json(200, {
        packs: [
          pack("a", "Animals", "Includes a few things you eat, like fish"),
          pack("b", "Cooking", "Verbs for the kitchen"),
          pack("c", "Food", "Everyday food"),
          pack("d", "Fish and sea", "Sea life"),
        ],
      });
    renderApp("/add-words");
    await screen.findByRole("link", { name: "Cooking" });

    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "fish");

    const names = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(names).toEqual(["Fish and sea", "Animals"]);
  });

  it("shows an error when packs cannot be loaded", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () => json(500, { error: "boom" });
    renderApp("/add-words");
    expect(await screen.findByText(/Could not load packs/)).toBeInTheDocument();
  });
});

describe("navigation on a single pack's page", () => {
  const headOf = async () => {
    const dashboard = await screen.findByRole("link", { name: "Go to dashboard" });
    return dashboard.closest(".page-head") as HTMLElement;
  };

  it("has the buttons to the dashboard and the deck at the top right", async () => {
    renderApp("/add-words/p1");
    const head = await headOf();
    expect(head).toBeTruthy();
    const dashboard = within(head).getByRole("link", { name: "Go to dashboard" });
    const deck = within(head).getByRole("link", { name: "View deck" });
    expect(dashboard).toHaveAttribute("href", "/");
    expect(dashboard).toHaveClass("button");
    expect(deck).toHaveAttribute("href", "/deck");
    expect(dashboard.parentElement).toBe(deck.parentElement);
    expect(dashboard.parentElement).toHaveClass("page-head-actions");
    expect(head.lastElementChild).toContainElement(dashboard);
  });

  it("has Back to all packs as a button at the very top left, above the card of the pack", async () => {
    renderApp("/add-words/p1");
    const title = await screen.findByRole("heading", { name: "Sample pack", level: 1 });
    const back = await screen.findByRole("link", { name: "Back to all packs" });
    expect(back).toHaveAttribute("href", "/add-words");
    expect(back).toHaveClass("button", "secondary");
    // First thing in the page header, level with the buttons at the right, and before the pack's name.
    const head = back.closest(".page-head") as HTMLElement;
    expect(head.firstElementChild).toContainElement(back);
    expect(head.firstElementChild!.firstElementChild).toBe(back);
    expect(back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("← All packs")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "All packs" })).not.toBeInTheDocument();
  });

  it("has the name in the header, beside the page buttons, and the description and Add all inside the card with the words", async () => {
    renderApp("/add-words/p1");
    const title = await screen.findByRole("heading", { name: "Sample pack", level: 1 });
    // The name is under the way back, in the left of the header, level with the buttons at the right...
    const head = title.closest(".page-head") as HTMLElement;
    expect(head).toBeTruthy();
    expect(head.firstElementChild).toContainElement(title);
    expect(head.lastElementChild).toContainElement(screen.getByRole("link", { name: "Go to dashboard" }));
    // ...and so outside the card, which comes straight after the header.
    const card = head.nextElementSibling as HTMLElement;
    expect(card).toHaveClass("pack-page-card");
    expect(title.closest(".pack-page-card")).toBeNull();
    // The description, the button, and the words are inside.
    expect(within(card).getByText("Demo data")).toBeInTheDocument();
    expect(within(card).getByText("dog")).toBeInTheDocument();
    const add = within(card).getByRole("button", { name: "Add all to my deck" });
    const words = card.querySelector(".concept-list")!;
    expect(add.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Add all is on the same row as the description, after it, which the card's styles put at the right edge.
    const intro = card.querySelector(".pack-intro")!;
    expect(intro).toContainElement(screen.getByText("Demo data"));
    expect(intro).toContainElement(add);
    expect(screen.getByText("Demo data").compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(add.closest(".pack-actions")).toBeTruthy();
    // The card is named for the pack, for a screen reader.
    expect(card).toHaveAccessibleName("Sample pack");
    // The way back and the page buttons are outside it.
    expect(card).not.toContainElement(screen.getByRole("link", { name: "Back to all packs" }));
    expect(card).not.toContainElement(screen.getByRole("link", { name: "Go to dashboard" }));
  });

  it("takes you back to the list of packs", async () => {
    const user = userEvent.setup();
    renderApp("/add-words/p1");
    await user.click(await screen.findByRole("link", { name: "Back to all packs" }));
    expect(await screen.findByRole("heading", { name: "Add words", level: 1 })).toBeInTheDocument();
  });

  it("has Start studying above them, like the other pages", async () => {
    renderApp("/add-words/p1");
    const head = await headOf();
    const start = await within(head).findByRole("link", { name: /^Start studying/ });
    expect(start).toHaveAttribute("href", "/study");
    const actions = head.querySelector(".page-head-actions")!;
    expect(start.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("goes where the buttons say", async () => {
    const user = userEvent.setup();
    renderApp("/add-words/p1");
    await user.click(await screen.findByRole("link", { name: "Go to dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard", level: 1 })).toBeInTheDocument();
  });

  it("is still there when the pack is not found, with the way back to the list", async () => {
    mock.handlers[`GET /packs/nope?${EN_NL}&limit=1000`] = () => json(404, { error: "Pack not found" });
    renderApp("/add-words/nope");
    expect(await screen.findByText("That pack was not found.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "View deck" })).toHaveAttribute("href", "/deck");
    expect(screen.getByRole("link", { name: "Back to all packs" })).toHaveAttribute("href", "/add-words");
  });
});

describe("the way back to the dashboard", () => {
  it("has Go to dashboard and View deck buttons at the top right, level with the heading", async () => {
    renderApp("/add-words");
    const button = await screen.findByRole("link", { name: "Go to dashboard" });
    const deck = screen.getByRole("link", { name: "View deck" });
    expect(button).toHaveAttribute("href", "/");
    expect(deck).toHaveAttribute("href", "/deck");
    // Side by side in the page header, after the heading block, which the header lays out to the right.
    expect(button.parentElement).toBe(deck.parentElement);
    expect(button.nextElementSibling).toBe(deck);
    const actions = button.parentElement!;
    expect(actions).toHaveClass("page-head-actions");
    const head = actions.closest(".page-head")!;
    expect(head).toBeTruthy();
    expect(head.firstElementChild).toContainElement(screen.getByRole("heading", { name: "Add words" }));
    expect(head.lastElementChild).toContainElement(actions);
  });

  it("takes you to the deck", async () => {
    mock.handlers["GET /deck"] = () =>
      json(200, {
        summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 },
        hasMore: false,
        cards: [],
      });
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("link", { name: "View deck" }));
    expect(await screen.findByRole("heading", { name: "My deck" })).toBeInTheDocument();
  });

  it("goes to the dashboard", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("link", { name: "Go to dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});

describe("addresses", () => {
  it("lives at /add-words, with each pack under it", async () => {
    renderApp("/add-words");
    const link = await screen.findByRole("link", { name: "Sample pack" });
    expect(link).toHaveAttribute("href", "/add-words/p1");
  });

  it("links back from a pack to the list", async () => {
    renderApp("/add-words/p1");
    expect(await screen.findByRole("link", { name: "Back to all packs" })).toHaveAttribute("href", "/add-words");
  });

  it("sends the old /packs address to /add-words", async () => {
    renderApp("/packs?from=nl&to=en");
    expect(await screen.findByRole("heading", { name: "Add words" })).toBeInTheDocument();
    expect(await screen.findByText(/1 of 3 words in your deck/)).toBeInTheDocument();
  });

  it("sends an old pack address to the pack under /add-words", async () => {
    renderApp("/packs/p1?from=en&to=nl");
    expect(await screen.findByRole("heading", { name: "Sample pack" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to all packs" })).toHaveAttribute("href", "/add-words");
  });
});

describe("pack categories", () => {
  const pack = (id: string, name: string, category: string, extra: Record<string, unknown> = {}) => ({
    id,
    slug: id,
    name,
    description: null,
    category,
    conceptCount: 10,
    availableCount: 10,
    addedCount: 0,
    ...extra,
  });
  const packs = [
    pack("b2", "Dutch words 501–1000", "common"),
    pack("b3", "Dutch words 1001–1500", "common"),
    pack("b1", "Dutch words 1–500", "common"),
    pack("g1", "Prepositions", "grammar"),
    pack("v1", "Verbs: movement", "verbs"),
    pack("t1", "Food: the basics", "topic"),
    pack("t2", "Weather", "topic", { description: "Rain, sun, and snow" }),
  ];
  const names = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

  beforeEach(() => {
    mock.handlers[`GET /packs?${EN_NL}`] = () => json(200, { packs });
  });

  it("offers each category with its pack count, and All", async () => {
    renderApp("/add-words");
    const group = await screen.findByRole("group", { name: "Category" });
    const labels = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["All7", "Most common words3", "Topics2", "Verbs1", "Grammar words1"]);
    expect(within(group).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("counts only the packs the search finds, keeping every category on offer", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    const group = await screen.findByRole("group", { name: "Category" });
    const labels = () => within(group).getAllByRole("button").map((b) => b.textContent);

    // "Dutch" is in the name of the three frequency packs only.
    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "dutch");
    expect(labels()).toEqual(["All3", "Most common words3", "Topics0", "Verbs0", "Grammar words0"]);

    // "rain" is in one description.
    await user.clear(screen.getByRole("searchbox", { name: "Search packs" }));
    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "rain");
    expect(labels()).toEqual(["All1", "Most common words0", "Topics1", "Verbs0", "Grammar words0"]);

    // Nothing found: every count is 0, and the buttons are all still there.
    await user.clear(screen.getByRole("searchbox", { name: "Search packs" }));
    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "zebra");
    expect(labels()).toEqual(["All0", "Most common words0", "Topics0", "Verbs0", "Grammar words0"]);

    // Cleared: back to the totals.
    await user.clear(screen.getByRole("searchbox", { name: "Search packs" }));
    expect(labels()).toEqual(["All7", "Most common words3", "Topics2", "Verbs1", "Grammar words1"]);
  });

  describe("when the category chosen has no match but others do", () => {
    it("says so, counts the matches elsewhere, and shows them all on request", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "dutch");
      expect(document.querySelector(".empty-title")).toHaveTextContent("No packs in Topics match “dutch”");
      // The category's name is picked out from the rest of the sentence.
      expect(screen.getByText("Topics", { selector: ".category-name" })).toBeInTheDocument();
      expect(screen.getByText("3 packs match in other categories.")).toBeInTheDocument();
      // Not the offer to request a pack: it may well exist.
      expect(screen.queryByRole("button", { name: "Request this pack" })).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Show results in all categories" }));
      expect(names()).toEqual(["Dutch words 1–500", "Dutch words 501–1000", "Dutch words 1001–1500"]);
      expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("says \"1 pack matches\" for a single match", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "prepositions");
      expect(screen.getByText("1 pack matches in other categories.")).toBeInTheDocument();
    });

    it("still offers to request the pack when no category has a match", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "zebra");
      expect(screen.getByText("No packs match “zebra”")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Request this pack" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Show results in all categories" })).not.toBeInTheDocument();
    });
  });

  describe("the All filter flashing", () => {
    const search = (term: string) =>
      userEvent.type(screen.getByRole("searchbox", { name: "Search packs" }), term);
    const all = () => screen.getByRole("button", { name: /^All/ });

    it("flashes when the chosen category has no match but other categories do", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      expect(all()).not.toHaveClass("flash");
      // "dutch" is in the frequency packs, which are in Most common words, not in Topics.
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "dutch");
      expect(all()).toHaveClass("flash");
      // It is only a flash.
      await waitFor(() => expect(all()).not.toHaveClass("flash"), { timeout: 3000 });
    });

    it("does not flash when the chosen category has a match", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "rain");
      expect(all()).not.toHaveClass("flash");
    });

    it("does not flash when no category has a match", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "zebra");
      expect(all()).not.toHaveClass("flash");
    });

    it("does not flash when All is chosen, or when nothing has been searched for", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await screen.findByRole("button", { name: /^Topics/ });
      await search("dutch");
      expect(all()).not.toHaveClass("flash");
      await user.clear(screen.getByRole("searchbox", { name: "Search packs" }));
      await user.click(screen.getByRole("button", { name: /^Topics/ }));
      expect(all()).not.toHaveClass("flash");
    });

    it("flashes again when another category with no match is chosen", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.type(await screen.findByRole("searchbox", { name: "Search packs" }), "dutch");
      await user.click(screen.getByRole("button", { name: /^Topics/ }));
      expect(all()).toHaveClass("flash");
      await user.click(screen.getByRole("button", { name: /^Verbs/ }));
      expect(all()).toHaveClass("flash");
    });
  });

  it("counts the way the list is shown, so hiding packs already in the deck lowers the counts", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () =>
      json(200, { packs: packs.map((p) => (p.id === "t1" ? { ...p, addedCount: 10 } : p)) });
    const user = userEvent.setup();
    renderApp("/add-words");
    const group = await screen.findByRole("group", { name: "Category" });
    await user.click(screen.getByRole("button", { name: "Hide packs already in deck" }));
    const labels = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["All6", "Most common words3", "Topics1", "Verbs1", "Grammar words1"]);
  });

  it("shows only the chosen category, and all packs again on All", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: /^Topics/ }));
    expect(names()).toEqual(["Food: the basics", "Weather"]);
    expect(screen.getByRole("button", { name: /^Topics/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /^Grammar words/ }));
    expect(names()).toEqual(["Prepositions"]);

    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(names()).toHaveLength(7);
  });

  it("lists the frequency packs in number order, not letter order", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: /^Most common words/ }));
    expect(names()).toEqual(["Dutch words 1–500", "Dutch words 501–1000", "Dutch words 1001–1500"]);
  });

  it("combines the category with the search box", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: /^Topics/ }));
    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "rain");
    expect(names()).toEqual(["Weather"]);

    await user.clear(screen.getByRole("searchbox", { name: "Search packs" }));
    await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "verbs");
    // a verbs pack, but not a topic: the search is not empty, it is the category that has none
    expect(document.querySelector(".empty-title")).toHaveTextContent("No packs in Topics match “verbs”");
  });

  it("says so when everything in the category is already in the deck and hidden", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () =>
      json(200, { packs: packs.map((p) => (p.category === "verbs" ? { ...p, addedCount: 10 } : p)) });
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: /^Verbs/ }));
    await user.click(screen.getByRole("button", { name: "Hide packs already in deck" }));
    expect(screen.getByText("Every pack here is already in your deck.")).toBeInTheDocument();
  });

  it("does not offer the filter when every pack is in one category", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () => json(200, { packs: packs.filter((p) => p.category === "topic") });
    renderApp("/add-words");
    await screen.findByRole("link", { name: "Weather" });
    expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument();
  });

  describe("remembering the filters", () => {
    const goToDashboardAndBack = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("link", { name: "Dashboard" }));
      await screen.findByRole("heading", { name: "Dashboard" });
      await user.click(screen.getByRole("link", { name: "Add words" }));
      await screen.findByRole("heading", { name: "Add words" });
    };

    it("finds the category, search text, and hide toggle as they were after leaving and coming back", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.click(screen.getByRole("button", { name: "Hide packs already in deck" }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "rain");
      expect(names()).toEqual(["Weather"]);

      await goToDashboardAndBack(user);

      expect(await screen.findByRole("button", { name: /^Topics/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Hide packs already in deck" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("searchbox", { name: "Search packs" })).toHaveValue("rain");
      expect(names()).toEqual(["Weather"]);
    });

    it("remembers that you were searching for words", async () => {
      mock.handlers["GET /concepts/search"] = () => json(200, { concepts: [], hasMore: false });
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: "Words" }));
      await user.type(screen.getByRole("searchbox", { name: "Search words" }), "hond");

      await goToDashboardAndBack(user);

      expect(await screen.findByRole("button", { name: "Words" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("searchbox", { name: "Search words" })).toHaveValue("hond");
      // The results for the remembered text are fetched at once, without waiting for a pause.
      await waitFor(() => expect(mock.calls.some((c) => c.includes("/concepts/search?q=hond"))).toBe(true));
    });

    it("survives reloading the page", async () => {
      const user = userEvent.setup();
      const view = renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Verbs/ }));
      view.unmount();

      renderApp("/add-words");
      expect(await screen.findByRole("button", { name: /^Verbs/ })).toHaveAttribute("aria-pressed", "true");
      expect(names()).toEqual(["Verbs: movement"]);
    });

    it("starts clean the first time, and when what was remembered is no longer valid", async () => {
      sessionStorage.setItem("remembered:packs:category", JSON.stringify("bogus"));
      sessionStorage.setItem("remembered:packs:mode", JSON.stringify("nonsense"));
      sessionStorage.setItem("remembered:packs:query", "{not json");
      renderApp("/add-words");
      expect(await screen.findByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Packs" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("searchbox", { name: "Search packs" })).toHaveValue("");
      expect(names()).toHaveLength(7);
    });
  });

  it("is only for packs: the word search has no category filter", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await screen.findByRole("group", { name: "Category" });
    await user.click(screen.getByRole("button", { name: "Words" }));
    expect(screen.queryByRole("group", { name: "Category" })).not.toBeInTheDocument();
  });
});

describe("word search", () => {
  const word = (id: string, en: string, nl: string, inDeckNow = false) => ({
    conceptId: id,
    entries: [entry("en", en), entry("nl", nl, { article: "de" })],
    inDeck: inDeckNow,
  });
  const lastSearch = () => mock.calls.filter((c) => c.startsWith("GET /concepts/search")).at(-1)!;

  async function openWords(user: ReturnType<typeof userEvent.setup>) {
    renderApp("/add-words");
    await screen.findByRole("link", { name: "Sample pack" });
    await user.click(screen.getByRole("button", { name: "Words" }));
    return screen.getByRole("searchbox", { name: "Search words" });
  }

  it("asks for a longer term, then lists matches and adds one", async () => {
    const user = userEvent.setup();
    let added = false;
    mock.handlers["GET /concepts/search"] = () =>
      json(200, { concepts: [word("c9", "dog", "hond", added)], hasMore: false });
    mock.handlers["POST /concepts/c9/add"] = () => {
      added = true;
      return json(201, { added: 1, alreadyInDeck: 0 });
    };

    const box = await openWords(user);
    expect(screen.getByText(/at least two letters/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sample pack" })).not.toBeInTheDocument();

    await user.type(box, "hond");
    expect(await screen.findByText("de hond")).toBeInTheDocument();
    expect(lastSearch()).toContain("q=hond");

    await user.click(screen.getByRole("button", { name: "Add dog to my deck" }));
    expect(await screen.findByText("In deck")).toBeInTheDocument();
  });

  it("keeps a word you just added while hiding added results, until the filter changes", async () => {
    const user = userEvent.setup();
    let added = false;
    mock.handlers["GET /concepts/search"] = () =>
      json(200, { concepts: added ? [] : [word("c9", "dog", "hond")], hasMore: false });
    mock.handlers["POST /concepts/c9/add"] = () => {
      added = true;
      return json(201, { added: 1, alreadyInDeck: 0 });
    };

    const box = await openWords(user);
    await user.click(screen.getByRole("button", { name: "Hide words already in deck" }));
    await user.type(box, "hond");
    await user.click(await screen.findByRole("button", { name: "Add dog to my deck" }));

    expect(lastSearch()).toContain("hideInDeck=1");
    expect(await screen.findByText("In deck")).toBeInTheDocument();
    // The server no longer returns it, but it stays put.
    expect(screen.getByText("de hond")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide words already in deck" }));
    await user.click(screen.getByRole("button", { name: "Hide words already in deck" }));
    await waitFor(() => expect(screen.queryByText("de hond")).not.toBeInTheDocument());
  });

  it("loads more matches on request", async () => {
    const user = userEvent.setup();
    mock.handlers["GET /concepts/search"] = () =>
      lastSearch().includes("offset=0")
        ? json(200, { concepts: [word("c1", "do", "doen")], hasMore: true })
        : json(200, { concepts: [word("c2", "dog", "hond")], hasMore: false });

    const box = await openWords(user);
    await user.type(box, "do");
    expect(await screen.findByText("de doen")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more matches" }));
    expect(await screen.findByText("de hond")).toBeInTheDocument();
    expect(screen.getByText("de doen")).toBeInTheDocument();
    expect(lastSearch()).toContain("offset=50");
    expect(screen.queryByRole("button", { name: "Load more matches" })).not.toBeInTheDocument();
  });
});

describe("pack detail", () => {
  it("lists words with articles and per-word status", async () => {
    renderApp(`/add-words/p1`);
    expect(await screen.findByRole("heading", { name: "Sample pack" })).toBeInTheDocument();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveTextContent("dog→de hond");
    expect(within(items[0]!).getByText("In deck")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("house→het huis");
    expect(within(items[1]!).getByRole("button", { name: "Add house to my deck" })).toBeInTheDocument();
    expect(items[3]).toHaveTextContent("orphan→—");
    expect(within(items[3]!).getByText("Not available yet")).toBeInTheDocument();
  });

  it("adds a single word in both directions, and updates its status", async () => {
    const bodies: unknown[] = [];
    mock.handlers["POST /concepts/c2/add"] = (b) => {
      bodies.push(b);
      inDeck.add("c2");
      return json(201, { added: 2, alreadyInDeck: 0 });
    };
    const user = userEvent.setup();
    renderApp(`/add-words/p1`);
    await user.click(await screen.findByRole("button", { name: "Add house to my deck" }));

    expect(bodies).toEqual([{ fromLanguage: "en", toLanguage: "nl", bothDirections: true }]);
    const house = (await screen.findAllByRole("listitem"))[1]!;
    expect(await within(house).findByText("In deck")).toBeInTheDocument();
  });

  it("adds the whole pack in both directions and reports what happened", async () => {
    const bodies: unknown[] = [];
    mock.handlers["POST /packs/p1/add"] = (b) => {
      bodies.push(b);
      inDeck.add("c2").add("c3");
      return json(200, { added: 4, alreadyInDeck: 2, unavailable: 1 });
    };
    const user = userEvent.setup();
    renderApp(`/add-words/p1`);
    await user.click(await screen.findByRole("button", { name: "Add all to my deck" }));

    // The spinner holds the request for a moment, so wait for the message itself.
    expect(await screen.findByText(/Added 4 new cards/)).toHaveTextContent(
      "Added 4 new cards. 2 already in your deck. 1 not available yet.",
    );
    expect(bodies).toEqual([{ fromLanguage: "en", toLanguage: "nl", bothDirections: true }]);
    expect(await screen.findByRole("button", { name: "All words added" })).toBeDisabled();
  });

  it("has no separate button for the reverse direction", async () => {
    renderApp(`/add-words/p1`);
    await screen.findByRole("button", { name: "Add all to my deck" });
    expect(screen.queryByRole("button", { name: /reverse/i })).not.toBeInTheDocument();
  });

  it("is only done once both directions are in the deck", async () => {
    const pack = (added: number, available = 3) => ({
      packs: [{ id: "p1", slug: "sample", name: "Sample pack", description: null, conceptCount: 4, availableCount: available, addedCount: added }],
    });
    // English to Dutch is complete, but the other way round is missing a word: there is still work to do.
    mock.handlers[`GET /packs?${EN_NL}`] = () => json(200, pack(3));
    mock.handlers[`GET /packs?${NL_EN}`] = () => json(200, pack(2));
    const view = renderApp(`/add-words/p1`);
    expect(await screen.findByRole("button", { name: "Add all to my deck" })).toBeEnabled();
    view.unmount();

    mock.handlers[`GET /packs?${NL_EN}`] = () => json(200, pack(3));
    const done = renderApp(`/add-words/p1`);
    expect(await screen.findByRole("button", { name: "All words added" })).toBeDisabled();
    done.unmount();

    mock.handlers[`GET /packs?${EN_NL}`] = () => json(200, pack(0, 0));
    renderApp(`/add-words/p1`);
    await waitFor(() => expect(screen.getByRole("button", { name: "Add all to my deck" })).toBeDisabled());
  });

  it("explains when the pack does not exist", async () => {
    mock.handlers[`GET /packs/nope?${EN_NL}&limit=1000`] = () =>
      json(404, { error: "Pack not found" });
    renderApp(`/add-words/nope`);
    expect(await screen.findByText("That pack was not found.")).toBeInTheDocument();
  });

  it("shows every word of a large pack at once", async () => {
    const page = (start: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        conceptId: `w${start + i}`,
        position: start + i,
        available: true,
        inDeck: false,
        entries: [entry("en", `word${start + i}`), entry("nl", `woord${start + i}`)],
      }));
    const pack = { id: "p1", slug: "sample", name: "Sample pack", description: null };
    mock.handlers[`GET /packs/p1?${EN_NL}&limit=1000`] = () =>
      json(200, { pack, concepts: page(0, 53) });

    renderApp(`/add-words/p1`);
    expect(await screen.findByText("word52")).toBeInTheDocument();
    expect(screen.getByText("word0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});

describe("dashboard link", () => {
  it("points new users with an empty deck to the packs", async () => {
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 } });
    mock.handlers["GET /study/counts"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Browse words" })).toHaveAttribute("href", "/add-words");
  });
});

describe("looking at a word as a card", () => {
  const detail = (conceptId: string, front: unknown[], back: unknown[], sentences = { front: [] as string[], back: [] as string[] }) => ({
    conceptId,
    fromLanguage: "en",
    toLanguage: "nl",
    front,
    back,
    sentences,
  });
  const dogCard = () =>
    detail(
      "c1",
      [entry("en", "dog", { plural: "dogs" })],
      [entry("nl", "hond", { article: "de", plural: "honden" })],
      { front: ["The dog barks.", "I walk the dog."], back: ["De hond blaft."] },
    );

  beforeEach(() => {
    mock.handlers[`GET /concepts/c1?${EN_NL}`] = () => json(200, dogCard());
    mock.handlers[`GET /concepts/c2?${EN_NL}`] = () =>
      json(200, detail("c2", [entry("en", "house")], [entry("nl", "huis", { article: "het" })]));
    mock.handlers[`GET /concepts/c4?${EN_NL}`] = () => json(200, detail("c4", [entry("en", "orphan")], []));
  });

  const open = async (user: ReturnType<typeof userEvent.setup>, name = "Open card: dog") => {
    await user.click(await screen.findByRole("button", { name }));
    return screen.findByRole("dialog");
  };

  describe("on a pack", () => {
    it("opens the card, English to Dutch, with its sentences and forms", async () => {
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      const dialog = await open(user);

      expect(dialog).toHaveAccessibleName("Card: dog");
      expect(within(dialog).getByText("English → Nederlands")).toBeInTheDocument();
      const front = within(within(dialog).getByRole("region", { name: "Front" }));
      expect(front.getByRole("img", { name: "English" })).toBeInTheDocument();
      expect(await front.findByText(sentence("The dog barks."))).toBeInTheDocument();
      expect(front.getByText(sentence("I walk the dog."))).toBeInTheDocument();
      expect(front.getByText("dogs")).toBeInTheDocument();
      const back = within(within(dialog).getByRole("region", { name: "Back" }));
      expect(back.getByText("de hond")).toBeInTheDocument();
      expect(back.getByText(sentence("De hond blaft."))).toBeInTheDocument();
      expect(back.getByText("honden")).toBeInTheDocument();
    });

    it("has no deck status, since the word may not be in the deck", async () => {
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      const dialog = await open(user, "Open card: house");
      expect(await within(dialog).findByText("No example sentences yet.")).toBeInTheDocument();
      expect(within(dialog).queryByLabelText("Where this card stands")).not.toBeInTheDocument();
      expect(within(dialog).queryByText("Status")).not.toBeInTheDocument();
    });

    it("shows the words straight away, and says so if the sentences cannot be loaded", async () => {
      mock.handlers[`GET /concepts/c1?${EN_NL}`] = () => json(500, { error: "boom" });
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      const dialog = await open(user);
      expect(within(dialog).getByText("de hond")).toBeInTheDocument();
      expect(await within(dialog).findByText("Could not load the example sentences.")).toBeInTheDocument();
    });

    it("opens a word that has no Dutch yet, with an empty back", async () => {
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      const dialog = await open(user, "Open card: orphan");
      expect(dialog).toHaveAccessibleName("Card: orphan");
      // The front shows the word; the back has nothing to show yet.
      expect(within(dialog).getByRole("region", { name: "Front" })).toHaveTextContent("orphan");
      expect(within(dialog).getByRole("region", { name: "Back" }).textContent).toBe("");
    });

    it("closes with Escape or Close, and focus goes back to the word", async () => {
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      await open(user);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Open card: dog" })).toHaveFocus();

      await open(user, "Open card: house");
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("is not opened by the Add button, which is its own control", async () => {
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      await user.click(await screen.findByRole("button", { name: "Add house to my deck" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("lets you report a problem with the word", async () => {
      const reports: unknown[] = [];
      mock.handlers["POST /concepts/c1/report"] = (body) => {
        reports.push(body);
        return json(201, { ok: true });
      };
      const user = userEvent.setup();
      renderApp("/add-words/p1");
      const dialog = await open(user);
      await user.click(within(dialog).getByRole("button", { name: "Report a problem" }));
      await user.click(within(dialog).getByRole("button", { name: "Send report" }));
      expect(await within(dialog).findByText("Thanks! We’ll take a look.")).toBeInTheDocument();
      expect(reports).toEqual([{ fromLanguage: "en", toLanguage: "nl", reason: "translation", note: "" }]);
    });
  });

  describe("in word search results", () => {
    it("opens the card for a result", async () => {
      mock.handlers["GET /concepts/search"] = () =>
        json(200, {
          concepts: [{ conceptId: "c1", entries: [entry("en", "dog"), entry("nl", "hond", { article: "de" })], inDeck: false }],
          hasMore: false,
        });
      const user = userEvent.setup();
      renderApp("/add-words");
      await screen.findByRole("link", { name: "Sample pack" });
      await user.click(screen.getByRole("button", { name: "Words" }));
      await user.type(screen.getByRole("searchbox", { name: "Search words" }), "hond");

      const dialog = await open(user);
      expect(dialog).toHaveAccessibleName("Card: dog");
      expect(await within(dialog).findByText(sentence("De hond blaft."))).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});

describe("the explainer on the Add words page", () => {
  let seen: boolean;
  let patches: unknown[];
  const settings = () => ({
    email: "ann@example.com",
    name: null,
    timezone: "UTC",
    dailyNewCardLimit: 20,
    showSentences: true,
    showForms: true,
    addWordsIntroSeen: seen,
  });

  beforeEach(() => {
    seen = false;
    patches = [];
    mock.handlers["GET /settings"] = () => json(200, settings());
    mock.handlers["PATCH /settings"] = (body) => {
      patches.push(body);
      seen = (body as { addWordsIntroSeen?: boolean }).addWordsIntroSeen ?? seen;
      return json(200, settings());
    };
  });

  it("explains adding words the first time, in place of the page", async () => {
    renderApp("/add-words");
    const intro = await screen.findByRole("region", { name: "How adding words works" });
    expect(intro).toHaveTextContent("pre-made packs");
    expect(intro).toHaveTextContent("individual words");
    expect(intro).toHaveTextContent("Adding a word adds two cards:");
    expect(within(intro).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "The forward direction tests your ability to produce a word on command.",
      "The reverse direction tests your ability to recognize a word when you see it.",
    ]);
    expect(intro).toHaveTextContent("completely independent flashcards");
    expect(intro).not.toHaveTextContent("food"); // no examples of packs
    expect(within(intro).getByRole("button", { name: "Got it" })).toBeInTheDocument();
    // Nothing else of the page is there to use until it has been read.
    expect(screen.queryByRole("heading", { name: "Add words" })).not.toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sample pack" })).not.toBeInTheDocument();
  });

  it("shows the page itself after Got it", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: "Got it" }));
    expect(await screen.findByRole("heading", { name: "Add words" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Sample pack" })).toBeInTheDocument();
  });

  it("goes away at once on Got it, and is saved for the account", async () => {
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "How adding words works" })).not.toBeInTheDocument();
    await waitFor(() => expect(patches).toEqual([{ addWordsIntroSeen: true }]));
  });

  it("is not shown again once dismissed, however the page is reached", async () => {
    const user = userEvent.setup();
    const view = renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: "Got it" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    view.unmount();

    renderApp("/add-words");
    await screen.findByRole("searchbox", { name: "Search packs" });
    expect(screen.queryByRole("region", { name: "How adding words works" })).not.toBeInTheDocument();
  });

  it("is not shown to someone who has already dismissed it", async () => {
    seen = true;
    renderApp("/add-words");
    await screen.findByRole("searchbox", { name: "Search packs" });
    expect(screen.queryByRole("button", { name: "Got it" })).not.toBeInTheDocument();
  });

  it("also stands in for a pack's page, which the dashboard links to directly", async () => {
    const user = userEvent.setup();
    renderApp("/add-words/p1");
    expect(await screen.findByRole("region", { name: "How adding words works" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sample pack", level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add all to my deck" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Got it" }));
    // Then the pack the link was for, not the list of packs.
    expect(await screen.findByRole("heading", { name: "Sample pack", level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(patches).toEqual([{ addWordsIntroSeen: true }]));
  });

  it("comes back if saving the dismissal fails, so it is not lost silently", async () => {
    mock.handlers["PATCH /settings"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: "Got it" }));
    expect(await screen.findByRole("region", { name: "How adding words works" })).toBeInTheDocument();
  });
});
