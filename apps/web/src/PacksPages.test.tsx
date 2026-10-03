import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

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
    expect(screen.getByText("Add word packs or individual words to your deck")).toBeInTheDocument();
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
    const head = actions.parentElement!;
    expect(head).toHaveClass("page-head");
    expect(head.firstElementChild).toContainElement(screen.getByRole("heading", { name: "Add words" }));
    expect(head.lastElementChild).toBe(actions);
  });

  it("takes you to the deck", async () => {
    mock.handlers["GET /deck"] = () =>
      json(200, {
        summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 },
        hasMore: false,
        mirrorable: 0,
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
    expect(await screen.findByRole("link", { name: "← All packs" })).toHaveAttribute("href", "/add-words");
  });

  it("sends the old /packs address to /add-words", async () => {
    renderApp("/packs?from=nl&to=en");
    expect(await screen.findByRole("heading", { name: "Add words" })).toBeInTheDocument();
    expect(await screen.findByText(/1 of 3 words in your deck/)).toBeInTheDocument();
  });

  it("sends an old pack address to the pack under /add-words", async () => {
    renderApp("/packs/p1?from=en&to=nl");
    expect(await screen.findByRole("heading", { name: "Sample pack" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← All packs" })).toHaveAttribute("href", "/add-words");
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
    pack("t2", "Weather", "topic", { description: "Rain, sun and snow" }),
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
    expect(screen.getByText(/No packs match “verbs”/)).toBeInTheDocument(); // a verbs pack, but not a topic
  });

  it("says so when everything in the category is already in the deck and hidden", async () => {
    mock.handlers[`GET /packs?${EN_NL}`] = () =>
      json(200, { packs: packs.map((p) => (p.category === "verbs" ? { ...p, addedCount: 10 } : p)) });
    const user = userEvent.setup();
    renderApp("/add-words");
    await user.click(await screen.findByRole("button", { name: /^Verbs/ }));
    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
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

    it("finds the category, search text and hide toggle as they were after leaving and coming back", async () => {
      const user = userEvent.setup();
      renderApp("/add-words");
      await user.click(await screen.findByRole("button", { name: /^Topics/ }));
      await user.click(screen.getByRole("button", { name: "Hide already added results" }));
      await user.type(screen.getByRole("searchbox", { name: "Search packs" }), "rain");
      expect(names()).toEqual(["Weather"]);

      await goToDashboardAndBack(user);

      expect(await screen.findByRole("button", { name: /^Topics/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Hide already added results" })).toHaveAttribute("aria-pressed", "true");
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
    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
    await user.type(box, "hond");
    await user.click(await screen.findByRole("button", { name: "Add dog to my deck" }));

    expect(lastSearch()).toContain("hideInDeck=1");
    expect(await screen.findByText("In deck")).toBeInTheDocument();
    // The server no longer returns it, but it stays put.
    expect(screen.getByText("de hond")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
    await user.click(screen.getByRole("button", { name: "Hide already added results" }));
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
      expect(await front.findByText("The dog barks.")).toBeInTheDocument();
      expect(front.getByText("I walk the dog.")).toBeInTheDocument();
      expect(front.getByText("dogs")).toBeInTheDocument();
      const back = within(within(dialog).getByRole("region", { name: "Back" }));
      expect(back.getByText("de hond")).toBeInTheDocument();
      expect(back.getByText("De hond blaft.")).toBeInTheDocument();
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
      expect(await within(dialog).findByText("De hond blaft.")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
