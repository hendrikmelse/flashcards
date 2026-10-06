import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyReport } from "@flashcards/shared";
import { installMockApi, json, mock, renderApp } from "./test/harness";

const entry = (language: string, lemma: string) => ({ language, lemma, partOfSpeech: "noun", details: {} });

const report = (over: Partial<MyReport>): MyReport => ({
  id: "r1",
  kind: "card",
  title: "",
  conceptId: "c1",
  front: [entry("en", "house")],
  back: [entry("nl", "huis")],
  fromLanguage: "en",
  toLanguage: "nl",
  reason: "translation",
  note: "",
  status: "open",
  comments: [],
  createdAt: "2026-10-01T10:00:00.000Z",
  resolvedAt: null,
  ...over,
});

// The list starts on the open reports; this switches it to show everything.
const showAll = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: /^All/ }));

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the Your reports page", () => {
  it("shows each report with its word, reason, status, and the owner’s reply", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, {
        reports: [
          report({ id: "r2", note: "Still waiting" }),
          report({
            id: "r1",
            front: [entry("en", "dog")],
            back: [entry("nl", "hond")],
            reason: "forms",
            status: "resolved",
            comments: [{ id: "a1", body: "Fixed, thanks!", fromAdmin: true, createdAt: "2026-10-03T09:00:00.000Z" }],
            resolvedAt: "2026-10-03T10:00:00.000Z",
          }),
        ],
      });
    const user = userEvent.setup();
    renderApp("/reports");

    expect(await screen.findByRole("heading", { name: "Your reports" })).toBeInTheDocument();
    await screen.findAllByRole("listitem");
    await showAll(user);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);

    expect(within(items[0]!).getByText("house")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Open")).toBeInTheDocument();
    expect(within(items[0]!).getByText("Still waiting")).toBeInTheDocument();
    expect(within(items[0]!).queryByText(/^Reply ·/)).not.toBeInTheDocument();

    expect(within(items[1]!).getByText("dog")).toBeInTheDocument();
    expect(within(items[1]!).getByText("Resolved")).toBeInTheDocument();
    expect(within(items[1]!).getByText("The word forms are wrong", { exact: false })).toBeInTheDocument();
    expect(within(items[1]!).getByText(/^Reply ·/)).toBeInTheDocument();
    expect(within(items[1]!).getByText("Fixed, thanks!")).toBeInTheDocument();
  });

  it("says so when nothing has been reported", async () => {
    mock.handlers["GET /reports"] = () => json(200, { reports: [] });
    renderApp("/reports");
    expect(await screen.findByText("Nothing sent yet")).toBeInTheDocument();
    expect(screen.getByText(/Use the buttons above/)).toBeInTheDocument();
  });

  it("says so when the reports cannot be loaded", async () => {
    mock.handlers["GET /reports"] = () => json(500, { error: "boom" });
    renderApp("/reports");
    expect(await screen.findByText(/Could not load your reports/)).toBeInTheDocument();
  });
});

