import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { brandFieldKeys } from "@/lib/ai/tools/proposals";
import { BRAND_FIELD_LABELS, ProposalCard } from "./proposal-card";

describe("ProposalCard", () => {
  it("shows the summary and confirms via the endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Set tone to bold",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    expect(screen.getByText("Set tone to bold")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/actions/confirm",
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith("confirmed", {
        brandCompleted: false,
      }),
    );
    vi.unstubAllGlobals();
  });

  /* The onboarding chat pushes to /brand only when the brand actually reached
     "completed" — /brand bounces anything incomplete back to onboarding, so a
     dropped flag here would strand the user in a redirect. */
  it("passes the brand completion flag through to onDone", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, brandCompleted: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Captured brand",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith("confirmed", {
        brandCompleted: true,
      }),
    );
    vi.unstubAllGlobals();
  });

  it("sends the brandId and proposal as the request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const proposal = {
      kind: "brand_fields" as const,
      summary: "Set tone to bold",
      data: { fields: { tone: "bold" } },
    };
    render(
      <ProposalCard brandId="brand-42" onDone={vi.fn()} proposal={proposal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/actions/confirm",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId: "brand-42", proposal }),
      }),
    );
    vi.unstubAllGlobals();
  });

  it("dismisses without calling the server", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Set tone to bold",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDone).toHaveBeenCalledWith("dismissed");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows an error toast and does not call onDone when confirm fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Something broke" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onDone = vi.fn();
    render(
      <ProposalCard
        brandId="b1"
        onDone={onDone}
        proposal={{
          kind: "brand_fields",
          summary: "Set tone to bold",
          data: { fields: { tone: "bold" } },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /confirm/i }),
      ).not.toBeDisabled(),
    );
    expect(onDone).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  /* This card is a brand-new user's first result in the product. It used to
     render JSON.stringify of the payload, which is fine for a power user deep
     in chat and wrong as a first-run experience. */
  it("labels captured brand fields instead of dumping JSON", () => {
    render(
      <ProposalCard
        brandId="b1"
        onDone={vi.fn()}
        proposal={{
          kind: "brand_fields",
          summary: "Captured your brand",
          data: {
            fields: { targetAudience: "Nigerian women aged 25 to 40" },
          },
        }}
      />,
    );
    expect(screen.getByText("Target audience")).toBeInTheDocument();
    expect(
      screen.getByText("Nigerian women aged 25 to 40"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/"targetAudience":/)).toBeNull();
  });

  it("says so plainly when a proposal captured nothing", () => {
    render(
      <ProposalCard
        brandId="b1"
        onDone={vi.fn()}
        proposal={{
          kind: "brand_fields",
          summary: "Nothing captured",
          data: { fields: {} },
        }}
      />,
    );
    expect(
      screen.getByText(/keep chatting and try again/i),
    ).toBeInTheDocument();
  });

  it("still dumps JSON for the power-user proposal kinds", () => {
    render(
      <ProposalCard
        brandId="b1"
        onDone={vi.fn()}
        proposal={{
          kind: "design_ticket",
          summary: "New ticket",
          data: { designType: "Launch banner", brief: "A banner" },
        }}
      />,
    );
    expect(
      screen.getByText(/"designType": "Launch banner"/),
    ).toBeInTheDocument();
  });

  /* This card is the first screen a new user meets. An unlabelled key renders
     as raw camelCase in uppercase tracking — "COMPETITORSTRENGTHS". */
  it.each(["competitorStrengths", "differentiators"])(
    "labels %s in plain words",
    (field) => {
      render(
        <ProposalCard
          proposal={{
            kind: "brand_fields",
            summary: "Captured your positioning.",
            data: { fields: { [field]: "Bespoke service" } },
          }}
          brandId="b1"
          onDone={() => {}}
        />,
      );
      expect(screen.queryByText(new RegExp(field, "i"))).toBeNull();
    },
  );
});

/* This card is the only human-review gate on the write path: whatever it fails
   to label, the user confirms as a raw camelCase key. A field added to
   brandFieldKeys without a label here is invisible until someone sees
   "POSTINGFREQUENCY" on their first screen in the product. */
describe("every proposable field has a human label", () => {
  it.each([...brandFieldKeys])("%s is labelled", (key) => {
    expect(BRAND_FIELD_LABELS[key]).toBeTruthy();
  });
});
