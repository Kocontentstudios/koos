/**
 * Re-exports the generic group fallback. Without this file Next resolves the
 * nearest ancestor loading.tsx, which here is a sibling route's TAILORED
 * skeleton — a brand-profile card grid ahead of a stepped form, or a ticket
 * list ahead of a form. Those shapes were written to prevent reflow and would
 * have caused it.
 */
export { default } from "@/app/(dashboard)/loading";