describe("the button to it beside the settings button", () => {
  it("is shown to everyone, including someone who has sent nothing", async () => {
    mock.handlers["GET /reports"] = () => json(200, { reports: [] });
    renderApp("/");
    const link = await screen.findByRole("link", { name: "Reports" });
    expect(link).toHaveAttribute("href", "/reports");
  });

  it("goes back to the dashboard when clicked on the reports page", async () => {
    mock.handlers["GET /reports"] = () => json(200, { reports: [] });
    const user = userEvent.setup();
    renderApp("/reports");
    await user.click(await screen.findByRole("link", { name: "Reports" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });
});

describe("bug reports and feature suggestions", () => {
  const posts: unknown[] = [];
  beforeEach(() => {
    posts.length = 0;
    mock.handlers["GET /reports"] = () => json(200, { reports: [] });
    mock.handlers["POST /reports"] = (body) => {
      posts.push(body);
      return json(201, { ok: true });
    };
  });

  it("offers the two buttons at the top of the page, even before anything is sent, and no pack request", async () => {
    renderApp("/reports");
    expect(await screen.findByRole("button", { name: "Report a bug" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest a feature" })).toBeInTheDocument();
    // Packs are requested from the pack search.
    expect(screen.queryByRole("button", { name: "Request a pack" })).not.toBeInTheDocument();
  });

  it("marks the button of the open form", async () => {
    const user = userEvent.setup();
    renderApp("/reports");
    const button = await screen.findByRole("button", { name: "Suggest a feature" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Report a bug" })).toHaveAttribute("aria-expanded", "false");
  });

  it("sends a bug with its title and details, then says thanks and closes the form", async () => {
    const user = userEvent.setup();
    renderApp("/reports");
    await user.click(await screen.findByRole("button", { name: "Report a bug" }));
    const form = screen.getByRole("form", { name: "Report a bug" });
    const send = within(form).getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    await user.type(within(form).getByLabelText("What went wrong?"), "  Cards freeze ");
    await user.type(within(form).getByLabelText("Details"), "After pressing Again twice.");
    await user.click(send);

    await waitFor(() => expect(posts).toEqual([{ kind: "bug", title: "Cards freeze", note: "After pressing Again twice." }]));
    expect(await screen.findByText(/Thanks for the bug report/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Report a bug" })).not.toBeInTheDocument();
  });

  it("sends a suggestion as a suggestion", async () => {
    const user = userEvent.setup();
    renderApp("/reports");
    await user.click(await screen.findByRole("button", { name: "Suggest a feature" }));
    const form = screen.getByRole("form", { name: "Suggest a feature" });
    await user.type(within(form).getByLabelText("What would you like?"), "Dark mode");
    await user.type(within(form).getByLabelText("Details"), "Easier on the eyes.");
    await user.click(within(form).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(posts).toEqual([{ kind: "suggestion", title: "Dark mode", note: "Easier on the eyes." }]));
  });

  it("can be cancelled, and switching between the two forms starts a fresh one", async () => {
    const user = userEvent.setup();
    renderApp("/reports");
    await user.click(await screen.findByRole("button", { name: "Report a bug" }));
    await user.type(screen.getByLabelText("What went wrong?"), "Half written");
    await user.click(screen.getByRole("button", { name: "Suggest a feature" }));
    expect(screen.queryByRole("form", { name: "Report a bug" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("What would you like?")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(posts).toEqual([]);
  });

  it("shows them in the list, tells them apart, and filters by type", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, {
        reports: [
          report({ id: "w", note: "Word note" }),
          report({
            id: "b",
            kind: "bug",
            title: "Cards freeze",
            note: "After Again.",
            conceptId: null,
            front: [],
            back: [],
            fromLanguage: null,
            toLanguage: null,
            reason: null,
            status: "resolved",
            comments: [{ id: "a2", body: "Fixed in the last update.", fromAdmin: true, createdAt: "2026-10-03T09:00:00.000Z" }],
            resolvedAt: "2026-10-03T10:00:00.000Z",
          }),
          report({ id: "s", kind: "suggestion", title: "Dark mode", conceptId: null, front: [], back: [], fromLanguage: null, toLanguage: null, reason: null }),
        ],
      });
    const user = userEvent.setup();
    renderApp("/reports");
    await screen.findAllByRole("listitem");
    await showAll(user);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Cards freeze")).toBeInTheDocument();
    expect(screen.getByText("Fixed in the last update.")).toBeInTheDocument();

    const type = within(screen.getByRole("group", { name: "Type" }));
    await user.click(type.getByRole("button", { name: /^Bugs/ }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Cards freeze")).toBeInTheDocument();
    await user.click(type.getByRole("button", { name: /^Suggestions/ }));
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
    expect(screen.queryByText("Cards freeze")).not.toBeInTheDocument();
  });
});

describe("comments on a report", () => {
  const posts: { url: string; body: unknown }[] = [];
  beforeEach(() => {
    posts.length = 0;
    mock.handlers["POST /reports/r1/comments"] = (body) => {
      posts.push({ url: "r1", body });
      return json(201, { ok: true });
    };
  });

  it("shows what the author added, oldest first, with a box to add more while the report is open", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, {
        reports: [
          report({
            comments: [
              { id: "m1", body: "It was on the second card.", fromAdmin: false, createdAt: "2026-10-02T10:00:00.000Z" },
              { id: "m2", body: "And again today.", fromAdmin: false, createdAt: "2026-10-03T10:00:00.000Z" },
            ],
          }),
        ],
      });
    const user = userEvent.setup();
    renderApp("/reports");
    const item = within(await screen.findByRole("listitem"));
    const shown = item.getAllByText(/second card|again today/i);
    expect(shown.map((e) => e.textContent)).toEqual(["It was on the second card.", "And again today."]);

    const form = within(item.getByRole("form", { name: "Add a comment" }));
    const send = form.getByRole("button", { name: "Add comment" });
    expect(send).toBeDisabled();
    await user.type(form.getByLabelText("Your comment"), "  One more thing ");
    await user.click(send);
    await waitFor(() => expect(posts).toEqual([{ url: "r1", body: { body: "One more thing" } }]));
    // The box empties, ready for another.
    await waitFor(() => expect(form.getByLabelText("Your comment")).toHaveValue(""));
  });

  it("shows the admin's replies in the same conversation, in order, marked as replies", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, {
        reports: [
          report({
            comments: [
              { id: "m1", body: "My first message.", fromAdmin: false, createdAt: "2026-10-02T10:00:00.000Z" },
              { id: "m2", body: "Thanks, looking into it.", fromAdmin: true, createdAt: "2026-10-03T10:00:00.000Z" },
              { id: "m3", body: "My second message.", fromAdmin: false, createdAt: "2026-10-04T10:00:00.000Z" },
            ],
          }),
        ],
      });
    renderApp("/reports");
    const item = within(await screen.findByRole("listitem"));
    const messages = item.getAllByText(/message\.|looking into it/);
    expect(messages.map((e) => e.textContent)).toEqual(["My first message.", "Thanks, looking into it.", "My second message."]);
    const labels = item.getAllByText(/^(You added|Reply) ·/).map((e) => e.textContent!.split(" ·")[0]);
    expect(labels).toEqual(["You added", "Reply", "You added"]);
    // The box is still there: the conversation can go on while the report is open.
    expect(item.getByRole("form", { name: "Add a comment" })).toBeInTheDocument();
  });

  it("is not offered once the report is resolved, though its comments are still shown", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, {
        reports: [
          report({
            status: "resolved",
            resolvedAt: "2026-10-03T10:00:00.000Z",
            comments: [{ id: "m1", body: "Earlier comment.", fromAdmin: false, createdAt: "2026-10-02T10:00:00.000Z" }],
          }),
        ],
      });
    const user = userEvent.setup();
    renderApp("/reports");
    await user.click(within(await screen.findByRole("group", { name: "Status" })).getByRole("button", { name: /^Resolved/ }));
    expect(await screen.findByText("Earlier comment.")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add a comment" })).not.toBeInTheDocument();
  });
});

describe("the status filter", () => {
  it("starts on the open reports, with the counts of all of them", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, {
        reports: [
          report({ id: "a", note: "Open one" }),
          report({ id: "b", note: "Open two" }),
          report({ id: "c", note: "Done one", status: "resolved", resolvedAt: "2026-10-03T10:00:00.000Z" }),
        ],
      });
    const user = userEvent.setup();
    renderApp("/reports");
    expect(await screen.findAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Done one")).not.toBeInTheDocument();

    const status = within(screen.getByRole("group", { name: "Status" }));
    expect(status.getByRole("button", { name: /^Open/ })).toHaveAttribute("aria-pressed", "true");
    expect(status.getByRole("button", { name: /^All/ })).toHaveTextContent("3");
    expect(status.getByRole("button", { name: /^Resolved/ })).toHaveTextContent("1");

    await user.click(status.getByRole("button", { name: /^Resolved/ }));
    expect(screen.getByText("Done one")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("says nothing matches when nothing is open, without hiding the others", async () => {
    mock.handlers["GET /reports"] = () =>
      json(200, { reports: [report({ status: "resolved", resolvedAt: "2026-10-03T10:00:00.000Z" })] });
    renderApp("/reports");
    expect(await screen.findByText("Nothing matches these filters")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: /^All/ })).toHaveTextContent("1");
  });
});

describe("when the filters hide everything", () => {
  it("says so and shows everything again on request", async () => {
    mock.handlers["GET /reports"] = () => json(200, { reports: [report({ note: "A word problem" })] });
    const user = userEvent.setup();
    renderApp("/reports");
    await screen.findByText("A word problem");

    await user.click(within(screen.getByRole("group", { name: "Type" })).getByRole("button", { name: /^Bugs/ }));
    expect(screen.getByText("Nothing matches these filters")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show everything" }));
    expect(await screen.findByText("A word problem")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
  });
});
