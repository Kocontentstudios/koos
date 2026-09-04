import { PgDialect } from "drizzle-orm/pg-core";

/**
 * A stand-in for `db` that records the query a function builds.
 *
 * The query layer was mocked as `{}` and its builders were never invoked, so
 * every line of join / where / limit / offset / orderBy wiring was unexecuted:
 * replacing `.where(conditions)` with `.where(undefined)` — which returns every
 * ticket in the database from every drill-down — passed the entire suite.
 *
 * This is not a database. It captures the chain — including each join's KIND
 * and compiled ON condition, and the source table of every projected column,
 * because those are the parts a table name alone cannot distinguish — and lets
 * a test assert on what the builder actually asked for. Correctness of the SQL
 * against real rows is still not provable in the gate lane; that the builder
 * asked the right question now is.
 */
export interface RecordedQuery {
  select?: Record<string, unknown>;
  /** Each projected key mapped to "table.column" — see `sources`. */
  sources: Record<string, string>;
  from?: string;
  joins: RecordedJoin[];
  where?: { sql: string; params: unknown[] };
  orderBy: string[];
  groupBy: string[];
  limit?: number;
  offset?: number;
}

/**
 * Where each projected key actually comes from.
 *
 * Recording only the column NAME cannot catch a swapped source: `brands.name`
 * and `strategies.name` are both called "name", so an assertion on the name
 * alone passes while every row prints the campaign where the brand belongs.
 */
const dialect = new PgDialect();

function sourceOf(column: unknown): string {
  const col = column as { name?: string; table?: unknown };
  if (typeof col?.name === "string") {
    const table = col.table ? tableNameOf(col.table) : "?";
    return `${table}.${col.name}`;
  }
  /* A projected `sql` fragment — a correlated subquery, an aggregate — is not
     a Column and has no name. Returning "?" for it meant a whole field could
     be deleted, or its subquery correlated on the wrong key, while the
     projection assertion stayed green. Compile it instead, so the fragment's
     own text is what a test reads. */
  try {
    return dialect.sqlToQuery(column as never).sql;
  } catch {
    return "?";
  }
}

/**
 * A join, including the two things that decide whether it is the RIGHT join.
 *
 * Recording only the table name cannot see a wrong ON condition or a wrong
 * kind: joining the designer on `user_id` names the client who filed the
 * ticket as its assignee, and turning a leftJoin into an innerJoin silently
 * drops every ticket with no calendar item. Both compile the same table name.
 */
export interface RecordedJoin {
  kind: "left" | "inner";
  table: string;
  on: string;
}

function tableNameOf(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table as object);
  for (const sym of symbols) {
    if (!sym.description?.includes("Name")) continue;
    const value = (table as Record<symbol, unknown>)[sym];
    if (typeof value === "string") return value;
  }
  return "unknown";
}

function recordJoin(
  kind: RecordedJoin["kind"],
  table: unknown,
  on: unknown,
): RecordedJoin {
  return {
    kind,
    table: tableNameOf(table),
    on: on ? dialect.sqlToQuery(on as never).sql : "",
  };
}

/** Returns the fake plus the record it fills in as the builder runs. */
export function recordingDb(rows: unknown[] = []) {
  const recorded: RecordedQuery = {
    joins: [],
    orderBy: [],
    groupBy: [],
    sources: {},
  };

  const chain = {
    from(table: unknown) {
      recorded.from = tableNameOf(table);
      return chain;
    },
    leftJoin(table: unknown, on?: unknown) {
      recorded.joins.push(recordJoin("left", table, on));
      return chain;
    },
    innerJoin(table: unknown, on?: unknown) {
      recorded.joins.push(recordJoin("inner", table, on));
      return chain;
    },
    where(condition: unknown) {
      recorded.where = condition
        ? dialect.sqlToQuery(condition as never)
        : undefined;
      return chain;
    },
    orderBy(...clauses: unknown[]) {
      recorded.orderBy = clauses.map((c) => dialect.sqlToQuery(c as never).sql);
      return chain;
    },
    limit(n: number) {
      recorded.limit = n;
      return chain;
    },
    offset(n: number) {
      recorded.offset = n;
      return chain;
    },
    groupBy(...columns: unknown[]) {
      recorded.groupBy = columns.map(sourceOf);
      return chain;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle's query builder is itself thenable — that is how `await db.select()...` runs — so a stand-in has to be one too.
    then(resolve: (value: unknown[]) => unknown) {
      return Promise.resolve(rows).then(resolve);
    },
  };

  const db = {
    delete(table: unknown) {
      recorded.from = tableNameOf(table);
      return chain;
    },
    select(shape?: Record<string, unknown>) {
      recorded.select = shape;
      recorded.sources = Object.fromEntries(
        Object.entries(shape ?? {}).map(([key, col]) => [key, sourceOf(col)]),
      );
      return chain;
    },
  };

  return { db, recorded };
}
