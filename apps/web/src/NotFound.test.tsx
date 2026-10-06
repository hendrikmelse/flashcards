import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

beforeEach(() => {
  installMockApi();
  mock.handlers["GET /reports"] = () => json(200, { reports: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("the page not found page", () => {
  it("says what happened and offers the way back, to someone signed in", async () => {
    mock.loggedIn = true;
    renderApp("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(screen.getByText(/There is nothing at this address/)).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Back to the dashboard" })).toHaveAttribute("href", "/");
  });

  it("offers to report it as a bug to someone signed in, with the address in the link", async () => {
    mock.loggedIn = true;
    renderApp("/some/old/page");
    const link = await screen.findByRole("link", { name: "Report it as a bug" });
    expect(link).toHaveAttribute("href", "/reports?report=bug&at=%2Fsome%2Fold%2Fpage");
  });

  it("opens the bug form on the reports page with the address filled in", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/some/old/page");
    await user.click(await screen.findByRole("link", { name: "Report it as a bug" }));
    const form = await screen.findByRole("form", { name: "Report a bug" });
    expect(within(form).getByLabelText("What went wrong?")).toHaveValue("Page not found");
    expect(within(form).getByLabelText("Details")).toHaveValue("I ended up on a page that does not exist: /some/old/page");
    // Ready to send as it is.
    expect(within(form).getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("offers only the way to log in to someone who is signed out", async () => {
    mock.loggedIn = false;
    renderApp("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: "Report it as a bug" })).not.toBeInTheDocument();
  });
});

describe("opening a form from the address", () => {
  it("opens the bug form for /reports?report=bug, empty when no address is given", async () => {
    mock.loggedIn = true;
    renderApp("/reports?report=bug");
    const form = await screen.findByRole("form", { name: "Report a bug" });
    expect(within(form).getByLabelText("What went wrong?")).toHaveValue("");
  });

  it("opens the suggestion form for /reports?report=suggestion", async () => {
    mock.loggedIn = true;
    renderApp("/reports?report=suggestion");
    expect(await screen.findByRole("form", { name: "Suggest a feature" })).toBeInTheDocument();
  });

  it("ignores anything else", async () => {
    mock.loggedIn = true;
    renderApp("/reports?report=pack_request&q=cooking"); // asked for from the pack search, not here
    expect(await screen.findByRole("heading", { name: "Your reports" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    renderApp("/reports?report=nonsense");
    expect(await screen.findByRole("heading", { name: "Your reports" })).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });
});
