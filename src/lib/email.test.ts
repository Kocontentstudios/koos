import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTransport = vi.fn();

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransport(...args),
  },
}));

async function loadEmail() {
  vi.resetModules();
  return import("@/lib/email");
}

function configured() {
  vi.stubEnv("ZOHO_SMTP_USER", "admin@example.com");
  vi.stubEnv("ZOHO_SMTP_PASS", "app-password");
}

beforeEach(() => {
  createTransport.mockReset();
  createTransport.mockReturnValue({
    sendMail: vi.fn().mockResolvedValue({ messageId: "1" }),
    verify: vi.fn().mockResolvedValue(true),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SMTP configuration", () => {
  it("names every missing variable", async () => {
    vi.stubEnv("ZOHO_SMTP_USER", "");
    vi.stubEnv("ZOHO_SMTP_PASS", "");
    const { missingSmtpVars } = await loadEmail();
    expect(missingSmtpVars()).toEqual(["ZOHO_SMTP_USER", "ZOHO_SMTP_PASS"]);
  });

  it("refuses to send when a credential is missing", async () => {
    vi.stubEnv("ZOHO_SMTP_USER", "admin@example.com");
    vi.stubEnv("ZOHO_SMTP_PASS", "");
    const { sendMail, describeMailError, mailFailureKind } = await loadEmail();
    const err = await sendMail({
      to: "a@b.com",
      subject: "s",
      html: "<p/>",
    }).catch((e) => e);
    expect(mailFailureKind(err)).toBe("config");
    expect(describeMailError(err)).toContain("ZOHO_SMTP_PASS");
    expect(createTransport).not.toHaveBeenCalled();
  });

  it.each([
    ["unset", undefined],
    ["blank", ""],
    ["whitespace", "   "],
  ])(
    "falls back to the authenticated mailbox when ZOHO_MAIL_FROM is %s",
    async (_case, value) => {
      configured();
      vi.stubEnv("ZOHO_MAIL_FROM", value as string);
      const { mailFrom } = await loadEmail();
      expect(mailFrom()).toBe("admin@example.com");
    },
  );

  /* A variable pasted with a stray space authenticates as whitespace, which
     fails exactly like an unset one — but every presence check calls it set. */
  it("treats whitespace-only credentials as missing", async () => {
    vi.stubEnv("ZOHO_SMTP_USER", "   ");
    vi.stubEnv("ZOHO_SMTP_PASS", "\t");
    const { missingSmtpVars } = await loadEmail();
    expect(missingSmtpVars()).toEqual(["ZOHO_SMTP_USER", "ZOHO_SMTP_PASS"]);
  });

  it("never sends from a padded mailbox", async () => {
    vi.stubEnv("ZOHO_SMTP_USER", "  admin@example.com  ");
    vi.stubEnv("ZOHO_SMTP_PASS", "app-password");
    vi.stubEnv("ZOHO_MAIL_FROM", undefined as unknown as string);
    const { mailFrom } = await loadEmail();
    expect(mailFrom()).toBe("admin@example.com");
  });

  /* The value that actually reaches the wire, not just the helper. */
  it("puts the resolved sender on the outgoing message", async () => {
    configured();
    vi.stubEnv("ZOHO_MAIL_FROM", "hello@example.com");
    const sendMailMock = vi.fn().mockResolvedValue({ messageId: "1" });
    createTransport.mockReturnValue({
      sendMail: sendMailMock,
      verify: vi.fn(),
    });
    const { sendMail } = await loadEmail();
    await sendMail({ to: "a@b.com", subject: "s", html: "<p/>" });
    expect(sendMailMock.mock.calls[0][0].from).toBe("hello@example.com");
  });
});

describe("send deadline", () => {
  /* socketTimeout is an IDLE timeout that re-arms on every SMTP command, so a
     server answering each one just inside it keeps a send alive indefinitely —
     measured at 90s against a 20s idle limit. Without an outer ceiling the
     platform kills the function mid-send and the handler's catch never runs:
     no mail, no log, and a pending invitation nobody can explain. */
  it("gives up on a send that never times out on its own", async () => {
    vi.useFakeTimers();
    try {
      configured();
      createTransport.mockReturnValue({
        sendMail: vi.fn(() => new Promise(() => {})),
        verify: vi.fn(),
      });
      const { sendMail, SMTP_SEND_DEADLINE_MS, mailFailureKind } =
        await loadEmail();
      const pending = sendMail({
        to: "a@b.com",
        subject: "s",
        html: "<p/>",
      }).catch((e) => e);
      await vi.advanceTimersByTimeAsync(SMTP_SEND_DEADLINE_MS + 10);
      expect(mailFailureKind(await pending)).toBe("connection");
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves the deadline strictly inside the route budget", async () => {
    const { SMTP_SEND_DEADLINE_MS, MIN_MAIL_ROUTE_MAX_DURATION } =
      await loadEmail();
    expect(SMTP_SEND_DEADLINE_MS / 1000).toBeLessThan(
      MIN_MAIL_ROUTE_MAX_DURATION,
    );
  });
});

describe("transport timeouts", () => {
  /* The regression this file exists for: without explicit timeouts nodemailer
     waits longer than the serverless function is allowed to live, so a blocked
     SMTP port kills the process before any catch block runs — no mail sent, and
     no log line explaining why. */
  it("caps every timeout below the serverless request budget", async () => {
    configured();
    const { sendMail } = await loadEmail();
    await sendMail({ to: "a@b.com", subject: "s", html: "<p/>" });

    const options = createTransport.mock.calls[0][0] as Record<string, number>;
    expect(options.connectionTimeout).toBeLessThanOrEqual(10_000);
    expect(options.greetingTimeout).toBeLessThanOrEqual(10_000);
    expect(options.socketTimeout).toBeLessThanOrEqual(20_000);
  });

  /* The password is what actually reaches AUTH. Trimming it for the
     "configured" check but not here is how the diagnostic script and the app
     end up sending different bytes and reporting different verdicts. */
  it("authenticates with the trimmed credentials", async () => {
    vi.stubEnv("ZOHO_SMTP_USER", "  bot@koos.app ");
    vi.stubEnv("ZOHO_SMTP_PASS", "app-password ");
    const { sendMail } = await loadEmail();
    await sendMail({ to: "a@b.com", subject: "s", html: "<p/>" });
    const options = createTransport.mock.calls[0][0] as {
      auth: { user: string; pass: string };
    };
    expect(options.auth).toEqual({
      user: "bot@koos.app",
      pass: "app-password",
    });
  });

  it("reuses one transport across sends", async () => {
    configured();
    const { sendMail } = await loadEmail();
    await sendMail({ to: "a@b.com", subject: "s", html: "<p/>" });
    await sendMail({ to: "c@d.com", subject: "s", html: "<p/>" });
    expect(createTransport).toHaveBeenCalledOnce();
  });
});

function smtpError(props: {
  code?: string;
  command?: string;
  responseCode?: number;
}) {
  return Object.assign(new Error("boom"), props);
}

describe("smtpSecure", () => {
  /* Defaulting to secure regardless of port makes port 587 fail the TLS
     handshake with ETLS — a one-variable misconfiguration reported as a dead
     connection. */
  it.each([
    ["465", true],
    ["587", false],
    ["2525", false],
  ])("implies secure from port %s", async (port, expected) => {
    const { smtpSecure } = await loadEmail();
    expect(smtpSecure({ ZOHO_SMTP_PORT: port })).toBe(expected);
  });

  it.each(["FALSE", "False", "0", "no", "off"])(
    "treats %j as insecure",
    async (value) => {
      const { smtpSecure } = await loadEmail();
      expect(
        smtpSecure({ ZOHO_SMTP_PORT: "587", ZOHO_SMTP_SECURE: value }),
      ).toBe(false);
    },
  );

  it("still honours an explicit setting", async () => {
    const { smtpSecure } = await loadEmail();
    expect(
      smtpSecure({ ZOHO_SMTP_PORT: "587", ZOHO_SMTP_SECURE: "true" }),
    ).toBe(true);
    expect(
      smtpSecure({ ZOHO_SMTP_PORT: "465", ZOHO_SMTP_SECURE: "false" }),
    ).toBe(false);
  });
});

describe("sendMail tagging", () => {
  /* Tagged at the boundary rather than at each call site, so a caller that
     mixes a database write and a send in one try block cannot report the
     database failure as an email problem by forgetting to wrap. */
  it("tags a transport failure without any help from the caller", async () => {
    configured();
    createTransport.mockReturnValue({
      sendMail: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("x"), { code: "EAUTH" })),
      verify: vi.fn(),
    });
    const { sendMail, isMailError, mailFailureKind } = await loadEmail();
    const err = await sendMail({
      to: "a@b.com",
      subject: "s",
      html: "<p/>",
    }).catch((e) => e);
    expect(isMailError(err)).toBe(true);
    expect(mailFailureKind(err)).toBe("auth");
  });

  it("tags a missing configuration too", async () => {
    vi.stubEnv("ZOHO_SMTP_USER", "");
    vi.stubEnv("ZOHO_SMTP_PASS", "");
    const { sendMail, isMailError, mailFailureKind } = await loadEmail();
    const err = await sendMail({
      to: "a@b.com",
      subject: "s",
      html: "<p/>",
    }).catch((e) => e);
    expect(isMailError(err)).toBe(true);
    expect(mailFailureKind(err)).toBe("config");
  });
});

describe("smtpHost", () => {
  it.each(["", "   ", undefined])("falls back for %j", async (value) => {
    const { smtpHost } = await loadEmail();
    expect(smtpHost({ ZOHO_SMTP_HOST: value as string })).toBe("smtp.zoho.com");
  });

  it("trims a padded host", async () => {
    const { smtpHost } = await loadEmail();
    expect(smtpHost({ ZOHO_SMTP_HOST: "  mail.example.com " })).toBe(
      "mail.example.com",
    );
  });
});

describe("isMailError", () => {
  /* postgres.js rejects a query with a plain Error carrying a raw socket code
     when the database is unreachable, so a code-based test reports a DATABASE
     outage as an email failure. The invite route then promises a saved
     invitation that was never written. Type tagging is what separates them. */
  it.each(["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH"])(
    "does not mistake a postgres %s for a mail failure",
    async (code) => {
      const { isMailError } = await loadEmail();
      expect(
        isMailError(Object.assign(new Error("write CONNECT"), { code })),
      ).toBe(false);
    },
  );

  it("recognises anything thrown inside tagMailFailures", async () => {
    const { isMailError, tagMailFailures } = await loadEmail();
    const err = await tagMailFailures(async () => {
      throw Object.assign(new Error("nope"), { code: "ECONNREFUSED" });
    }).catch((e) => e);
    expect(isMailError(err)).toBe(true);
  });

  it("classifies through the wrapper", async () => {
    const { mailFailureKind, tagMailFailures } = await loadEmail();
    const err = await tagMailFailures(async () => {
      throw Object.assign(new Error("relay"), { responseCode: 553 });
    }).catch((e) => e);
    expect(mailFailureKind(err)).toBe("relay");
  });
  /* The invite route promises "the invitation was saved" only for mail
     failures. A database error must not be dressed up as an email problem. */
  it("rejects a plain application error", async () => {
    const { isMailError } = await loadEmail();
    expect(
      isMailError(new Error("duplicate key value violates constraint")),
    ).toBe(false);
    expect(isMailError("nope")).toBe(false);
  });

  /* An untagged SMTP-shaped error is deliberately NOT accepted: the same shape
     arrives from postgres, so origin is the only reliable signal. */
  it.each([
    smtpError({ responseCode: 553 }),
    smtpError({ code: "EAUTH" }),
    smtpError({ code: "ETIMEDOUT" }),
    smtpError({ code: "EENVELOPE" }),
  ])("accepts an SMTP failure only once tagged %#", async (err) => {
    const { isMailError, tagMailFailures } = await loadEmail();
    expect(isMailError(err)).toBe(false);
    const tagged = await tagMailFailures(async () => {
      throw err;
    }).catch((e) => e);
    expect(isMailError(tagged)).toBe(true);
  });

  it("accepts a configuration error", async () => {
    const { isMailError, EmailConfigError } = await loadEmail();
    expect(isMailError(new EmailConfigError(["ZOHO_SMTP_PASS"]))).toBe(true);
  });
});

describe("nodemailer code coverage", () => {
  /* Not a tautology: this compares the library's table against OUR
     classification map, so a nodemailer upgrade that adds a code fails here
     instead of silently classifying it as "unknown". */
  it("classifies every code the library documents", async () => {
    const { NODEMAILER_ERROR_CODES, MAIL_ERROR_KINDS } = await loadEmail();
    const unmapped = NODEMAILER_ERROR_CODES.filter(
      (code) => !(code in MAIL_ERROR_KINDS),
    );
    expect(unmapped).toEqual([]);
  });

  /* Transports this app does not use; nothing actionable to say about them. */
  it("leaves only the transports we do not use unclassified", async () => {
    const { NODEMAILER_ERROR_CODES, MAIL_ERROR_KINDS } = await loadEmail();
    const unknown = NODEMAILER_ERROR_CODES.filter(
      (code) => MAIL_ERROR_KINDS[code] === "unknown",
    );
    expect(unknown.sort()).toEqual(["ESENDMAIL", "ESES"]);
  });

  /* These are the codes an operator can actually act on. Leaving one at
     "unknown" means the panel says "the email could not be sent" and stops. */
  it.each([
    "ETLS",
    "EREQUIRETLS",
    "EAUTH",
    "ENOAUTH",
    "EOAUTH2",
    "EENVELOPE",
    "EMESSAGE",
    "ECONFIG",
    "ETIMEDOUT",
    "ESOCKET",
    "ECONNECTION",
    "EDNS",
    "EPROXY",
  ])("gives %s an actionable classification", async (code) => {
    const { mailFailureKind } = await loadEmail();
    expect(mailFailureKind(Object.assign(new Error("x"), { code }))).not.toBe(
      "unknown",
    );
  });
});

describe("TLS / port mismatch", () => {
  /* Measured, not assumed: talking implicit TLS to a STARTTLS port fails as
     ESOCKET "wrong version number", never as ETLS — nodemailer only emits
     ETLS from tls.connect's own error callback, which this path never
     reaches. Classifying it as `connection` sent the operator to look for a
     firewall and told the owner to retry a permanent misconfiguration. */
  it.each([
    "140A0000:SSL routines::wrong version number",
    "packet length too long",
    "record layer failure",
  ])("recognises %j as a TLS mismatch", async (message) => {
    const { mailFailureKind, retryCanHelp, operatorMailMessage } =
      await loadEmail();
    const err = Object.assign(new Error(message), {
      code: "ESOCKET",
      command: "CONN",
    });
    expect(mailFailureKind(err)).toBe("tls");
    expect(retryCanHelp(err)).toBe(false);
    expect(operatorMailMessage(err)).toContain("ZOHO_SMTP_SECURE");
  });

  /* A proxy or captive portal answering on the SMTP port is not a TLS
     problem, and blaming ZOHO_SMTP_SECURE for it is a misdirection. */
  it("does not blame TLS for a proxy answering HTTP", async () => {
    const { mailFailureKind } = await loadEmail();
    expect(
      mailFailureKind(
        Object.assign(new Error("Invalid greeting"), {
          code: "EPROTOCOL",
          command: "CONN",
          response: "HTTP/1.1 200 OK",
        }),
      ),
    ).toBe("connection");
  });
});

describe("transient auth", () => {
  /* Zoho and Google answer repeated bad app-password attempts with
     "454 4.7.0 Temporary authentication failure". The 4xx makes it retryable,
     but the diagnosis must still say authentication, not sending limits. */
  it("keeps the auth diagnosis on a 454 while allowing a retry", async () => {
    const { mailFailureKind, retryCanHelp, operatorMailMessage } =
      await loadEmail();
    const err = Object.assign(new Error("Temporary authentication failure"), {
      code: "EAUTH",
      command: "AUTH PLAIN",
      responseCode: 454,
    });
    expect(mailFailureKind(err)).toBe("auth");
    expect(retryCanHelp(err)).toBe(true);
    expect(operatorMailMessage(err)).toContain("app password");
  });
});

describe("recipient vs sender at RCPT", () => {
  /* Postfix's reject_sender_login_mismatch refuses the SENDER at RCPT stage,
     so the stage alone would tell the owner to check the invitee's spelling. */
  it("blames the sender when the response names it", async () => {
    const { mailFailureKind } = await loadEmail();
    expect(
      mailFailureKind(
        Object.assign(new Error("rejected"), {
          code: "EENVELOPE",
          command: "RCPT TO",
          responseCode: 553,
          response: "553 5.7.1 Sender address rejected: not owned by user",
        }),
      ),
    ).toBe("relay");
  });

  it("still blames the address for an ordinary rejection", async () => {
    const { mailFailureKind } = await loadEmail();
    expect(
      mailFailureKind(
        Object.assign(new Error("rejected"), {
          code: "EENVELOPE",
          command: "RCPT TO",
          responseCode: 550,
          response: "550 5.1.1 User unknown",
        }),
      ),
    ).toBe("recipient");
  });
});

describe("partial recipient rejection", () => {
  /* nodemailer only throws when EVERY recipient is refused; a partial
     rejection resolves, and nothing downstream would ever learn about it. */
  it("throws when the server dropped some recipients", async () => {
    configured();
    createTransport.mockReturnValue({
      sendMail: vi
        .fn()
        .mockResolvedValue({ accepted: ["a@b.com"], rejected: ["c@d.com"] }),
      verify: vi.fn(),
    });
    const { sendMail, mailFailureKind } = await loadEmail();
    const err = await sendMail({
      to: ["a@b.com", "c@d.com"],
      subject: "s",
      html: "<p/>",
    }).catch((e) => e);
    expect(mailFailureKind(err)).toBe("recipient");
  });
});

describe("smtpPort", () => {
  it.each(["0", "-1", "99999", "465.9", "abc", ""])(
    "falls back for the unusable value %j",
    async (value) => {
      const { smtpPort } = await loadEmail();
      expect(smtpPort({ ZOHO_SMTP_PORT: value })).toBe(465);
    },
  );

  it("keeps a valid port", async () => {
    const { smtpPort } = await loadEmail();
    expect(smtpPort({ ZOHO_SMTP_PORT: "587" })).toBe(587);
  });
});

describe("prototype keys", () => {
  it("does not read a kind off Object.prototype", async () => {
    const { mailFailureKind, operatorMailMessage } = await loadEmail();
    const err = Object.assign(new Error("x"), { code: "toString" });
    expect(mailFailureKind(err)).toBe("unknown");
    expect(typeof operatorMailMessage(err)).toBe("string");
  });
});

describe("envelope rejections", () => {
  /* nodemailer raises EENVELOPE for RCPT TO as well as MAIL FROM. Reading only
     the code told a workspace owner our SENDER was refused when the invitee's
     address was the problem — sending them to press Resend forever, and the
     operator to Zoho's alias settings. The command says which end failed. */
  it("blames the recipient when RCPT TO fails", async () => {
    const { mailFailureKind } = await loadEmail();
    expect(
      mailFailureKind(
        Object.assign(new Error("no such user"), {
          code: "EENVELOPE",
          command: "RCPT TO",
          responseCode: 550,
        }),
      ),
    ).toBe("recipient");
  });

  /* No EENVELOPE code here: with one, the map alone answers "relay" and the
     assertion would pass even with the command split removed. */
  /* A size or content refusal at DATA carries code EENVELOPE, which the code
     map alone calls a sender problem — sending the operator to Zoho's alias
     settings for a content-filter rejection. */
  it("blames the message when DATA is refused", async () => {
    const { mailFailureKind, operatorMailMessage } = await loadEmail();
    const err = Object.assign(new Error("Data command failed"), {
      code: "EENVELOPE",
      command: "DATA",
      responseCode: 554,
    });
    expect(mailFailureKind(err)).toBe("message");
    expect(operatorMailMessage(err)).not.toContain("ZOHO_MAIL_FROM");
  });

  it("blames the sender when MAIL FROM fails", async () => {
    const { mailFailureKind } = await loadEmail();
    expect(
      mailFailureKind(
        Object.assign(new Error("relay denied"), {
          command: "MAIL FROM",
          responseCode: 550,
        }),
      ),
    ).toBe("relay");
  });

  /* Greylisting is the most common rejection in SMTP and it answers 451 to
     RCPT TO. Reading the command before the response code called a correct,
     retryable address permanently unroutable. */
  it.each([
    ["RCPT TO", 451],
    ["RCPT TO", 421],
    ["MAIL FROM", 450],
  ])(
    "treats a 4xx at %s as transient, not permanent",
    async (command, responseCode) => {
      const { mailFailureKind, retryCanHelp } = await loadEmail();
      const err = Object.assign(new Error("try again later"), {
        code: "EENVELOPE",
        command,
        responseCode,
      });
      expect(mailFailureKind(err)).toBe("throttled");
      expect(retryCanHelp(err)).toBe(true);
    },
  );

  it("tells the operator a rejected recipient is not a deployment problem", async () => {
    const { operatorMailMessage } = await loadEmail();
    const message = operatorMailMessage(
      Object.assign(new Error("x"), { command: "RCPT TO", responseCode: 550 }),
    );
    expect(message).not.toContain("ZOHO_MAIL_FROM");
    expect(message).toContain("recipient");
  });
});

describe("retryCanHelp", () => {
  /* Resending changes nothing when the deployment has no credentials, when the
     sender address is refused, or when the address itself is unroutable. */
  it.each([
    smtpError({ command: "RCPT TO", responseCode: 550 }),
    smtpError({ command: "MAIL FROM", responseCode: 553 }),
  ])("is false for %#", async (err) => {
    const { retryCanHelp } = await loadEmail();
    expect(retryCanHelp(err)).toBe(false);
  });

  it("is false for a missing configuration", async () => {
    const { retryCanHelp, EmailConfigError } = await loadEmail();
    expect(retryCanHelp(new EmailConfigError(["ZOHO_SMTP_USER"]))).toBe(false);
  });

  /* Both are real outages in this deployment's history: the 535 EAUTH from a
     non-app-password, and TLS misconfigured for the port. Every retry
     re-authenticates with the same bad credential and fails identically. */
  it.each([
    smtpError({ code: "EAUTH", responseCode: 535 }),
    smtpError({ code: "ETLS" }),
  ])("is false for the permanent misconfiguration %#", async (err) => {
    const { retryCanHelp } = await loadEmail();
    expect(retryCanHelp(err)).toBe(false);
  });

  it.each([smtpError({ code: "ETIMEDOUT" }), smtpError({ responseCode: 421 })])(
    "is true for the transient failure %#",
    async (err) => {
      const { retryCanHelp } = await loadEmail();
      expect(retryCanHelp(err)).toBe(true);
    },
  );
});

describe("tenantMailMessage", () => {
  /* A customer's workspace owner cannot set an env var, cannot redeploy, and
     should not learn which mail vendor we use. */
  it.each([
    smtpError({ responseCode: 553 }),
    smtpError({ code: "EAUTH" }),
    smtpError({ code: "ETIMEDOUT" }),
  ])("names no internals for %#", async (err) => {
    const { tenantMailMessage } = await loadEmail();
    const message = tenantMailMessage(err);
    expect(message).not.toMatch(/ZOHO|SMTP|env|redeploy|2FA/i);
    expect(message.length).toBeGreaterThan(0);
  });

  it("says nothing about our configuration when unconfigured", async () => {
    const { tenantMailMessage, EmailConfigError } = await loadEmail();
    expect(
      tenantMailMessage(new EmailConfigError(["ZOHO_SMTP_USER"])),
    ).not.toContain("ZOHO_SMTP_USER");
  });
});

describe("mailFailureKind", () => {
  /* Codes come from nodemailer's own exported table, so an upgrade cannot
     leave one silently unhandled. ETLS is the port-587 misconfiguration. */
  it.each([
    ["tls", smtpError({ code: "ETLS" })],
    ["tls", smtpError({ code: "EREQUIRETLS" })],
    ["auth", smtpError({ code: "ENOAUTH" })],
    ["auth", smtpError({ code: "EOAUTH2" })],
    ["relay", smtpError({ code: "EENVELOPE" })],
    ["config", smtpError({ code: "ECONFIG" })],
    ["throttled", smtpError({ responseCode: 421 })],
    ["throttled", smtpError({ responseCode: 451 })],
    ["auth", smtpError({ code: "EAUTH", responseCode: 535 })],
    ["relay", smtpError({ responseCode: 553 })],
    // 550 is the far end refusing the mailbox, not our sender being refused.
    ["recipient", smtpError({ responseCode: 550 })],
    ["recipient", smtpError({ responseCode: 551 })],
    ["recipient", smtpError({ responseCode: 552 })],
    ["connection", smtpError({ code: "ETIMEDOUT" })],
    ["connection", smtpError({ code: "ESOCKET" })],
    ["unknown", smtpError({ code: "EWEIRD" })],
    ["connection", smtpError({ code: "EPROXY" })],
    ["unknown", "not an error"],
  ])("classifies %s", async (kind, err) => {
    const { mailFailureKind } = await loadEmail();
    expect(mailFailureKind(err)).toBe(kind);
  });

  it("classifies a missing configuration as config", async () => {
    const { mailFailureKind, EmailConfigError } = await loadEmail();
    expect(mailFailureKind(new EmailConfigError(["ZOHO_SMTP_PASS"]))).toBe(
      "config",
    );
  });
});

describe("operatorMailMessage", () => {
  it("names the fix for a relay rejection without leaking the server response", async () => {
    const { operatorMailMessage } = await loadEmail();
    const message = operatorMailMessage(
      Object.assign(new Error("553 relaying disallowed"), {
        responseCode: 553,
        response: "553 Relaying disallowed as hello@example.com",
      }),
    );
    expect(message).toContain("ZOHO_MAIL_FROM");
    expect(message).not.toContain("hello@example.com");
  });

  it("tells the operator which variables to set when unconfigured", async () => {
    const { operatorMailMessage, EmailConfigError } = await loadEmail();
    expect(
      operatorMailMessage(new EmailConfigError(["ZOHO_SMTP_USER"])),
    ).toContain("ZOHO_SMTP_USER");
  });
});

describe("describeMailError", () => {
  /* Every failure on the invite path arrives tagged, because sendMail tags
     itself. A describeMailError that did not unwrap reduced the only log line
     that matters to "Sending mail failed" — while a test feeding an UNTAGGED
     error stayed green. */
  it("keeps the diagnostics through the tag", async () => {
    const { describeMailError, MailSendError } = await loadEmail();
    const described = describeMailError(
      new MailSendError(
        Object.assign(new Error("Invalid login"), {
          code: "EAUTH",
          responseCode: 535,
          response: "535 Authentication Failed",
        }),
      ),
    );
    expect(described).toContain("code=EAUTH");
    expect(described).toContain("535 Authentication Failed");
    expect(described).not.toBe("Sending mail failed");
  });

  it("unwraps a doubly-tagged failure", async () => {
    const { describeMailError, MailSendError } = await loadEmail();
    const inner = Object.assign(new Error("relay"), { responseCode: 553 });
    expect(
      describeMailError(new MailSendError(new MailSendError(inner))),
    ).toContain("responseCode=553");
  });

  it("unwraps a tagged configuration error", async () => {
    const { describeMailError, MailSendError, EmailConfigError } =
      await loadEmail();
    expect(
      describeMailError(
        new MailSendError(new EmailConfigError(["ZOHO_SMTP_PASS"])),
      ),
    ).toContain("ZOHO_SMTP_PASS");
  });

  it("keeps the SMTP code and server response for the log", async () => {
    const { describeMailError } = await loadEmail();
    const described = describeMailError(
      Object.assign(new Error("Invalid login"), {
        code: "EAUTH",
        command: "AUTH PLAIN",
        responseCode: 535,
        response: "535 Authentication Failed",
      }),
    );
    expect(described).toContain("code=EAUTH");
    expect(described).toContain("responseCode=535");
    expect(described).toContain("535 Authentication Failed");
  });

  it("stringifies a non-Error throw", async () => {
    const { describeMailError } = await loadEmail();
    expect(describeMailError("nope")).toBe("nope");
  });

  it("says something useful for an empty cause", async () => {
    const { describeMailError, MailSendError } = await loadEmail();
    expect(describeMailError(new MailSendError(null))).toContain(
      "no cause recorded",
    );
  });
});

describe("unwrap depth", () => {
  it("does not spin on a self-referential cause", async () => {
    const { MailSendError, mailFailureKind } = await loadEmail();
    const looped = new MailSendError(null) as Error & { cause: unknown };
    looped.cause = looped;
    expect(mailFailureKind(looped)).toBe("unknown");
  });

  /* The bound must stay small enough to be a bound. Raising it to a huge
     number keeps the test above green while restoring the hang. */
  it("gives up after a shallow depth, not an effectively unbounded one", async () => {
    const { MailSendError, mailFailureKind, EmailConfigError } =
      await loadEmail();
    let nested: unknown = new EmailConfigError(["ZOHO_SMTP_PASS"]);
    for (let i = 0; i < 12; i += 1) nested = new MailSendError(nested);
    expect(mailFailureKind(nested)).toBe("config");

    let tooDeep: unknown = new EmailConfigError(["ZOHO_SMTP_PASS"]);
    for (let i = 0; i < 64; i += 1) tooDeep = new MailSendError(tooDeep);
    expect(mailFailureKind(tooDeep)).toBe("unknown");
  });
});

describe("MIN_MAIL_ROUTE_MAX_DURATION", () => {
  /* The floor is derived so that lowering a timeout fails the route guard. It
     must also stay ABOVE the timeouts, or the derivation is decorative and the
     guard passes budgets that cannot outlive a stalled send. */
  it("exceeds the total SMTP timeout budget", async () => {
    const { MIN_MAIL_ROUTE_MAX_DURATION, SMTP_TIMEOUTS } = await loadEmail();
    const budgetSeconds =
      (SMTP_TIMEOUTS.connectionTimeout +
        SMTP_TIMEOUTS.greetingTimeout +
        SMTP_TIMEOUTS.socketTimeout) /
      1000;
    expect(MIN_MAIL_ROUTE_MAX_DURATION).toBeGreaterThan(budgetSeconds);
  });
});

describe("verifyTransport", () => {
  it("authenticates without sending", async () => {
    configured();
    const verify = vi.fn().mockResolvedValue(true);
    createTransport.mockReturnValue({ sendMail: vi.fn(), verify });
    const { verifyTransport } = await loadEmail();
    await expect(verifyTransport()).resolves.toBe(true);
    expect(verify).toHaveBeenCalledOnce();
  });
});
