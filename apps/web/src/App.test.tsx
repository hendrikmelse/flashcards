import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installMockApi, json, mock, renderApp } from "./test/harness";

beforeEach(() => installMockApi());
afterEach(() => vi.unstubAllGlobals());

describe("auth flow", () => {
  it("redirects anonymous visitors to the login page", async () => {
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("logs in and lands on the dashboard", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Cards in deck")).toBeInTheDocument();
  });

  it("shows an error for wrong credentials and stays on the form", async () => {
    mock.handlers["POST /auth/login"] = () => json(401, { error: "Invalid email or password" });
    const user = userEvent.setup();
    renderApp("/login");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.getByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });

  it("validates on the client before calling the API", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign up" }));

    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(mock.calls).not.toContain("POST /auth/register");
  });

  it("registers a new account", async () => {
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("explains when the email is already registered", async () => {
    mock.handlers["POST /auth/register"] = () => json(409, { error: "Email already registered" });
    const user = userEvent.setup();
    renderApp("/register");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
  });

  it("sends signed-in users away from the login page", async () => {
    mock.loggedIn = true;
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("logs out back to the login page", async () => {
    mock.loggedIn = true;
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Log in" })).toBeInTheDocument();
  });
});

describe("dashboard", () => {
  it("shows what is due, what is new, and deck progress", async () => {
    mock.loggedIn = true;
    renderApp("/");
    const today = await screen.findByRole("region", { name: "Today" });
    await waitFor(() => expect(today).toHaveTextContent("4Due now")); // learning 1 + review 3
    expect(today).toHaveTextContent("7New available today");
    expect(today).toHaveTextContent("12Cards in deck");
    expect(screen.getByRole("region", { name: "Progress" })).toHaveTextContent("3Learning"); // 2 + 1
  });

  it("shows an empty state for a new user", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () =>
      json(200, {
        summary: { total: 0, new: 0, learning: 0, relearning: 0, review: 0, dueNow: 0 },
      });
    mock.handlers["GET /study?limit=1"] = () =>
      json(200, { now: "x", counts: { learning: 0, review: 0, new: 0 } });
    renderApp("/");
    expect(await screen.findByText(/Your deck is empty/)).toBeInTheDocument();
  });

  it("shows an error when the data cannot be loaded", async () => {
    mock.loggedIn = true;
    mock.handlers["GET /deck?limit=1"] = () => json(500, { error: "boom" });
    renderApp("/");
    expect(await screen.findByText(/Could not load your dashboard/)).toBeInTheDocument();
  });
});
