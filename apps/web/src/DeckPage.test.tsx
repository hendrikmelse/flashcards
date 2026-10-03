import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: "noun",
  details,
});

const card = (id: string, en: string, nl: string, extra: Record<string, unknown> = {}) => ({
  id,
  conceptId: `c-${id}`,
  fromLanguage: "en",
  toLanguage: "nl",
  state: "new",
  dueAt: at(0),
  addedAt: at(-DAY),
  intervalDays: 0,
  lapses: 0,
  lastReviewedAt: null,
  hasMirror: true,
  front: [entry("en", en)],
  back: [entry("nl", nl, { article: "de" })],
  ...extra,
});

const summary = { total: 12, new: 5, learning: 2, relearning: 1, review: 4, dueNow: 3 };
const lastList = () => mock.calls.filter((c) => c.startsWith("GET /deck?limit=50")).at(-1)!;

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  localStorage.removeItem("dashboardDirection");
  mock.handlers["GET /deck"] = () =>
    json(200, {
      summary,
      hasMore: false,
      cards: [
        card("a", "dog", "hond"),
        card("b", "house", "huis", { state: "review", dueAt: at(3 * DAY + 3_600_000), intervalDays: 12, lapses: 2 }),
        card("c", "water", "water", { state: "learning", dueAt: at(-60_000) }),
        card("d", "cat", "kat", { state: "relearning", dueAt: at(-60_000), lapses: 1 }),
      ],
    });
});
afterEach(() => vi.unstubAllGlobals());

describe("dashboard link", () => {
  it("has a button that opens the deck", async () => {
    renderApp("/");
    expect(await screen.findByRole("link", { name: "View deck" })).toHaveAttribute("href", "/deck");
  });
});

