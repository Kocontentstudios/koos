import { PgDialect } from "drizzle-orm/pg-core";

/**
 * A stand-in for `db` that records the query a function builds.
 *
 * The query layer was mocked as `{}` and its builders were never invoked, so
 * every line of join / where / limit / offset / orderBy wiring was unexecuted:
 * replacing `.where(conditions)` with `.where(undefined)` — which returns every
 * ticket in the database from every drill-down — passed the entire suite.
 *
 * This is not a database. It captures the chain, compiles the parts that
 * compile, and lets a test assert on what the builder actually asked for.
 * Correctness of the SQL against real rows is still not provable in the gate
 * lane; that the builder asked the right question now is.
 */
export interface RecordedQuery {
  select?: Record<string, unknown>;
  from?: string;
  joins: string[];
  where?: { sql: string; params: unknown[] };
  orderBy: string[];
  limit?: number;
  offset?: number;
}

const dialect = new PgDialect();

function tableNameOf(table: unknown): string {
  const symbols = Object.getOwnPropertySymbols(table as object);
  for (const sym of symbols) {
    if (!sym.description?.includes("Name")) continue;
    const value = (table as Record<symbol, unknown>)[sym];
    if (typeof value === "string") return value;
  }
  return "unknown";
}

/** Returns the fake plus the record it fills in as the builder runs. */
export function recordingDb(rows: unknown[] = []) {
  const recorded: RecordedQuery = { joins: [], orderBy: [] };

  const chain = {
    from(table: unknown) {
      recorded.from = tableNameOf(table);
      return chain;
    },
    leftJoin(table: unknown) {
      recorded.joins.push(tableNameOf(table));
      return chain;
    },
    innerJoin(table: unknown) {
      recorded.joins.push(tableNameOf(table));
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
    groupBy() {
      return chain;
    },
    // biome-ignore lint/suspicious/noThenProperty: drizzle's query builder is itself thenable — that is how `await db.select()...` runs — so a stand-in has to be one too.
    then(resolve: (value: unknown[]) => unknown) {
      return Promise.resolve(rows).then(resolve);
    },
  };

  const db = {
    select(shape?: Record<string, unknown>) {
      recorded.select = shape;
      return chain;
    },
  };

  return { db, recorded };
}
