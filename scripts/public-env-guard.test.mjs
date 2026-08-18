// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  collectReferencedNames,
  describeOrphan,
  findMissing,
  findOrphans,
  isPlatformProvided,
  readReferencedNames,
  suggestFor,
} from "./public-env-guard.mjs";

describe("collectReferencedNames", () => {
  it("finds the static form Next inlines into the client bundle", () => {
    const found = collectReferencedNames([
      "const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;",
    ]);
    expect([...found]).toEqual(["NEXT_PUBLIC_POSTHOG_KEY"]);
  });

  it("finds the bracket form used in server-only code", () => {
    const found = collectReferencedNames([
      'const host = process.env["NEXT_PUBLIC_POSTHOG_HOST"];',
    ]);
    expect([...found]).toEqual(["NEXT_PUBLIC_POSTHOG_HOST"]);
  });

  it("dedupes a name read from several files", () => {
    const found = collectReferencedNames([
      "process.env.NEXT_PUBLIC_APP_URL",
      "process.env.NEXT_PUBLIC_APP_URL",
    ]);
    expect(found.size).toBe(1);
  });

  it("ignores server-only variables", () => {
    const found = collectReferencedNames([
      "process.env.DATABASE_URL; process.env.R2_BUCKET;",
    ]);
    expect(found.size).toBe(0);
  });
});

describe("findOrphans", () => {
  const referenced = new Set([
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
    "NEXT_PUBLIC_APP_URL",
  ]);

  it("returns nothing when every provided variable is read", () => {
    const provided = new Set([
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_APP_URL",
      "DATABASE_URL",
    ]);
    expect(findOrphans({ referenced, provided })).toEqual([]);
  });

  it("flags a provided variable that no source file reads", () => {
    const provided = new Set(["NEXT_PUBLIC_POSTHOG_PROJECT_KEY"]);
    expect(findOrphans({ referenced, provided })).toEqual([
      "NEXT_PUBLIC_POSTHOG_PROJECT_KEY",
    ]);
  });

  it("never flags Vercel's injected system variables", () => {
    const provided = new Set([
      "NEXT_PUBLIC_VERCEL_ENV",
      "NEXT_PUBLIC_VERCEL_URL",
      "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
      "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
    ]);
    expect(findOrphans({ referenced, provided })).toEqual([]);
  });

  it("ignores variables outside the NEXT_PUBLIC namespace", () => {
    const provided = new Set(["ZOHO_SMTP_PASS", "AI_PROVIDER"]);
    expect(findOrphans({ referenced, provided })).toEqual([]);
  });

  it("returns orphans sorted so build output is stable", () => {
    const provided = new Set(["NEXT_PUBLIC_ZED", "NEXT_PUBLIC_ALPHA"]);
    expect(findOrphans({ referenced, provided })).toEqual([
      "NEXT_PUBLIC_ALPHA",
      "NEXT_PUBLIC_ZED",
    ]);
  });
});

describe("suggestFor", () => {
  const referenced = new Set([
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
    "NEXT_PUBLIC_APP_URL",
  ]);

  /* The exact production failure: this name was set on Vercel while every
     reader wanted NEXT_PUBLIC_POSTHOG_KEY. Analytics collected nothing. */
  it("maps the shipped typo back to the canonical name", () => {
    expect(suggestFor("NEXT_PUBLIC_POSTHOG_PROJECT_KEY", referenced)).toBe(
      "NEXT_PUBLIC_POSTHOG_KEY",
    );
  });

  it("prefers HOST over KEY for a host-shaped typo", () => {
    expect(suggestFor("NEXT_PUBLIC_POSTHOG_API_HOST", referenced)).toBe(
      "NEXT_PUBLIC_POSTHOG_HOST",
    );
  });

  it("offers no suggestion for an unrelated name", () => {
    expect(suggestFor("NEXT_PUBLIC_STRIPE_PK", referenced)).toBeNull();
  });

  it("is deterministic when two candidates tie", () => {
    const tied = new Set(["NEXT_PUBLIC_A_KEY", "NEXT_PUBLIC_B_KEY"]);
    const first = suggestFor("NEXT_PUBLIC_KEY", tied);
    expect(suggestFor("NEXT_PUBLIC_KEY", tied)).toBe(first);
  });
});

