import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewClient } from "./preview-client";

/**
 * TEMPORARY review harness for FEAT-033 PR 1: every state of the image
 * choice, upload, progress and results views with fixture data, plus the
 * real GenerateDesignButton driven against an in-browser fake server.
 * Deleted before merge. Fixture images come from
 * scripts/feat-033-preview-fixtures.mjs and are never committed.
 */
export const metadata: Metadata = { title: "FEAT-033 preview" };

export default function Feat033PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewClient />;
}
