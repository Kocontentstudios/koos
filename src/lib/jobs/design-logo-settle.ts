import {
  LAYOUT_MEMORY_DEPTH,
  recentLayouts,
} from "@/lib/ai/design-training/recent-layouts";
import { listDesignGenerationsForBrand } from "@/lib/db/queries";
import type { DesignContext } from "@/lib/design/context";
import {
  briefAskedForNoLogo,
  logoIsTheDeliverable,
  resolveLogoPlacement,
} from "@/lib/design/logo-placement";
import { resolvePalette } from "@/lib/design/palette";
import { type LoadedLogo, loadBestLogo } from "@/lib/design/render/logo";
import type { DesignSpec } from "@/lib/design/spec";

export interface SettledLogo {
  /** The drafted spec with the logo decision applied. */
  spec: DesignSpec;
  logo: LoadedLogo | null;
  /** Why the brand's logo could not be loaded, for the notification. */
  fault: string | null;
  logoFree: boolean;
  logoIsWhatWeAreDesigning: boolean;
}

/**
 * Decides whether the brand's mark goes on a drafted spec, loads it, and
 * places it. Shared by the variant and directions routes so both answer the
 * logo question the same way.
 */
export async function settleLogo(
  drafted: DesignSpec,
  context: DesignContext,
): Promise<SettledLogo> {
  /* The model's answer is trusted only where the brief could plausibly have
     asked. Otherwise logoFree is the old "none" escape hatch wearing a new
     name: one hallucinated true and the mark is gone with no fault, no
     notification and nothing in the UI to say why. */
  const logoIsWhatWeAreDesigning = logoIsTheDeliverable(context.designType);
  const briefAsked =
    drafted.logoFree &&
    briefAskedForNoLogo(context.briefText, drafted.logoFreeQuote);
  const logoFree = logoIsWhatWeAreDesigning || briefAsked;

  /* The logo is loaded before the rows are written because placement depends
     on whether the file is actually usable, and the spec is persisted with
     those rows — a stored spec that disagrees with what was rendered is worse
     than no spec at all. Skipped entirely for a logo-free brief: an R2 read
     and an SVG rasterise to decide not to draw it, and a load fault the user
     could do nothing useful with. */
  const { logo, fault } = logoFree
    ? { logo: null, fault: null }
    : await loadBestLogo({
        /* The profile logo plus every other approved mark, ordered so the
           user's chosen default wins when two read equally well — loadBestLogo
           measures contrast and keeps the first on a tie (FEAT-032). */
        urls: context.logoCandidates,
        /* The resolved palette, not the model's raw string: colorValue is a
           permissive z.string() on purpose, so the model routinely answers
           with a colour NAME and resolvePalette substitutes the brand's own
           colour downstream. Comparing against the raw value picks the variant
           for a background that is never rendered. */
        background: resolvePalette(drafted.palette, context.brand).background,
      });

  /* Whether the brand's own mark appears is not the art director's call.
     "none" is in the enum and the prompt gave it no grounds to choose it, so
     it chose it routinely and the logo silently vanished (KOOS-BUG-022). */
  const spec: DesignSpec = {
    ...drafted,
    /* The resolved answer, not the model's raw claim. A brief where the
       quotation was not corroborated used to persist logoFree: true beside a
       real corner — a stored spec disagreeing with the render, which is the
       invariant this file defends everywhere else. */
    logoFree,
    logoFreeQuote: logoFree ? drafted.logoFreeQuote : "",
    logoPlacement: resolveLogoPlacement({
      modelChoice: drafted.logoPlacement,
      hasLogo: Boolean(logo),
      layout: drafted.layout,
      logoFree,
      /* A footer band covers the bottom corners, so the mark has to move off
         them before placement rather than being measured as illegible after. */
      footer: {
        footerStyle: drafted.footerStyle,
        footerLines: drafted.footerLines,
        cta: drafted.cta,
      },
    }),
  };

  return { spec, logo, fault, logoFree, logoIsWhatWeAreDesigning };
}

/* Layout history is an improvement to the brief, never a prerequisite for it.
   buildMemoryBlock already swallows its own failures; this read has to do the
   same, or an unavailable history would cost the user their design. */
export async function recentLayoutsFor(brandId: string): Promise<string[]> {
  try {
    return recentLayouts(
      await listDesignGenerationsForBrand(brandId, {
        limit: LAYOUT_MEMORY_DEPTH,
      }),
    );
  } catch (err) {
    console.error("recent layout history unavailable", err);
    return [];
  }
}