describe("describeOrphan", () => {
  const referenced = new Set(["NEXT_PUBLIC_POSTHOG_KEY"]);

  it("names the likely intended variable when there is one", () => {
    expect(
      describeOrphan("NEXT_PUBLIC_POSTHOG_PROJECT_KEY", referenced),
    ).toContain("did you mean NEXT_PUBLIC_POSTHOG_KEY?");
  });

  it("still explains itself with no suggestion available", () => {
    expect(describeOrphan("NEXT_PUBLIC_STRIPE_PK", referenced)).toBe(
      "NEXT_PUBLIC_STRIPE_PK is set but is read by no source file.",
    );
  });
});

describe("isPlatformProvided", () => {
  it("matches by prefix so new Vercel variables need no code change", () => {
    expect(isPlatformProvided("NEXT_PUBLIC_VERCEL_SOMETHING_NEW")).toBe(true);
    expect(isPlatformProvided("NEXT_PUBLIC_POSTHOG_KEY")).toBe(false);
  });
});

/* The production environment as actually deployed. Guards against the failure
   that would matter most: a false positive here blocks every deploy. */
describe("against the real production environment shape", () => {
  const referenced = new Set([
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
    "NEXT_PUBLIC_APP_URL",
  ]);
  const productionEnv = [
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_POSTHOG_HOST",
    "NEXT_PUBLIC_VERCEL_ENV",
    "NEXT_PUBLIC_VERCEL_URL",
    "NEXT_PUBLIC_VERCEL_BRANCH_URL",
    "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
    "NEXT_PUBLIC_VERCEL_GIT_PROVIDER",
    "NEXT_PUBLIC_VERCEL_GIT_REPO_SLUG",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
    "NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID",
    "DATABASE_URL",
    "R2_BUCKET",
    "ZOHO_SMTP_USER",
  ];

  it("passes a correctly configured deploy", () => {
    expect(
      findOrphans({ referenced, provided: new Set(productionEnv) }),
    ).toEqual([]);
  });

  it("catches the regression if the typo is reintroduced", () => {
    const broken = productionEnv
      .filter((name) => name !== "NEXT_PUBLIC_POSTHOG_KEY")
      .concat("NEXT_PUBLIC_POSTHOG_PROJECT_KEY");
    const orphans = findOrphans({ referenced, provided: new Set(broken) });
    expect(orphans).toEqual(["NEXT_PUBLIC_POSTHOG_PROJECT_KEY"]);
    expect(describeOrphan(orphans[0], referenced)).toContain(
      "did you mean NEXT_PUBLIC_POSTHOG_KEY?",
    );
  });
});

describe("readReferencedNames", () => {
  it("finds this repo's real public variables by scanning source", async () => {
    const referenced = await readReferencedNames(["src", "next.config.ts"]);
    expect(referenced).toContain("NEXT_PUBLIC_POSTHOG_KEY");
    expect(referenced).toContain("NEXT_PUBLIC_POSTHOG_HOST");
    expect(referenced).toContain("NEXT_PUBLIC_APP_URL");
  });

  it("ignores env reads quoted inside test fixtures", async () => {
    const referenced = await readReferencedNames(["scripts"]);
    expect(referenced.has("NEXT_PUBLIC_POSTHOG_KEY")).toBe(false);
  });

  it("returns an empty set for a path that does not exist", async () => {
    expect((await readReferencedNames(["no/such/dir"])).size).toBe(0);
  });
});

describe("findMissing", () => {
  const referenced = new Set([
    "NEXT_PUBLIC_POSTHOG_KEY",
    "NEXT_PUBLIC_APP_URL",
  ]);

  /* Renaming the key silenced analytics. Deleting it would too, and the
     orphan check cannot see a variable that is not there. */
  it("catches a read variable that production does not supply", () => {
    const provided = new Set(["NEXT_PUBLIC_APP_URL"]);
    expect(findMissing({ referenced, provided, isProduction: true })).toEqual([
      "NEXT_PUBLIC_POSTHOG_KEY",
    ]);
  });

  it("stays silent outside production so the warning keeps its meaning", () => {
    const provided = new Set([]);
    expect(findMissing({ referenced, provided, isProduction: false })).toEqual(
      [],
    );
  });

  it("reports nothing when production supplies everything", () => {
    expect(
      findMissing({ referenced, provided: referenced, isProduction: true }),
    ).toEqual([]);
  });
});
