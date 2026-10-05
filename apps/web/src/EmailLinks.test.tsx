import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { installMockApi, json, mock, renderApp, USER } from "./test/harness";

let posts: Record<string, unknown[]>;
const record = (path: string, response: ReturnType<typeof json>) => {
  posts[path] = [];
  mock.handlers[`POST ${path}`] = (body) => {
    posts[path]!.push(body);
    return response;
  };
};
const TOKEN = "a".repeat(43);

beforeEach(() => {
  installMockApi();
  mock.loggedIn = false;
  posts = {};
});

describe("asking for a password reset", () => {
  it("is reached from the login page", async () => {
    const user = userEvent.setup();
    renderApp("/login");
    await user.click(await screen.findByRole("link", { name: "Forgot your password?" }));
    expect(await screen.findByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(document.title).toBe("Reset your password · Flashcards");
  });

  it("checks the address, then says to look in the mailbox without saying whether it has an account", async () => {
    record("/auth/forgot-password", json(204));
    const user = userEvent.setup();
    renderApp("/forgot-password");
    const box = await screen.findByLabelText("Email");
    await user.type(box, "nonsense");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(posts["/auth/forgot-password"]).toEqual([]);

    await user.clear(box);
    await user.type(box, " Ann@Example.com ");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(posts["/auth/forgot-password"]).toEqual([{ email: "ann@example.com" }]);
    expect(screen.getByText(/If there is an account for/)).toBeInTheDocument();
  });

  it("says when there were too many attempts", async () => {
    record("/auth/forgot-password", json(429, { error: "slow down" }));
    const user = userEvent.setup();
    renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Email"), "ann@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
  });
});

describe("choosing a new password from the link", () => {
  it("sends the token from the link with the new password, then points to the login page", async () => {
    record("/auth/reset-password", json(204));
    const user = userEvent.setup();
    renderApp(`/reset-password?token=${TOKEN}`);
    const box = await screen.findByLabelText("New password");
    await user.type(box, "short");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Use at least 8 characters.")).toBeInTheDocument();
    expect(posts["/auth/reset-password"]).toEqual([]);

    await user.clear(box);
    await user.type(box, "a brand new password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeInTheDocument();
    expect(posts["/auth/reset-password"]).toEqual([{ token: TOKEN, newPassword: "a brand new password" }]);
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  });

  it("explains an expired or used link, and offers a new one", async () => {
    record("/auth/reset-password", json(400, { error: "This link is invalid or has expired" }));
    const user = userEvent.setup();
    renderApp(`/reset-password?token=${TOKEN}`);
    await user.type(await screen.findByLabelText("New password"), "a brand new password");
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByRole("heading", { name: "This link does not work" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a new link" })).toHaveAttribute("href", "/forgot-password");
  });

  it("explains a link with no token in it", async () => {
    renderApp("/reset-password");
    expect(await screen.findByRole("heading", { name: "This link does not work" })).toBeInTheDocument();
  });

  it("can be opened while signed in", async () => {
    mock.loggedIn = true;
    renderApp(`/reset-password?token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
  });
});

describe("confirming an email address from the link", () => {
  it("confirms as soon as the page opens, once", async () => {
    record("/auth/verify-email", json(200, { status: "verified" }));
    renderApp(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Email confirmed" })).toBeInTheDocument();
    expect(posts["/auth/verify-email"]).toEqual([{ token: TOKEN }]);
  });

  it("says so when it was a change of address", async () => {
    record("/auth/verify-email", json(200, { status: "changed" }));
    renderApp(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Email changed" })).toBeInTheDocument();
  });

  it("explains a link that does not work, and one for an address that has been taken", async () => {
    record("/auth/verify-email", json(400, { error: "invalid" }));
    const { unmount } = renderApp(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "This link does not work" })).toBeInTheDocument();
    unmount();

    record("/auth/verify-email", json(409, { error: "taken" }));
    renderApp(`/verify-email?token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "That address is taken" })).toBeInTheDocument();
  });

  it("does not call the server when the link has no token", async () => {
    record("/auth/verify-email", json(200, { status: "verified" }));
    renderApp("/verify-email");
    expect(await screen.findByRole("heading", { name: "This link does not work" })).toBeInTheDocument();
    expect(posts["/auth/verify-email"]).toEqual([]);
  });
});

describe("the reminder to confirm the email address", () => {
  const unverified = () => {
    mock.loggedIn = true;
    mock.handlers["GET /auth/me"] = () => json(200, { user: { ...USER, emailVerified: false } });
  };

  it("is not shown once the address is confirmed", async () => {
    mock.loggedIn = true;
    renderApp("/");
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(screen.queryByRole("region", { name: "Confirm your email" })).not.toBeInTheDocument();
  });

  it("is shown while it is not, and sends the link again on request", async () => {
    unverified();
    record("/account/verification", json(204));
    const user = userEvent.setup();
    renderApp("/");
    const notice = await screen.findByRole("region", { name: "Confirm your email" });
    expect(notice).toHaveTextContent("ann@example.com");
    await user.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(await screen.findByRole("button", { name: "Link sent" })).toBeDisabled();
    expect(posts["/account/verification"]).toEqual([undefined]);
  });

  it("says when a link was sent a moment ago", async () => {
    unverified();
    record("/account/verification", json(429, { error: "wait" }));
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Send the link again" }));
    expect(await screen.findByText(/sent a moment ago/)).toBeInTheDocument();
  });
});
