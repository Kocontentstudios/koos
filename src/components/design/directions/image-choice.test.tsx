import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageChoice, laidOut } from "./image-choice";

const handlers = {
  onUseOwnImage: vi.fn(),
  onLetKoCreate: vi.fn(),
  onNoImage: vi.fn(),
  onFileDropped: vi.fn(),
};

/* Integration round 2, LOW 2: a carousel's image step still promised "KO
   lays out both designs", though the run makes one carousel. */
describe("ImageChoice", () => {
  it.each([
    [false, "Your words lead. KO lays out every slide of your carousel"],
    [true, "then builds every slide of your carousel around it"],
  ])("promises a set what the run makes (KO imagery %s)", (koImagery, said) => {
    render(
      <ImageChoice koImagery={koImagery} setKind="carousel" {...handlers} />,
    );
    expect(screen.getByText(new RegExp(said))).toBeInTheDocument();
    expect(screen.queryByText(/both designs/)).toBeNull();
  });

  it("still promises two directions to a single design", () => {
    render(<ImageChoice koImagery={false} {...handlers} />);
    expect(screen.getByText(/KO lays out both designs/)).toBeInTheDocument();
  });

  it("names a deck as one", () => {
    expect(laidOut("presentation")).toBe("every slide of your presentation");
    expect(laidOut(null)).toBe("both designs");
  });
});
