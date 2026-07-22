import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuickRequestForm } from "./quick-request-form";

vi.mock("./actions", () => ({
  ensureQuickRequestBrand: vi.fn(async () => ({ ok: true, brandId: "b1" })),
}));

function renderForm() {
  return render(
    <QuickRequestForm
      defaultBusinessName="Ada Bakes"
      defaultDeliveryEmail="hello@adabakes.com"
    />,
  );
}

describe("QuickRequestForm", () => {
  it("prefills the business name and delivery email", () => {
    renderForm();
    expect(screen.getByLabelText(/business name/i)).toHaveValue("Ada Bakes");
    expect(screen.getByLabelText(/delivery email/i)).toHaveValue(
      "hello@adabakes.com",
    );
  });

  it("shows a validation error when the description is too short", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/describe/i), {
      target: { value: "logo" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(screen.getByText(/at least 20 characters/i)).toBeInTheDocument();
  });

  it("hides the slides field for non-carousel design types", () => {
    renderForm();
    expect(screen.queryByLabelText(/slides/i)).not.toBeInTheDocument();
  });

  it("shows the slides field once a carousel type is selected", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/what do you need/i), {
      target: { value: "Instagram Carousel (1080x1350 per slide)" },
    });
    expect(screen.getByLabelText(/slides/i)).toBeInTheDocument();
  });
});
