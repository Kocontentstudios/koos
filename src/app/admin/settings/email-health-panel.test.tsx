import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailHealthPanel } from "./email-health-panel";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (m: string) => toastError(m),
    success: (m: string) => toastSuccess(m),
  },
}));

const HEALTHY = {
  configured: true,
  missing: [],
  host: "smtp.zoho.com",
  port: 465,
  secure: true,
  smtpUser: "a****@kocontentstudios.com",
  mailFrom: "a****@kocontentstudios.com",
  fromMatchesUser: true,
  inviteLinkBase: "https://staging.kocontentstudios.com",
  vercelEnv: "preview",
  warnings: [],
  notes: [],
  connection: { ok: true, kind: null, detail: null },
};

function mockFetch(health: unknown, testResponse?: Response) {
  return vi.fn(async (url: string) =>
    String(url).includes("/health")
      ? new Response(JSON.stringify(health))
      : (testResponse ?? new Response(JSON.stringify({ ok: true }))),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EmailHealthPanel", () => {
  it("announces the check while it is running", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<EmailHealthPanel />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the mail server",
    );
  });

  it("shows the resolved invite host, which is the other half of the bug", async () => {
    vi.stubGlobal("fetch", mockFetch(HEALTHY));
    render(<EmailHealthPanel />);
    expect(
      await screen.findByText("https://staging.kocontentstudios.com"),
    ).toBeInTheDocument();
    expect(screen.getByText("Connected and delivering")).toBeInTheDocument();
  });

  it("renders every warning the report carries", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ...HEALTHY,
        fromMatchesUser: false,
        warnings: [
          "ZOHO_MAIL_FROM is not the authenticated mailbox.",
          "Invite links point at the production host.",
        ],
      }),
    );
    render(<EmailHealthPanel />);
    expect(
      await screen.findByText(/not the authenticated mailbox/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/point at the production host/),
    ).toBeInTheDocument();
  });

  it("names the failure class when the connection is refused", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ...HEALTHY,
        connection: {
          ok: false,
          kind: "relay",
          detail: "ZOHO_MAIL_FROM must be…",
        },
      }),
    );
    render(<EmailHealthPanel />);
    expect(
      await screen.findByText("Sender address refused"),
    ).toBeInTheDocument();
  });

  /* verify() succeeds against Zoho even when every send is rejected for an
     unregistered From alias, so a green headline above a warning would tell
     the operator the opposite of the truth. */
  it("downgrades the headline when a warning would still break delivery", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ...HEALTHY,
        fromMatchesUser: false,
        warnings: ["ZOHO_MAIL_FROM is not the authenticated mailbox."],
      }),
    );
    render(<EmailHealthPanel />);
    expect(
      await screen.findByText("Authenticated, but delivery is at risk"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Connected and delivering")).toBeNull();
  });

  /* Authenticating proves the credentials, not that a message lands. A green
     tick above an unresolved note reads as an all-clear, so an open question
     gets its own neutral state rather than borrowing the success one. */
  it("does not claim delivery while a note is unresolved", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch({
        ...HEALTHY,
        fromMatchesUser: false,
        notes: ["Confirm it is a registered Zoho alias."],
      }),
    );
    render(<EmailHealthPanel />);
    expect(
      await screen.findByText("Connected — delivery not fully verified"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Connected and delivering")).toBeNull();
    expect(
      screen.getByText("Confirm it is a registered Zoho alias."),
    ).toBeInTheDocument();
  });

  it("keeps the test-send form out of the live region", async () => {
    vi.stubGlobal("fetch", mockFetch(HEALTHY));
    render(<EmailHealthPanel />);
    await screen.findByText("Connected and delivering");
    expect(
      screen
        .getByRole("status")
        .contains(screen.getByLabelText(/send a test email/i)),
    ).toBe(false);
  });

  it("re-checks on demand", async () => {
    const fetchMock = mockFetch(HEALTHY);
    vi.stubGlobal("fetch", fetchMock);
    render(<EmailHealthPanel />);
    await screen.findByText("Connected and delivering");
    await userEvent.click(screen.getByRole("button", { name: /re-check/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  });

  it("keeps Send disabled until an address is typed", async () => {
    vi.stubGlobal("fetch", mockFetch(HEALTHY));
    render(<EmailHealthPanel />);
    const send = await screen.findByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/send a test email/i),
      "a@b.com",
    );
    expect(send).toBeEnabled();
  });

  it("surfaces the server's reason when the test send fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(
        HEALTHY,
        new Response(JSON.stringify({ error: "ZOHO_MAIL_FROM must be…" }), {
          status: 502,
        }),
      ),
    );
    render(<EmailHealthPanel />);
    await userEvent.type(
      await screen.findByLabelText(/send a test email/i),
      "a@b.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("ZOHO_MAIL_FROM must be…"),
    );
  });
});
