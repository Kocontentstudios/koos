# KO OS

KO Content Studios' AI content platform: **Brand Profile → AI Content Strategy → AI Content Calendar → Design Tickets** fulfilled by human KO designers ("AI plans, humans design").

## Stack

- **Next.js 16** (App Router) · **React 19** · **TypeScript** · **Tailwind v4**
- **Drizzle ORM + PostgreSQL** (local for dev; Neon / Aiven / Vercel Postgres in prod)
- **Auth**: self-hosted DB-backed sessions (argon2id passwords) + Google OAuth via `arctic`
- **Storage**: Cloudflare R2 (S3-compatible)
- **AI**: Vercel AI SDK, provider-agnostic (Google / OpenAI / Anthropic / Z.ai / any OpenAI-compatible)
- **Tooling**: pnpm · Biome · Vitest

## Prerequisites

- Node.js 22+
- pnpm
- A PostgreSQL database (local or cloud)

## Setup

```bash
pnpm install
cp .env.example .env   # then fill in the values (see .env.example for all keys)
```

### Database (required)

Drizzle speaks plain PostgreSQL — point `DATABASE_URL` at any Postgres (local,
Neon, Aiven, Vercel Postgres). Managed providers usually need SSL, e.g.
`?sslmode=require` in the URL (Aiven/Neon include this in the connection string).

**A fresh/empty database needs two one-time steps before the app will run or build:**

1. **Enable the `citext` extension** (the `users.email` column uses it):

   ```sql
   CREATE EXTENSION IF NOT EXISTS citext;
   ```

   Run it in your provider's SQL console, or:

   ```bash
   node -e "import('postgres').then(async ({default:pg})=>{process.loadEnvFile('.env');const s=pg(process.env.DIRECT_URL??process.env.DATABASE_URL,{max:1});await s.unsafe('create extension if not exists citext;');console.log('citext enabled');await s.end();})"
   ```

2. **Push the schema** (creates all tables). drizzle-kit uses `DIRECT_URL`, falling back to `DATABASE_URL`:

   ```bash
   pnpm db:push
   ```

> ⚠️ Skipping these is the #1 cause of a failed build/deploy — the preflight will
> report `DB: connected, but the "users" table is missing`. Run the two steps
> above against the new database and rebuild.

Other DB commands: `pnpm db:generate` (SQL migrations), `pnpm db:studio` (browser UI).

### AI provider

The active provider is chosen via env — switch with one variable, no code change.
Default is **Google Gemini** (`AI_PROVIDER=google`, `AI_MODEL=gemini-2.5-flash`).

```bash
AI_PROVIDER=google        # google | zai | openai | anthropic | openai-compatible
AI_MODEL=gemini-2.5-flash
# Provide the key for your chosen provider:
GOOGLE_GENERATIVE_AI_API_KEY=...
# Optional per-feature overrides:
#   AI_CHAT_PROVIDER= / AI_CHAT_MODEL=
#   AI_STRATEGY_PROVIDER= / AI_STRATEGY_MODEL=
```

For a generic OpenAI-compatible endpoint set `AI_PROVIDER=openai-compatible` plus
`AI_COMPATIBLE_BASE_URL` / `AI_COMPATIBLE_API_KEY`.

### Storage (Cloudflare R2)

Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and
`R2_PUBLIC_BASE_URL`. The public base URL must be a **public** domain — the bucket's
**Public Development URL** (`https://pub-<hash>.r2.dev`) or a custom domain — **not**
the `*.r2.cloudflarestorage.com` S3 API endpoint (that is private and logo URLs
built from it will 404).

### Google OAuth (optional)

Set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and add the redirect URI
`${NEXT_PUBLIC_APP_URL}/auth/callback` in Google Cloud. Email/password sign-in
works without this.

## Development

```bash
pnpm dev        # http://localhost:3000
pnpm test       # Vitest
pnpm lint       # Biome
```

## Build & deploy

```bash
pnpm build      # runs the deploy preflight, then `next build`
pnpm preflight  # run the checks on their own
```

### Deploy preflight

`pnpm build` runs `scripts/check-env.mjs` first and **fails the build** unless the
required integrations are connected:

| Integration | Check | Blocks build? |
|---|---|---|
| **Database** | connects + schema initialized (`users` table) | ✅ yes |
| **AI provider** | configured key validates (free models call) | ✅ yes |
| **Cloudflare R2** | bucket reachable (HeadBucket) + valid public URL | ✅ yes |
| Google OAuth | credentials present | ⚠️ warning only |

Escape hatches (use sparingly, e.g. offline CI):
`SKIP_PREFLIGHT=1`, `SKIP_DB_CHECK=1`, `SKIP_AI_CHECK=1`, `SKIP_R2_CHECK=1`, `AI_SKIP_PING=1`.

On Vercel, set the same env vars in the project settings — the preflight runs as
part of the build there too.
