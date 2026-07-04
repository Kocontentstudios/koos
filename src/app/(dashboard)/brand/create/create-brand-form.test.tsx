import { render, screen } from "@testing-library/react";
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
