import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandSnapshotCard } from "./brand-snapshot-card";

const FULL = {
  name: "Soyeè.ng",
  logoUrl: "https://cdn.example.com/logo.png",
  overview: "Where Elegance meets modesty",
  businessType: "Modest Fashion",
  stage: "Womenswear",
  targetAudience:
    "Muslim women worldwide who value modest fashion, elegance, and quality.",
  tone: "Elegant, Warm, Sophisticated, Timeless",
  primaryColor: "#3a2a1f",
  secondaryColor: "#faf7f2",
  additionalColors: ["#d4b8a0"],
};

describe("BrandSnapshotCard", () => {
  it("renders every field the design calls for", () => {
    render(<BrandSnapshotCard brand={FULL} />);

    expect(screen.getByText("Brand Setup Complete!")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Brand Snapshot" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Soyeè.ng" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Modest Fashion — Womenswear")).toBeInTheDocument();
    expect(
      screen.getByText(/Where Elegance meets modesty/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Muslim women worldwide/)).toBeInTheDocument();
    expect(screen.getByAltText("Soyeè.ng logo")).toBeInTheDocument();
  });

  it("routes both buttons where the ticket says", () => {
    render(<BrandSnapshotCard brand={FULL} />);
    expect(
      screen.getByRole("link", { name: "Go to Dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    expect(
      screen.getByRole("link", { name: "View Full Brand Profile" }),
    ).toHaveAttribute("href", "/brand");
  });

  describe("tone", () => {
    it("renders one badge per adjective", () => {
      render(<BrandSnapshotCard brand={FULL} />);
      for (const word of ["Elegant", "Warm", "Sophisticated", "Timeless"]) {
        expect(screen.getByText(word)).toBeInTheDocument();
      }
    });

    /* The manual form stores one compound option, not a list. */
    it("splits a canonical compound option into badges", () => {
      render(
        <BrandSnapshotCard
          brand={{ ...FULL, tone: "Friendly & Educational" }}
        />,
      );
      expect(screen.getByText("Friendly")).toBeInTheDocument();
      expect(screen.getByText("Educational")).toBeInTheDocument();
    });

    /* The conversational path can store a sentence. Forcing that into a pill
       would produce one badge the width of the card. */
    it("falls back to plain text for a tone written as prose", () => {
      const prose = "we speak like a friend who already knows fashion";
      render(<BrandSnapshotCard brand={{ ...FULL, tone: prose }} />);
      expect(screen.getByText(prose)).toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeNull(); // the palette list
    });

    it("drops the section when no tone was captured", () => {
      render(<BrandSnapshotCard brand={{ ...FULL, tone: null }} />);
      expect(screen.queryByText(/Brand voice/i)).not.toBeInTheDocument();
    });
  });

  describe("palette", () => {
    it("shows a dot and the hex for each colour", () => {
      render(<BrandSnapshotCard brand={FULL} />);
      expect(screen.getByText("#3A2A1F")).toBeInTheDocument();
      expect(screen.getByText("#FAF7F2")).toBeInTheDocument();
      expect(screen.getByText("#D4B8A0")).toBeInTheDocument();
    });

    /* Colours are stored unvalidated so the conversational path can keep what
       the user said. A colour name must not paint an invisible dot. */
    it("labels an unrenderable colour instead of drawing a blank dot", () => {
      const { container } = render(
        <BrandSnapshotCard
          brand={{
            ...FULL,
            primaryColor: "deep forest green",
            secondaryColor: null,
            additionalColors: null,
          }}
        />,
      );
      expect(screen.getByText("deep forest green")).toBeInTheDocument();
      expect(
        container.querySelectorAll("[style*='background-color']"),
      ).toHaveLength(0);
    });

    it("drops the section when no colour was captured", () => {
      render(
        <BrandSnapshotCard
          brand={{
            ...FULL,
            primaryColor: null,
            secondaryColor: null,
            additionalColors: null,
          }}
        />,
      );
      expect(screen.queryByText(/Visual palette/i)).not.toBeInTheDocument();
    });
  });

  /* The conversational path cannot set a logo at all — logoUrl is not among
     the fields the model may write — so this is the common case, not an edge. */
  it("falls back to the initial when there is no logo", () => {
    render(<BrandSnapshotCard brand={{ ...FULL, logoUrl: null }} />);
    expect(screen.queryByAltText("Soyeè.ng logo")).not.toBeInTheDocument();
    expect(screen.getByText("S")).toBeInTheDocument();
  });

  /* Every section below Basics is optional in the form, so a brand that
     answered only the required questions must still render as a card. */
  it("renders a Basics-only brand without empty headings", () => {
    render(
      <BrandSnapshotCard
        brand={{
          name: "Basics Only Co",
          overview: "We sell handwoven bags.",
          businessType: "Retail",
          stage: "Pre-launch",
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Basics Only Co" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Retail — Pre-launch")).toBeInTheDocument();
    expect(screen.queryByText(/Target audience/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Brand voice/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Visual palette/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to Dashboard" }),
    ).toBeInTheDocument();
  });

  it("shows no identity pill when neither type nor stage was given", () => {
    render(
      <BrandSnapshotCard
        brand={{ name: "Bare Co", businessType: null, stage: null }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Bare Co" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });
});
