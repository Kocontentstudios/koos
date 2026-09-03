import {
  createLoader,
  createParser,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";
import { TICKET_STATUSES } from "@/lib/design/tickets-ui";
import {
  ADMIN_RANGES,
  ADMIN_TICKET_VIEWS,
  type AdminTicketView,
  clampPage,
  isSortable,
} from "./scope";

/**
 * The URL vocabulary shared by every admin drill-down, derived from `scope.ts`
 * so the two cannot drift.
 *
 * Grammar, frozen: multi-values are one comma list (never repeated keys),
 * defaults are omitted from the URL so two routes to the same view produce the
 * same link, unknown values fall back instead of erroring, and the params are
 * orthogonal — adding one never invalidates another. That last rule is what
 * makes "preserve the active filters" a property of the builder rather than a
 * decision each link has to remember.
 */
export const USAGE_KINDS = [
  "strategy_generated",
  "calendar_generated",
  "design_ticket_created",
  "design_generated",
] as const;

export const DATE_ANCHORS = [
  "created",
  "due",
  "delivered",
  "approved",
] as const;

export const adminScopeParsers = {
  view: parseAsStringLiteral(ADMIN_TICKET_VIEWS).withDefault(
    "all" as AdminTicketView,
  ),
  status: parseAsArrayOf(
    parseAsStringLiteral(TICKET_STATUSES),
    ",",
  ).withDefault([]),
  assignee: parseAsString.withDefault(""),
  brand: parseAsString.withDefault(""),
  requester: parseAsString.withDefault(""),
  q: parseAsString.withDefault(""),
  range: parseAsStringLiteral(ADMIN_RANGES).withDefault("all"),
  from: parseAsString.withDefault(""),
  to: parseAsString.withDefault(""),
  on: parseAsStringLiteral(DATE_ANCHORS).withDefault("created"),
  kind: parseAsArrayOf(parseAsStringLiteral(USAGE_KINDS), ",").withDefault([]),
  /* Validated here rather than trusted and sanitised later: the scope object
     is handed straight to the query layer, so it should never carry a field
     name that came off a hand-edited URL. */
  sort: createParser({
    parse: (value: string) => (isSortable(value) ? value : ""),
    serialize: (value: string) => value,
  }).withDefault(""),
  page: parseAsInteger.withDefault(1),
};

export type AdminScope = {
  [K in keyof typeof adminScopeParsers]: NonNullable<
    ReturnType<(typeof adminScopeParsers)[K]["parse"]>
  >;
};

export const DEFAULT_SCOPE: AdminScope = {
  view: "all",
  status: [],
  assignee: "",
  brand: "",
  requester: "",
  q: "",
  range: "all",
  from: "",
  to: "",
  on: "created",
  kind: [],
  sort: "",
  page: 1,
};

const load = createLoader(adminScopeParsers);
const serialize = createSerializer(adminScopeParsers);

/** Reads a scope out of a server component's searchParams (or a URLSearchParams). */
export function loadAdminScope(
  input: URLSearchParams | Record<string, string | string[] | undefined>,
): AdminScope {
  const parsed = load(input) as AdminScope;
  return { ...parsed, page: clampPage(parsed.page) };
}

/**
 * Builds a link from the CURRENT scope plus a patch. Callers pass the whole
 * scope rather than assembling params by hand, which is why no drill-down can
 * silently drop a filter the user has applied.
 */
export function adminScopeHref(
  pathname: string,
  scope: AdminScope,
  patch: Partial<AdminScope> = {},
): string {
  return serialize(pathname, { ...scope, ...patch });
}