describe("looking at a card in full", () => {
  const dogCard = () =>
    card("a", "dog", "hond", {
      state: "review",
      dueAt: at(3 * DAY + 3_600_000),
      intervalDays: 12,
      lapses: 2,
      front: [entry("en", "dog", { plural: "dogs" })],
      back: [entry("nl", "hond", { article: "de", plural: "honden" })],
    });
  const houseCard = () => card("b", "house", "huis", { hasMirror: false });
  const sentences = { front: ["The dog barks.", "I walk the dog.", "A big dog."], back: ["De hond blaft."] };

  beforeEach(() => {
    mock.handlers["GET /deck"] = () =>
      json(200, { summary, hasMore: false, mirrorable: 1, cards: [dogCard(), houseCard()] });
    mock.handlers["GET /deck/a"] = () => json(200, { card: dogCard(), sentences });
    mock.handlers["GET /deck/b"] = () => json(200, { card: houseCard(), sentences: { front: [], back: [] } });
  });
  afterEach(() => {
    document.body.style.overflow = "";
  });

  const open = async (user: ReturnType<typeof userEvent.setup>, name = "Open card: dog") => {
    await user.click(await screen.findByRole("button", { name }));
    return screen.findByRole("dialog");
  };

  it("opens the card when you click it, showing both sides with their flags", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);

    expect(dialog).toHaveAccessibleName("Card: dog");
    const front = within(within(dialog).getByRole("region", { name: "Front" }));
    expect(front.getByText("dog")).toBeInTheDocument();
    expect(front.getByRole("img", { name: "English" })).toBeInTheDocument();
    const back = within(within(dialog).getByRole("region", { name: "Back" }));
    expect(back.getByText("de hond")).toBeInTheDocument();
    expect(back.getByRole("img", { name: "Nederlands" })).toBeInTheDocument();
    expect(within(dialog).getByText("English → Nederlands")).toBeInTheDocument();
  });

  it("shows every example sentence, each on its own side", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);
    const front = within(within(dialog).getByRole("region", { name: "Front" }));
    expect(await front.findByText("The dog barks.")).toBeInTheDocument();
    expect(front.getByText("I walk the dog.")).toBeInTheDocument();
    expect(front.getByText("A big dog.")).toBeInTheDocument();
    const back = within(within(dialog).getByRole("region", { name: "Back" }));
    expect(back.getByText("De hond blaft.")).toBeInTheDocument();
    expect(back.queryByText("The dog barks.")).not.toBeInTheDocument();
  });

  it("shows the word forms on both sides", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);
    const front = within(within(dialog).getByRole("region", { name: "Front" }));
    expect(front.getByText("dogs")).toBeInTheDocument(); // the English plural, not hidden as it is in a study session
    const back = within(within(dialog).getByRole("region", { name: "Back" }));
    expect(back.getByText("honden")).toBeInTheDocument();
  });

  it("shows where the card stands", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);
    const facts = within(within(dialog).getByLabelText("Where this card stands"));
    expect(facts.getByText("Status").nextSibling).toHaveTextContent("Review");
    expect(facts.getByText("Due").nextSibling).toHaveTextContent("in 3 days");
    expect(facts.getByText("Added")).toBeInTheDocument();
    // How long the gap is and how often it was forgotten are not shown: the card has both (12 days, 2 lapses).
    expect(facts.queryByText("Interval")).not.toBeInTheDocument();
    expect(facts.queryByText("Forgotten")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/lapse|forgot|interval|12/i)).not.toBeInTheDocument();
  });

  it("says so for a card that has not been studied", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user, "Open card: house");
    const facts = within(dialog);
    expect(facts.getByText("Status").nextSibling).toHaveTextContent("New");
    expect(facts.getByText("Due").nextSibling).toHaveTextContent("Not studied yet");
    expect(facts.queryByText("Forgotten")).not.toBeInTheDocument();
    expect(await facts.findByText("No example sentences yet.")).toBeInTheDocument();
  });

  it("shows the words straight away, and says so if the sentences cannot be loaded", async () => {
    mock.handlers["GET /deck/a"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);
    expect(within(dialog).getByText("de hond")).toBeInTheDocument();
    expect(await within(dialog).findByText("Could not load the example sentences.")).toBeInTheDocument();
    expect(within(dialog).queryByText("The dog barks.")).not.toBeInTheDocument();
  });

  it("shows the sentences whatever the study card settings say", async () => {
    mock.handlers["GET /settings"] = () =>
      json(200, { email: "a@b.c", name: null, timezone: "UTC", dailyNewCardLimit: 20, showSentences: false, showForms: false });
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);
    expect(await within(dialog).findByText("The dog barks.")).toBeInTheDocument();
    expect(within(dialog).getByText("honden")).toBeInTheDocument();
  });

  it("closes with the Close button, and focus goes back to the card", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await open(user);
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open card: dog" })).toHaveFocus();
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when you click outside it, but not when you click inside", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const dialog = await open(user);
    await user.click(within(dialog).getByText("English → Nederlands"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(dialog.parentElement!); // the dimmed area around it
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps keyboard focus inside while it is open", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await open(user);
    await user.tab();
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    await user.tab({ shift: true });
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
  });

  it("can be opened from the keyboard", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    (await screen.findByRole("button", { name: "Open card: dog" })).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("stops the page behind it from scrolling, and lets it again afterwards", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await open(user);
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });

  it("is not opened by the Add reverse button, which is its own control", async () => {
    mock.handlers["POST /concepts/c-b/add"] = () => json(201, { added: 1, alreadyInDeck: 0 });
    const user = userEvent.setup();
    renderApp("/deck");
    await user.click(await screen.findByRole("button", { name: "Add reverse of house" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a different card when another is chosen", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await open(user);
    await user.keyboard("{Escape}");
    const dialog = await open(user, "Open card: house");
    expect(dialog).toHaveAccessibleName("Card: house");
    expect(within(dialog).getByText("de huis")).toBeInTheDocument();
  });
});

describe("deck page", () => {
  it("is reachable from My deck in the main navigation, which is highlighted while there", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "My deck" })).not.toHaveClass("active");

    await user.click(within(nav).getByRole("link", { name: "My deck" }));
    expect(await screen.findByRole("heading", { name: "My deck" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "My deck" })).toHaveClass("active");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveClass("active");
  });

  it("lists each card with its status and when it is due", async () => {
    renderApp("/deck");
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("dog→de hond");
    expect(rows[0]).toHaveTextContent("New");
    expect(rows[0]).toHaveTextContent("Not studied yet");
    expect(rows[1]).toHaveTextContent("Review");
    expect(rows[1]).toHaveTextContent("Due in 3 days");
    // Nothing about intervals or how often a word was forgotten (this card has 12 days and 2 lapses).
    expect(rows[1]).not.toHaveTextContent(/interval|lapse|12 days/i);
    expect(rows[2]).toHaveTextContent("Learning");
    expect(rows[2]).toHaveTextContent("Due now");
    expect(rows[3]).toHaveTextContent("Relearning");
    expect(rows[3]).not.toHaveTextContent(/lapse/i);
    expect(screen.getByText("12 cards")).toBeInTheDocument();
  });

  it("has Go to dashboard and Add more words as buttons together at the top right", async () => {
    renderApp("/deck");
    const back = await screen.findByRole("link", { name: "Go to dashboard" });
    const add = screen.getByRole("link", { name: "Add more words" });
    expect(back).toHaveAttribute("href", "/");
    expect(back).toHaveClass("button");
    expect(add).toHaveClass("button");
    // Side by side in the page header, Back first.
    expect(back.parentElement).toBe(add.parentElement);
    expect(back.parentElement).toHaveClass("page-head-actions");
    expect(back.nextElementSibling).toBe(add);
    expect(back.parentElement?.parentElement).toHaveClass("page-head");
    // The old text link above the heading is gone.
    expect(screen.queryByRole("link", { name: "← Dashboard" })).not.toBeInTheDocument();
  });

  it("keeps Go to dashboard when the deck is empty", async () => {
    mock.handlers["GET /deck"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 }, hasMore: false, cards: [] });
    renderApp("/deck");
    expect(await screen.findByRole("link", { name: "Go to dashboard" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Add more words" })).not.toBeInTheDocument();
  });

  it("has a button to add more words", async () => {
    renderApp("/deck");
    expect(await screen.findByRole("link", { name: "Add more words" })).toHaveAttribute("href", "/add-words");
  });

  it("shows how many cards are in each stage, counting relearning as learning", async () => {
    renderApp("/deck");
    const stages = await screen.findByRole("group", { name: "Status" });
    expect(within(stages).getByRole("button", { name: /All/ })).toHaveTextContent("12");
    expect(within(stages).getByRole("button", { name: /New/ })).toHaveTextContent("5");
    expect(within(stages).getByRole("button", { name: /Learning/ })).toHaveTextContent("3");
    expect(within(stages).getByRole("button", { name: /Review/ })).toHaveTextContent("4");
  });

  it("filters by stage, soonest due first for studied stages", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.click(await screen.findByRole("button", { name: /Review/ }));
    await screen.findAllByRole("listitem");
    expect(lastList()).toContain("state=review");
    expect(lastList()).toContain("sort=due&order=asc");

    await user.click(screen.getByRole("button", { name: /New/ }));
    await screen.findAllByRole("listitem");
    expect(lastList()).toContain("state=new");
    expect(lastList()).toContain("sort=added&order=desc");
  });

  it("starts newest first, and lets you pick another sort", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const select = await screen.findByRole("combobox", { name: "Sort by" });
    expect(select).toHaveValue("added");
    expect(lastList()).toContain("sort=added&order=desc");

    for (const [value, order] of [
      ["due", "asc"],
      ["status", "asc"],
      ["alpha", "asc"],
    ] as const) {
      await user.selectOptions(select, value);
      await vi.waitFor(() => expect(lastList()).toContain(`sort=${value}&order=${order}`));
    }
  });

  it("reverses the order, and goes back to the natural order when the sort changes", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    const select = await screen.findByRole("combobox", { name: "Sort by" });
    await user.selectOptions(select, "status");
    await user.click(await screen.findByRole("button", { name: /Reverse order, currently New to review/ }));
    await vi.waitFor(() => expect(lastList()).toContain("sort=status&order=desc"));
    expect(screen.getByRole("button", { name: /currently Review to new/ })).toBeInTheDocument();

    await user.selectOptions(select, "alpha");
    await vi.waitFor(() => expect(lastList()).toContain("sort=alpha&order=asc"));
    expect(screen.getByRole("button", { name: /currently A to Z/ })).toBeInTheDocument();
  });

  it("keeps a sort you chose when the stage changes", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.selectOptions(await screen.findByRole("combobox", { name: "Sort by" }), "alpha");
    await user.click(screen.getByRole("button", { name: /Review/ }));
    await vi.waitFor(() => expect(lastList()).toContain("state=review"));
    expect(lastList()).toContain("sort=alpha");
  });

  describe("remembering the filters", () => {
    const leaveAndReturn = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole("link", { name: "Go to dashboard" }));
      await user.click(await screen.findByRole("link", { name: "View deck" }));
      await screen.findByRole("heading", { name: "My deck" });
    };

    it("finds the stage, search, sort and missing-reverse filter as they were", async () => {
      const user = userEvent.setup();
      renderApp("/deck");
      await user.click(await screen.findByRole("button", { name: /^Review/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search your deck" }), "hu");
      await user.selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "alpha");
      await user.click(screen.getByRole("button", { name: /Reverse order/ })); // A to Z becomes Z to A
      await user.click(screen.getByRole("button", { name: "Missing reverse" }));
      await vi.waitFor(() => expect(lastList()).toContain("missingMirror=1"));

      await leaveAndReturn(user);

      expect(await screen.findByRole("button", { name: /^Review/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("searchbox", { name: "Search your deck" })).toHaveValue("hu");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("alpha");
      expect(screen.getByRole("button", { name: /currently Z to A/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Missing reverse" })).toHaveAttribute("aria-pressed", "true");
      // And the list is asked for with them straight away.
      await vi.waitFor(() => {
        expect(lastList()).toContain("state=review");
        expect(lastList()).toContain("q=hu");
        expect(lastList()).toContain("sort=alpha&order=desc");
        expect(lastList()).toContain("missingMirror=1");
      });
    });

    it("keeps the default sort for a stage until a sort is chosen", async () => {
      const user = userEvent.setup();
      renderApp("/deck");
      await user.click(await screen.findByRole("button", { name: /^Learning/ }));
      await leaveAndReturn(user);
      expect(await screen.findByRole("button", { name: /^Learning/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("due"); // the stage's own default
    });

    it("survives reloading the page", async () => {
      const user = userEvent.setup();
      const view = renderApp("/deck");
      await user.click(await screen.findByRole("button", { name: /^New/ }));
      view.unmount();
      renderApp("/deck");
      expect(await screen.findByRole("button", { name: /^New/ })).toHaveAttribute("aria-pressed", "true");
    });

    it("starts clean when what was remembered is no longer valid", async () => {
      sessionStorage.setItem("remembered:deck:stage", JSON.stringify("archived"));
      sessionStorage.setItem("remembered:deck:sort", JSON.stringify("sparkle"));
      sessionStorage.setItem("remembered:deck:missingOnly", JSON.stringify("yes"));
      renderApp("/deck");
      expect(await screen.findByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveValue("added");
      expect(screen.getByRole("button", { name: "Missing reverse" })).toHaveAttribute("aria-pressed", "false");
    });
  });

  it("searches the deck", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await user.type(await screen.findByRole("searchbox", { name: "Search your deck" }), "hond");
    await vi.waitFor(() => expect(lastList()).toContain("q=hond"));
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp("/deck");
    await screen.findAllByRole("listitem");
    mock.handlers["GET /deck"] = () => json(200, { summary, hasMore: false, cards: [] });
    await user.type(screen.getByRole("searchbox", { name: "Search your deck" }), "zzz");
    expect(await screen.findByText("No cards match.")).toBeInTheDocument();
  });

  it("narrows to one direction with the toggle, and labels the direction when showing both", async () => {
    const dir = (from: string, to: string) => ({
      fromLanguage: from, toLanguage: to, total: 6, new: 3, learning: 1, review: 2, dueNow: 1, nextDueAt: null, ready: { learning: 0, review: 0, new: 0 },
    });
    mock.handlers["GET /stats"] = () =>
      json(200, { now: at(0), reviewsToday: 0, nextDueAt: null, directions: [dir("en", "nl"), dir("nl", "en")] });
    const user = userEvent.setup();
    renderApp("/deck");
    expect(await screen.findAllByText("EN → NL")).not.toHaveLength(0); // tag on each row, and the toggle

    await user.click(await screen.findByRole("button", { name: "NL → EN" }));
    await vi.waitFor(() => expect(lastList()).toContain("fromLanguage=nl&toLanguage=en"));
    expect(screen.getByRole("button", { name: "NL → EN" })).toHaveAttribute("aria-pressed", "true");
  });

  it("always shows the whole deck's size at the top, whichever direction is selected", async () => {
    const dir = (from: string, to: string, total: number) => ({
      fromLanguage: from, toLanguage: to, total, new: total, learning: 0, review: 0, dueNow: 0, nextDueAt: null, ready: { learning: 0, review: 0, new: 0 },
    });
    mock.handlers["GET /stats"] = () =>
      json(200, { now: at(0), reviewsToday: 0, nextDueAt: null, directions: [dir("en", "nl", 300), dir("nl", "en", 66)] });
    // The list's own summary is for the selected direction only.
    mock.handlers["GET /deck"] = () =>
      json(200, { summary: { ...summary, total: 66 }, hasMore: false, cards: [card("a", "dog", "hond")] });
    const user = userEvent.setup();
    renderApp("/deck");
    expect(await screen.findByText("366 cards")).toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: "NL → EN" }));
    await vi.waitFor(() => expect(lastList()).toContain("fromLanguage=nl&toLanguage=en"));
    expect(screen.getByText("366 cards")).toBeInTheDocument();
  });

  describe("reverse cards", () => {
    const withGaps = (mirrorable = 2) => ({
      summary,
      hasMore: false,
      mirrorable,
      cards: [
        card("a", "dog", "hond"),
        card("b", "house", "huis", { hasMirror: false }),
        card("c", "water", "water", { hasMirror: false }),
      ],
    });

    it("offers to add the reverse of a card that lacks one, and confirms it", async () => {
      let body: unknown;
      mock.handlers["GET /deck"] = () => json(200, withGaps());
      mock.handlers["POST /concepts/c-b/add"] = (b) => {
        body = b;
        return json(201, { added: 1, alreadyInDeck: 0 });
      };
      const user = userEvent.setup();
      renderApp("/deck");
      expect(screen.queryByRole("button", { name: "Add reverse of dog" })).not.toBeInTheDocument();
      await user.click(await screen.findByRole("button", { name: "Add reverse of house" }));

      expect(await screen.findByText("Reverse added")).toBeInTheDocument();
      expect(body).toEqual({ fromLanguage: "nl", toLanguage: "en" }); // the card is en->nl
    });

    it("can show only cards missing a reverse, and keeps one you just fixed in view", async () => {
      let fixed = false;
      mock.handlers["GET /deck"] = () =>
        json(200, lastList().includes("missingMirror=1")
          ? { ...withGaps(fixed ? 1 : 2), cards: withGaps().cards.filter((c) => !c.hasMirror && !(fixed && c.id === "b")) }
          : withGaps());
      mock.handlers["POST /concepts/c-b/add"] = () => {
        fixed = true;
        return json(201, { added: 1, alreadyInDeck: 0 });
      };
      const user = userEvent.setup();
      renderApp("/deck");
      await user.click(await screen.findByRole("button", { name: "Missing reverse" }));
      await vi.waitFor(() => expect(lastList()).toContain("missingMirror=1"));
      expect(screen.queryByText("dog")).not.toBeInTheDocument();

      await user.click(await screen.findByRole("button", { name: "Add reverse of house" }));
      expect(await screen.findByText("Reverse added")).toBeInTheDocument();
      // The server no longer lists it, but it stays until the view changes.
      expect(screen.getByText("house")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Missing reverse" }));
      await user.click(screen.getByRole("button", { name: "Missing reverse" }));
      await vi.waitFor(() => expect(screen.queryByText("Reverse added")).not.toBeInTheDocument());
    });

    it("adds the reverse of everything in the view at once", async () => {
      let body: unknown;
      mock.handlers["GET /deck"] = () => json(200, withGaps(2));
      mock.handlers["POST /deck/mirrors"] = (b) => {
        body = b;
        return json(200, { added: 2 });
      };
      const user = userEvent.setup();
      renderApp("/deck");
      await user.click(await screen.findByRole("button", { name: /^Review/ }));
      await user.type(screen.getByRole("searchbox", { name: "Search your deck" }), "hu");
      await vi.waitFor(() => expect(lastList()).toContain("q=hu"));

      await user.click(await screen.findByRole("button", { name: "Add reverse for all 2 cards in this view" }));
      expect(await screen.findByText("Added 2 reverse cards.")).toBeInTheDocument();
      expect(body).toEqual({ state: "review", q: "hu" });
    });

    it("says it plainly for a single card, and hides the button when there is nothing to add", async () => {
      mock.handlers["GET /deck"] = () => json(200, withGaps(1));
      const view = renderApp("/deck");
      expect(await screen.findByRole("button", { name: "Add reverse for 1 card in this view" })).toBeInTheDocument();
      view.unmount();

      mock.handlers["GET /deck"] = () => json(200, withGaps(0));
      renderApp("/deck");
      await screen.findByText("house");
      expect(screen.queryByRole("button", { name: /in this view/ })).not.toBeInTheDocument();
    });
  });

  it("loads more cards on request", async () => {
    mock.handlers["GET /deck"] = () =>
      lastList().includes("offset=0") || !lastList().includes("offset=")
        ? json(200, { summary, hasMore: true, cards: [card("a", "dog", "hond")] })
        : json(200, { summary, hasMore: false, cards: [card("b", "house", "huis")] });
    const user = userEvent.setup();
    renderApp("/deck");
    await screen.findByText("dog");
    await user.click(screen.getByRole("button", { name: "Load more cards" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(screen.getByText("dog")).toBeInTheDocument();
    expect(lastList()).toContain("offset=50");
    expect(screen.queryByRole("button", { name: "Load more cards" })).not.toBeInTheDocument();
  });

  it("points an empty deck at the packs", async () => {
    mock.handlers["GET /deck"] = () =>
      json(200, { summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 }, hasMore: false, cards: [] });
    renderApp("/deck");
    expect(await screen.findByText("Your deck is empty")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse packs" })).toHaveAttribute("href", "/add-words");
  });

  it("shows an error when the deck cannot be loaded", async () => {
    mock.handlers["GET /deck"] = () => json(500, { error: "boom" });
    renderApp("/deck");
    expect(await screen.findByText(/Could not load your deck/)).toBeInTheDocument();
  });
});
