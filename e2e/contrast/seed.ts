import { hash } from "@node-rs/argon2";
import postgres from "postgres";

/**
 * Two QA accounts in a known state, rebuilt from scratch on every run so the
 * pages the contrast check walks always carry the same content: a brand with a
 * strategy, a week of calendar items in every status and a ticket in every
 * lifecycle status (`full`), and brand-new accounts that still see the
 * onboarding welcome.
 */

export const QA_PASSWORD = "Contrast!QA-2026";

/* A brand-new account per route and theme: probing the welcome dialog presses
   Escape, which dismisses it for good, so a shared account would show the
   second run a different page. */
export const QA_USERS = {
  full: "e2e-contrast@example.test",
  "welcome-dark": "e2e-contrast-welcome-dark@example.test",
  "welcome-light": "e2e-contrast-welcome-light@example.test",
  "start-dark": "e2e-contrast-start-dark@example.test",
  "start-light": "e2e-contrast-start-light@example.test",
} as const;

export type QaAccount = keyof typeof QA_USERS;

/* Matches src/lib/auth/password.ts; argon2 stores its parameters in the hash,
   so verification would succeed either way, but the seed should not invent a
   weaker one. */
const ARGON2 = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** The seed deletes and recreates rows, so it refuses anything but a database
 * on this machine. */
export function assertLocalDatabase(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL is not set for the contrast seed");
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `the contrast seed only writes to a local database, not ${host}`,
    );
  }
  return url;
}

const TICKET_STATUSES = [
  "draft",
  "submitted",
  "assigned",
  "in_progress",
  "ready_for_review",
  "delivered",
  "revision_requested",
] as const;

const ITEM_STATUSES = ["draft", "in_progress", "ready", "published"] as const;

type Sql = postgres.TransactionSql;

async function createUser(
  sql: Sql,
  email: string,
  firstName: string,
  settled: boolean,
): Promise<{ userId: string; workspaceId: string }> {
  const passwordHash = await hash(QA_PASSWORD, ARGON2);
  const [user] = await sql`
    insert into users (first_name, last_name, email, password_hash,
      email_verified_at, tour_completed_at, welcome_seen_at)
    values (${firstName}, 'Contrast', ${email}, ${passwordHash}, now(),
      ${settled ? sql`now()` : null}, ${settled ? sql`now()` : null})
    returning id`;
  const [workspace] = await sql`
    insert into workspaces (name, owner_id, access_status, access_decided_at)
    values (${`${firstName} Studio`}, ${user.id}, 'approved', now())
    returning id`;
  await sql`
    insert into workspace_members (workspace_id, user_id, role, brand_scope)
    values (${workspace.id}, ${user.id}, 'owner', 'all')`;
  return { userId: user.id, workspaceId: workspace.id };
}

async function seedBrandContent(sql: Sql, userId: string, workspaceId: string) {
  const [brand] = await sql`
    insert into brands (user_id, workspace_id, name, onboarding_status,
      overview, business_type, stage, target_audience, offer, tone,
      primary_goal, primary_color, secondary_color, platforms, primary_platform)
    values (${userId}, ${workspaceId}, 'Lumen Coffee', 'completed',
      'Small-batch roaster with two cafes in Lagos.', 'Food and drink',
      'Growing', 'Remote workers 24-40 who treat coffee as a ritual',
      'Single-origin beans and a monthly subscription', 'Warm, precise, unfussy',
      'Grow subscriptions', '#7a4b2a', '#f2e6d8',
      ${sql.array(["instagram", "tiktok", "email"])}, 'instagram')
    returning id`;
  const [conversation] = await sql`
    insert into chat_conversations (brand_id, user_id, title, mode)
    values (${brand.id}, ${userId}, 'Subscription push', 'strategy')
    returning id`;
  await sql`
    insert into chat_messages (conversation_id, role, content) values
      (${conversation.id}, 'user', 'Plan a month to grow coffee subscriptions.'),
      (${conversation.id}, 'assistant',
        'Here is a four-week plan built around the morning ritual.')`;
  const [strategy] = await sql`
    insert into strategies (brand_id, conversation_id, name, status)
    values (${brand.id}, ${conversation.id}, 'Subscription push', 'active')
    returning id`;

  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  );
  const [calendar] = await sql`
    insert into calendars (brand_id, strategy_id, start_date, end_date)
    values (${brand.id}, ${strategy.id}, ${first}, ${last})
    returning id`;

  const itemIds: string[] = [];
  for (let day = 0; day < 8; day++) {
    const date = new Date(now);
    date.setUTCDate(now.getUTCDate() + day - 2);
    const status = ITEM_STATUSES[day % ITEM_STATUSES.length];
    const [item] = await sql`
      insert into calendar_items (calendar_id, date, time, platform,
        content_type, title, brief, caption, design_required, design_type,
        status, sort_order)
      values (${calendar.id}, ${date}, '09:00',
        ${day % 2 ? "tiktok" : "instagram"}, ${day % 2 ? "reel" : "carousel"},
        ${`Morning ritual ${day + 1}`}, 'Show the pour, not the product.',
        'Your mornings, sorted.', ${day % 3 === 0}, 'social_post', ${status},
        ${day})
      returning id`;
    itemIds.push(item.id);
  }

  for (const [i, status] of TICKET_STATUSES.entries()) {
    await sql`
      insert into design_tickets (calendar_item_id, brand_id, user_id,
        design_type, title, brief, status)
      values (${itemIds[i] ?? null}, ${brand.id}, ${userId}, 'social_post',
        ${`Ticket in ${status.replace(/_/g, " ")}`}, 'Carousel, five slides.',
        ${status})`;
  }
}

export async function seedContrastAccounts(databaseUrl: string | undefined) {
  const sql = postgres(assertLocalDatabase(databaseUrl), { max: 1 });
  try {
    await sql.begin(async (tx) => {
      await tx`delete from users where email in ${tx(Object.values(QA_USERS))}`;
      /* Every run signs in five accounts from one IP and the login limit is
         10 per 10 minutes, so a second run inside the window would be locked
         out. Local database only (assertLocalDatabase). */
      await tx`delete from rate_limits where key like 'login:%'`;
      const full = await createUser(tx, QA_USERS.full, "Ada", true);
      await seedBrandContent(tx, full.userId, full.workspaceId);
      for (const [account, email] of Object.entries(QA_USERS)) {
        if (account !== "full") await createUser(tx, email, "Tobi", false);
      }
    });
  } finally {
    await sql.end();
  }
}
