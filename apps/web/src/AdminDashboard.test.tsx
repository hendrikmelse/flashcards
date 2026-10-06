import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminReport } from "@flashcards/shared";
import { USER, installMockApi, json, mock, renderApp } from "./test/harness";

const entry = (language: string, lemma: string) => ({ language, lemma, partOfSpeech: "noun", details: {} });

const report = (over: Partial<AdminReport>): AdminReport => ({
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
  reporter: { email: "ann@example.com", name: null, role: "user" },
  ...over,
});

const stats = (over: Record<string, unknown> = {}) => ({
  accounts: 1234,
  activeAccounts: 56,
  reviews: { total: 98765, lastWeek: 432 },
  openReports: { total: 8, byKind: { card: 3, bug: 2, suggestion: 1, pack_request: 2 } },
  ...over,
});

const asRole = (role: "user" | "admin") => {
  mock.handlers["GET /auth/me"] = () => json(200, { user: { ...USER, role } });
  mock.handlers["GET /reports"] = () => json(200, { reports: [] });
};

beforeEach(() => {
  installMockApi();
  mock.loggedIn = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the admin dashboard button", () => {
  it("is in the header, next to the reports button, for an admin", async () => {
    asRole("admin");
    renderApp("/");
    const admin = await screen.findByRole("link", { name: "Admin dashboard" });
    expect(admin).toHaveAttribute("href", "/admin");
    const names = within(admin.parentElement!)
      .getAllByRole("link")
      .map((l) => l.getAttribute("aria-label"));
    expect(names.indexOf("Admin dashboard")).toBe(names.indexOf("Reports") + 1);
  });

  it("is not there for an ordinary user, who gets the page not found page if they go to /admin", async () => {
    asRole("user");
    renderApp("/admin");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Admin dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Admin dashboard" })).not.toBeInTheDocument();
  });

  it("is just as missing at /admin/reports for an ordinary user", async () => {
    asRole("user");
    renderApp("/admin/reports");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manage reports" })).not.toBeInTheDocument();
  });

  it("goes back to the dashboard when clicked on its own page", async () => {
    asRole("admin");
    mock.handlers["GET /admin/stats"] = () => json(200, stats());
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("link", { name: "Admin dashboard" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("goes up to the admin dashboard from the reports management page", async () => {
    asRole("admin");
    mock.handlers["GET /admin/reports"] = () => json(200, { reports: [] });
    mock.handlers["GET /admin/stats"] = () => json(200, stats());
    const user = userEvent.setup();
    renderApp("/admin/reports");
    await user.click(await within(await screen.findByRole("banner")).findByRole("link", { name: "Admin dashboard" }));
    expect(await screen.findByRole("heading", { name: "Admin dashboard" })).toBeInTheDocument();
  });

  it("is not needed to get back: the management page has its own button to the admin dashboard", async () => {
    asRole("admin");
    mock.handlers["GET /admin/reports"] = () => json(200, { reports: [] });
    mock.handlers["GET /admin/stats"] = () => json(200, stats());
    const user = userEvent.setup();
    renderApp("/admin/reports");
    await user.click(await within(await screen.findByRole("main")).findByRole("link", { name: "Admin dashboard" }));
    expect(await screen.findByRole("heading", { name: "Admin dashboard" })).toBeInTheDocument();
  });
});

describe("the admin dashboard", () => {
  beforeEach(() => asRole("admin"));

  it("shows how the app is used, and how many reports are open, by type", async () => {
    mock.handlers["GET /admin/stats"] = () => json(200, stats());
    renderApp("/admin");
    expect(await screen.findByRole("heading", { name: "Admin dashboard" })).toBeInTheDocument();
    const overview = within(await screen.findByRole("region", { name: "Overview" }));
    const tile = (label: string) => overview.getByText(label).closest(".stat") as HTMLElement;
    expect(within(tile("Accounts")).getByText("1,234")).toBeInTheDocument();
    expect(within(tile("Active accounts")).getByText("56")).toBeInTheDocument();
    expect(within(tile("Reviews, all time")).getByText("98,765")).toBeInTheDocument();
    expect(within(tile("Reviews, last 7 days")).getByText("432")).toBeInTheDocument();

    const reports = within(screen.getByRole("region", { name: "Reports" }));
    const rtile = (label: string) => reports.getByText(label).closest(".stat") as HTMLElement;
    expect(within(rtile("Open reports")).getByText("8")).toBeInTheDocument();
    expect(within(rtile("Word problems")).getByText("3")).toBeInTheDocument();
    expect(within(rtile("Bugs")).getByText("2")).toBeInTheDocument();
    expect(within(rtile("Suggestions")).getByText("1")).toBeInTheDocument();
    expect(within(rtile("Pack requests")).getByText("2")).toBeInTheDocument();
  });

  it("has a button to the reports management page", async () => {
    mock.handlers["GET /admin/stats"] = () => json(200, stats());
    mock.handlers["GET /admin/reports"] = () => json(200, { reports: [] });
    const user = userEvent.setup();
    renderApp("/admin");
    await user.click(await screen.findByRole("link", { name: "Manage reports" }));
    expect(await screen.findByRole("heading", { name: "Manage reports" })).toBeInTheDocument();
  });
});

describe("the reports management page", () => {
  beforeEach(() => asRole("admin"));

  it("lists everyone's open reports in a table with an account type column", async () => {
    mock.handlers["GET /admin/reports"] = () =>
      json(200, {
        reports: [
          report({ id: "a", note: "Open one" }),
          report({
            id: "b",
            front: [entry("en", "dog")],
            back: [entry("nl", "hond")],
            reporter: { email: "root@example.com", name: null, role: "admin" },
          }),
          report({
            id: "c",
            front: [entry("en", "cat")],
            back: [entry("nl", "kat")],
            status: "resolved",
            resolvedAt: "2026-10-03T10:00:00.000Z",
          }),
          report({
            id: "d",
            kind: "bug",
            title: "Cards freeze",
            conceptId: null,
            front: [],
            back: [],
            fromLanguage: null,
            toLanguage: null,
            reason: null,
            reporter: null,
          }),
        ],
      });
    renderApp("/admin/reports");
    expect(await screen.findByRole("heading", { name: "Manage reports" })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Account type" })).toBeInTheDocument();

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3); // the resolved one is hidden by the default Open filter
    expect(within(table).queryByText("cat → kat")).not.toBeInTheDocument();
    const dog = rows.find((r) => within(r).queryByText("dog → hond"))!;
    expect(within(dog).getByText("root@example.com")).toBeInTheDocument();
    expect(within(dog).getByText("Admin")).toBeInTheDocument();
    const bug = rows.find((r) => within(r).queryByText("Cards freeze"))!;
    expect(within(bug).getByText("Deleted account")).toBeInTheDocument();
  });

  it("filters by status and type, and sorts by a column", async () => {
    mock.handlers["GET /admin/reports"] = () =>
      json(200, {
        reports: [
          report({ id: "a", front: [entry("en", "zebra")], back: [entry("nl", "zebra")], createdAt: "2026-10-02T10:00:00.000Z" }),
          report({ id: "b", front: [entry("en", "apple")], back: [entry("nl", "appel")], createdAt: "2026-10-03T10:00:00.000Z" }),
          report({
            id: "c",
            front: [entry("en", "cat")],
            back: [entry("nl", "kat")],
            status: "resolved",
            resolvedAt: "2026-10-04T10:00:00.000Z",
          }),
        ],
      });
    const user = userEvent.setup();
    renderApp("/admin/reports");
    const aboutOrder = () =>
      within(screen.getByRole("table"))
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getAllByRole("cell")[4]!.textContent);
    await screen.findByRole("table");
    // Newest first by default.
    expect(aboutOrder()).toEqual(["apple → appel", "zebra → zebra"]);

    // A first click on a column sorts A to Z, a second reverses it.
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(aboutOrder()).toEqual(["apple → appel", "zebra → zebra"]);
    await user.click(screen.getByRole("button", { name: /^About/ }));
    expect(aboutOrder()).toEqual(["zebra → zebra", "apple → appel"]);

    await user.click(within(screen.getByRole("group", { name: "Status" })).getByRole("button", { name: /^All/ }));
    expect(aboutOrder()).toHaveLength(3);
    await user.click(within(screen.getByRole("group", { name: "Type" })).getByRole("button", { name: /^Bugs/ }));
    expect(screen.getByText("Nothing matches these filters")).toBeInTheDocument();
  });

  it("opens a report when its row is clicked, with no Details button", async () => {
    mock.handlers["GET /admin/reports"] = () => json(200, { reports: [report({ id: "a", note: "It is wrong" })] });
    const user = userEvent.setup();
    renderApp("/admin/reports");
    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /details/i })).not.toBeInTheDocument();

    // Anywhere on the row opens it: here, the sender's cell.
    await user.click(within(table).getByText("ann@example.com"));
    expect(screen.getByText("It is wrong")).toBeInTheDocument();
    await user.click(within(table).getByText("ann@example.com"));
    expect(screen.queryByText("It is wrong")).not.toBeInTheDocument();

    // The title is a button for the keyboard.
    const title = within(table).getByRole("button", { name: "house → huis" });
    expect(title).toHaveAttribute("aria-expanded", "false");
    await user.click(title);
    expect(title).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("It is wrong")).toBeInTheDocument();
  });

  it("holds the conversation, and replies are messages in it", async () => {
    const posts: unknown[] = [];
    let current = report({
      id: "a",
      note: "It is wrong",
      comments: [{ id: "m", body: "More detail.", fromAdmin: false, createdAt: "2026-10-02T10:00:00.000Z" }],
    });
    mock.handlers["GET /admin/reports"] = () => json(200, { reports: [current] });
    mock.handlers["POST /admin/reports/a/comments"] = (body) => {
      posts.push(body);
      current = {
        ...current,
        comments: [
          ...current.comments,
          { id: "r1", body: (body as { body: string }).body, fromAdmin: true, createdAt: "2026-10-03T10:00:00.000Z" },
        ],
      };
      return json(201, { ok: true });
    };
    const user = userEvent.setup();
    renderApp("/admin/reports");
    await user.click(await screen.findByRole("button", { name: "house → huis" }));
    expect(screen.getByText("It is wrong")).toBeInTheDocument();
    expect(screen.getByText("More detail.")).toBeInTheDocument();
    expect(screen.getByText(/^ann@example.com ·/)).toBeInTheDocument();

    // The reply box is the one the sender has: a one-line box with its button at the right.
    const form = within(screen.getByRole("form", { name: "Reply" }));
    const send = form.getByRole("button", { name: "Reply" });
    expect(send).toBeDisabled();
    await user.type(form.getByLabelText("Your reply"), "  Thanks, fixing it. ");
    await user.click(send);
    await waitFor(() => expect(posts).toEqual([{ body: "Thanks, fixing it." }]));
    expect(await screen.findByText("Thanks, fixing it.")).toBeInTheDocument();
    expect(screen.getByText(/^Admin ·/)).toBeInTheDocument();
    await waitFor(() => expect(form.getByLabelText("Your reply")).toHaveValue(""));
  });

  const resolveSetup = (comments: AdminReport["comments"]) => {
    const calls: { url: string; body: unknown }[] = [];
    let current = report({ id: "a", comments });
    mock.handlers["GET /admin/reports"] = () => json(200, { reports: [current] });
    mock.handlers["POST /admin/reports/a/comments"] = (body) => {
      calls.push({ url: "reply", body });
      current = {
        ...current,
        comments: [
          ...current.comments,
          { id: `r${calls.length}`, body: (body as { body: string }).body, fromAdmin: true, createdAt: "2026-10-03T10:00:00.000Z" },
        ],
      };
      return json(201, { ok: true });
    };
    mock.handlers["PATCH /admin/reports/a"] = (body) => {
      calls.push({ url: "resolve", body });
      const resolved = (body as { resolved: boolean }).resolved;
      current = { ...current, status: resolved ? "resolved" : "open", resolvedAt: resolved ? "2026-10-05T10:00:00.000Z" : null };
      return json(200, { ok: true });
    };
    return calls;
  };
  const openReport = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "house → huis" }));
    return within(screen.getByRole("form", { name: "Reply" }));
  };

  it("puts Resolve in line with the reply box and its button, greyed out until there is a reply to send", async () => {
    resolveSetup([{ id: "m", body: "Hello?", fromAdmin: false, createdAt: "2026-10-02T10:00:00.000Z" }]);
    const user = userEvent.setup();
    renderApp("/admin/reports");
    // Not shown until the report is opened.
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();
    const form = await openReport(user);

    // The same form as the box and the Reply button, after them in the row.
    const resolve = form.getByRole("button", { name: "Resolve" });
    expect(form.getByRole("button", { name: "Reply" }).compareDocumentPosition(resolve) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(resolve).toBeDisabled(); // only the sender has written, and nothing is typed

    await user.type(form.getByLabelText("Your reply"), "x");
    expect(resolve).toBeEnabled();
    await user.clear(form.getByLabelText("Your reply"));
    expect(resolve).toBeDisabled();
  });

  it("sends what is typed and resolves the report, when Resolve is pressed with a reply in the box", async () => {
    const calls = resolveSetup([]);
    const user = userEvent.setup();
    renderApp("/admin/reports");
    const form = await openReport(user);
    await user.type(form.getByLabelText("Your reply"), "  All fixed. ");
    await user.click(form.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(calls).toEqual([
      { url: "reply", body: { body: "All fixed." } },
      { url: "resolve", body: { resolved: true } },
    ]));
    // Resolved, so it drops out of the default Open view.
    await waitFor(() => expect(screen.queryByRole("table")).not.toBeInTheDocument());
  });

  it("resolves without sending anything when the report has been replied to and the box is empty", async () => {
    const calls = resolveSetup([{ id: "r0", body: "Earlier reply.", fromAdmin: true, createdAt: "2026-10-02T10:00:00.000Z" }]);
    const user = userEvent.setup();
    renderApp("/admin/reports");
    const form = await openReport(user);
    expect(form.getByRole("button", { name: "Resolve" })).toBeEnabled();
    await user.click(form.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(calls).toEqual([{ url: "resolve", body: { resolved: true } }]));
  });

  it("does not post the reply a second time when resolving fails and is tried again", async () => {
    const calls = resolveSetup([]);
    mock.handlers["PATCH /admin/reports/a"] = (body) => {
      calls.push({ url: "resolve", body });
      return calls.filter((c) => c.url === "resolve").length === 1 ? json(500, { error: "boom" }) : json(200, { ok: true });
    };
    const user = userEvent.setup();
    renderApp("/admin/reports");
    const form = await openReport(user);
    await user.type(form.getByLabelText("Your reply"), "Done.");
    await user.click(form.getByRole("button", { name: "Resolve" }));
    expect(await screen.findByText("Could not resolve it. Please try again.")).toBeInTheDocument();
    // The reply went out and the box emptied; the report is still open, now replied to.
    await waitFor(() => expect(form.getByLabelText("Your reply")).toHaveValue(""));
    await user.click(await within(screen.getByRole("form", { name: "Reply" })).findByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(calls.filter((c) => c.url === "reply")).toHaveLength(1));
    await waitFor(() => expect(calls.filter((c) => c.url === "resolve")).toHaveLength(2));
  });

  it("offers Reopen at the bottom right of a resolved report", async () => {
    const calls = resolveSetup([{ id: "r0", body: "Fixed.", fromAdmin: true, createdAt: "2026-10-02T10:00:00.000Z" }]);
    mock.handlers["GET /admin/reports"] = () =>
      json(200, { reports: [report({ id: "a", status: "resolved", resolvedAt: "2026-10-03T10:00:00.000Z", comments: [{ id: "r0", body: "Fixed.", fromAdmin: true, createdAt: "2026-10-02T10:00:00.000Z" }] })] });
    const user = userEvent.setup();
    renderApp("/admin/reports");
    await user.click(within(await screen.findByRole("group", { name: "Status" })).getByRole("button", { name: /^Resolved/ }));
    await user.click(await screen.findByRole("button", { name: "house → huis" }));
    expect(screen.queryByRole("form", { name: "Reply" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await waitFor(() => expect(calls).toEqual([{ url: "resolve", body: { resolved: false } }]));
  });
});
