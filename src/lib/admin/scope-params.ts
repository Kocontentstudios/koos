import {
  createLoader,
  createParser,
  createSerializer,
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";
import type { TicketStatus } from "@/lib/design/tickets-ui";
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
/* No `delivered` anchor: `design_tickets` has no delivered_at column, and
   quietly anchoring it to created_at would answer a different question than the
   one asked. ADMIN-FEAT-002 adds the column and the anchor together. */
export const DATE_ANCHORS = ["created", "due", "approved"] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidParam(sentinels: string[] = []) {
  return createParser({
    parse: (value: string) =>
      UUID.test(value) || sentinels.includes(value) ? value : "",
    serialize: (value: string) => value,
  }).withDefault("");
}

export const adminScopeParsers = {
  /* `open`, not `all`: the bare /admin/tickets URL is the working queue, and a
     default of `all` forced a coercion that swallowed an explicit ?view=all —
     the serializer drops values equal to the default, so the All tab round-
     tripped straight back to Open and drafts became unreachable. */
  view: parseAsStringLiteral(ADMIN_TICKET_VIEWS).withDefault(
    "open" as AdminTicketView,
  ),
  status: parseAsArrayOf(
    parseAsStringLiteral(TICKET_STATUSES),
    ",",
  ).withDefault([]),
  /* Validated at the parser, like `sort` below and for the same reason: these
     are compared against `uuid` columns, and Postgres treats a malformed uuid
     as a query ERROR, not a miss. `?brand=acme` used to throw out of the server
     component into the error boundary. `unassigned` is the one non-uuid value
     the query layer understands. */
  assignee: uuidParam(["unassigned"]),
  brand: uuidParam(),
  requester: uuidParam(),
  q: parseAsString.withDefault(""),
  range: parseAsStringLiteral(ADMIN_RANGES).withDefault("all"),
  from: parseAsString.withDefault(""),
  to: parseAsString.withDefault(""),
  on: parseAsStringLiteral(DATE_ANCHORS).withDefault("created"),
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
  view: "open",
  status: [],
  assignee: "",
  brand: "",
  requester: "",
  q: "",
  range: "all",
  from: "",
  to: "",
  on: "created",
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

/**
 * Where a Status Overview row opens.
 *
 * A plain status filter, deliberately: the number beside the row comes from
 * `getTicketCountsByStatus`, which groups on the raw status, so any richer view
 * would open a list that disagrees with the count the operator clicked.
 *
 * `view: "all"` is not decoration. A status narrows WITHIN a view, and the
 * queue's default view excludes drafts and delivered work — so a hand-built
 * `?status=delivered` resolves to `NOT IN (draft, delivered) AND = delivered`,
 * an empty list under a non-zero count. Built through the serializer so the
 * scope is stated rather than inherited.
 *
 * ADMIN-FEAT-002 re-points `delivered` and `ready_for_review` at Delivered
 * Projects once that page exists; until then this must not link to a route the
 * app does not serve.
 */
export function statusRowHref(status: TicketStatus): string {
  return adminScopeHref("/admin/tickets", DEFAULT_SCOPE, {
    view: "all",
    status: [status],
  });
}
