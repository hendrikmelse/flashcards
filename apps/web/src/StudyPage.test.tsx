import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

const entry = (language: string, lemma: string, details: Record<string, unknown> = {}) => ({
  language,
  lemma,
  partOfSpeech: null,
  details,
});

const dog = {
  id: "card-dog",
  conceptId: "c1",
  fromLanguage: "en",
  toLanguage: "nl",
  state: "new",
  dueAt: "2026-01-01T00:00:00.000Z",
  front: [entry("en", "dog")],
  back: [entry("nl", "hond", { article: "de" })],
  sentences: { front: ["The dog barks."], back: ["De hond blaft."] },
};
const house = {
  ...dog,
  id: "card-house",
  conceptId: "c2",
  front: [entry("en", "house")],
  back: [entry("nl", "huis", { article: "het" })],
  sentences: { front: [], back: [] },
};

type Body = { userCardId: string; rating: string; clientReviewId: string; timeTakenMs: number };
let reviews: Body[];
let studyCalls = 0;

// What the server answers to a review: learning (back in 10 min) or graduated.
const learning = (id: string) => ({
  userCardId: id,
  state: "learning",
  intervalDays: 0,
  reviewedAt: "2026-01-01T12:00:00.000Z",
  dueAt: "2026-01-01T12:10:00.000Z",
  replayed: false,
});
const graduated = (id: string) => ({
  userCardId: id,
  state: "review",
  intervalDays: 8,
  reviewedAt: "2026-01-01T12:00:00.000Z",
  dueAt: "2026-01-09T12:00:00.000Z",
  replayed: false,
});

function studyWith(cards: unknown[]) {
  mock.handlers["GET /study?limit=20"] = () => {
    studyCalls++;
    return json(200, { now: "x", counts: { learning: 0, review: 0, new: cards.length }, cards });
  };
}

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
  reviews = [];
  studyCalls = 0;
  studyWith([dog, house]);
  mock.handlers["POST /reviews"] = (body) => {
    const b = body as Body;
    reviews.push(b);
    return json(200, b.rating === "easy" ? graduated(b.userCardId) : learning(b.userCardId));
  };
});

afterEach(() => vi.unstubAllGlobals());

describe("study session", () => {
  it("shows the prompt first and only reveals the answer on request", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.getByText("The dog barks.")).toBeInTheDocument();
    expect(screen.getByText(/English → Nederlands/)).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.queryByText("de hond")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Good" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show answer" }));

    expect(screen.getByText("de hond")).toBeInTheDocument();
    expect(screen.getByText("De hond blaft.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Good" })).toBeInTheDocument();
  });

  it("runs a full session, bringing a learning card back before finishing", async () => {
    const user = userEvent.setup();
    renderApp("/study");

    // dog: Good -> server says learning (10 min), so it will return.
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));
    expect(reviews[0]).toMatchObject({ userCardId: "card-dog", rating: "good" });
    expect(reviews[0]!.clientReviewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reviews[0]!.timeTakenMs).toBeGreaterThanOrEqual(0);

    // house: Easy (by keyboard) -> graduates.
    expect(await screen.findByText("house")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    await user.keyboard("4");
    expect(reviews[1]).toMatchObject({ userCardId: "card-house", rating: "easy" });

    // Only the waiting dog is left. The server lists it again; it must not be duplicated.
    expect(await screen.findByText("Nothing else is ready right now.")).toBeInTheDocument();
    expect(studyCalls).toBe(2);
    expect(screen.getByText(/1 left/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue now" }));
    expect(await screen.findByText("dog")).toBeInTheDocument();
    expect(screen.getByText("Learning")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Easy" }));

    expect(await screen.findByRole("heading", { name: "Session complete" })).toBeInTheDocument();
    expect(screen.getByText(/You answered 3 cards, 100% rated Good or Easy/)).toBeInTheDocument();
    expect(reviews).toHaveLength(3);
  });

  it("rates with the number keys", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.keyboard("1");
    expect(reviews[0]).toMatchObject({ rating: "again" });
  });

  it("ignores the number keys until the answer is showing", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("button", { name: "Show answer" });
    await user.keyboard("3");
    expect(reviews).toHaveLength(0);
  });

  it("lets Space/Enter act on the focused button (reveal, then Good)", async () => {
    const user = userEvent.setup();
    renderApp("/study");
    await screen.findByRole("button", { name: "Show answer" });
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "Good" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(reviews[0]).toMatchObject({ rating: "good" });
  });

  it("keeps the card and retries with the same id when saving fails", async () => {
    let first = true;
    mock.handlers["POST /reviews"] = (body) => {
      const b = body as Body;
      reviews.push(b);
      if (first) {
        first = false;
        return json(500, { error: "boom" });
      }
      return json(200, graduated(b.userCardId));
    };
    const user = userEvent.setup();
    renderApp("/study");
    await user.click(await screen.findByRole("button", { name: "Show answer" }));
    await user.click(screen.getByRole("button", { name: "Good" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your answer");
    expect(screen.getByText("dog")).toBeInTheDocument(); // still on the same card

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("house")).toBeInTheDocument();
    expect(reviews).toHaveLength(2);
    expect(reviews[1]!.clientReviewId).toBe(reviews[0]!.clientReviewId);
  });

  it("says you are caught up when nothing is due", async () => {
    studyWith([]);
    renderApp("/study");
    expect(await screen.findByText(/all caught up/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse packs" })).toBeInTheDocument();
  });

  it("recovers from a failed load", async () => {
    mock.handlers["GET /study?limit=20"] = () => json(500, { error: "boom" });
    const user = userEvent.setup();
    renderApp("/study");
    expect(await screen.findByText("Could not load your cards.")).toBeInTheDocument();

    studyWith([dog]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("dog")).toBeInTheDocument();
  });
});

describe("dashboard entry point", () => {
  it("offers to start studying when cards are due", async () => {
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Start studying" })).toHaveAttribute("href", "/study");
  });

  it("says so when there is nothing to study", async () => {
    mock.handlers["GET /study?limit=1"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 }, cards: [] });
    renderApp("/");
    expect(await screen.findByText(/Nothing to study right now/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start studying" })).not.toBeInTheDocument();
  });
});
