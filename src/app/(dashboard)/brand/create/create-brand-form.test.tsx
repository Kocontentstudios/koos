import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { CreateBrandForm } from "./create-brand-form";

vi.mock("@/app/(dashboard)/brand/actions", () => ({
  saveBrandProfile: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("CreateBrandForm pre-fill", () => {
  it("shows the saved brand name when initialBrand is provided", () => {
    render(
      <CreateBrandForm
        initialBrand={{ ...DEFAULT_STATE, name: "Saved Brand Co" }}
      />,
    );
    expect(screen.getByDisplayValue("Saved Brand Co")).toBeInTheDocument();
  });

  it("starts blank when no initialBrand is provided", () => {
    render(<CreateBrandForm />);
    expect(
      screen.queryByDisplayValue("Saved Brand Co"),
    ).not.toBeInTheDocument();
  });
});

/* KOS-V1-FEAT-022 / KOS-V1-BUG-020. The payload is where both halves of the
   font story actually land, and it had no coverage on this side: the server
   test pins what updateBrand receives, but the bug lived in what the FORM
   chose to send. Dropping these two keys makes the whole feature inert, and
   sending `|| undefined` instead of the raw value rebuilds BUG-020 — removal
   silently doing nothing. Neither mutation failed a test before this. */
describe("CreateBrandForm font payload", () => {
  const STORED = "https://cdn.example.com/fonts/u1/1736-a1b2c3.ttf";

  async function submitWith(state: Partial<typeof DEFAULT_STATE>) {
    const { saveBrandProfile } = await import(
      "@/app/(dashboard)/brand/actions"
    );
    const save = vi.mocked(saveBrandProfile);
    save.mockClear();
    save.mockResolvedValue({
      ok: true,
      brandId: "b1",
      snapshot: {},
    } as Awaited<ReturnType<typeof saveBrandProfile>>);

    render(
      <CreateBrandForm
        initialBrand={{
          ...DEFAULT_STATE,
          name: "Acme",
          overview: "We help people do the thing they love every day.",
          businessType: "SaaS / Digital Product",
          stage: "Early (0–50 customers)",
          ...state,
        }}
      />,
    );
    /* "Create Profile" only appears past step 0, so advance one step first —
       navigation is gated on step 0 being valid, which the fixture satisfies. */
    await userEvent.click(
      screen.getByRole("button", { name: /next: brand direction/i }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /create profile/i }),
    );
    return save;
  }

  it("sends a stored font so saving does not drop it", async () => {
    const save = await submitWith({ brandFontUrl: STORED });

    expect(save).toHaveBeenCalled();
    expect(save.mock.calls[0][0]).toMatchObject({ brandFontUrl: STORED });
  });

  /* An empty string has to survive as an empty string. `|| undefined` would
     make it an omission, which the server reads as "leave it alone". */
  it("sends an empty string for a removed font, not an omission", async () => {
    const save = await submitWith({ brandFontUrl: "", bodyFontUrl: "" });

    const payload = save.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toHaveProperty("brandFontUrl", "");
    expect(payload).toHaveProperty("bodyFontUrl", "");
  });
});
