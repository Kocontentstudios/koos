# Plan: Remove Supabase — self-hosted auth, sessions, and R2 storage

**Date:** 2026-06-18
**Context:** Replace Supabase entirely. DB moves to local Postgres now (`localhost:5432/koos`, PG16, `citext` available) and a cloud Postgres (Neon/Aiven/Vercel) at deploy. Drizzle already speaks plain Postgres, so the data path needs no change — only **auth** and **storage** must be re-implemented.

## Locked decisions
- **Auth:** custom DB-backed sessions (Lucia-style). `users.password_hash` (argon2id) + a `sessions` table; opaque token in an httpOnly cookie; SHA-256 of the token stored as the session id.
- **Google OAuth:** keep — via `arctic` (Authorization Code + PKCE).
- **Storage:** Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3` + presigner. Private objects; store the **object key** in the DB, resolve to a signed URL on read.
- **Middleware:** cookie-presence gating only (no DB on the edge); full session validation happens in `getAuthUser()` used by server layouts/pages.

## Dependencies
- add: `arctic`, `@node-rs/argon2`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- remove: `@supabase/ssr`, `@supabase/supabase-js`

## Env (`.env` + `.env.example`)
- remove: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- add: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (optional CDN/custom domain for `next/image`)
- `DIRECT_URL` = same local URL for migrations

## Tasks

### 1. Schema — sessions table
- Add `sessions` (`id text pk` = sha256(token), `user_id uuid fk → users on delete cascade`, `expires_at timestamptz not null`) + relations.
- `db:push` to local DB (resets the stale legacy tables: campaigns/offers/products_services/professional_requests dropped, new tables created).
- Acceptance: `check-db.mjs` passes; `sessions` + `strategies` + `usage_events` exist.

### 2. Password hashing — `src/lib/auth/password.ts` (TDD)
- `hashPassword(plain)` / `verifyPassword(hash, plain)` using argon2id.
- Tests: round-trips, wrong password fails, distinct salts produce distinct hashes.

### 3. Session core — `src/lib/auth/session.ts` (TDD where pure)
- `generateSessionToken()` (random 32 bytes, base32/hex), `hashToken(token)` (sha256 → id).
- `createSession(userId)`, `validateSessionToken(token)` (returns user or null, sliding 30-day expiry refresh), `invalidateSession(token)`, `invalidateUserSessions(userId)`.
- Cookie helpers: `setSessionCookie(token, expires)`, `deleteSessionCookie()`, `SESSION_COOKIE` name — httpOnly, secure (prod), sameSite=lax, path=/.
- Tests: token→hash determinism, expiry math (pure helpers); DB-touching fns covered by the live integration test in Task 9.

### 4. getAuthUser + remove sync glue — `src/lib/auth/get-user.ts`
- Read session cookie → `validateSessionToken` → return `{ user }` (the drizzle row). No Supabase.
- Replace `ensureUser(supabaseUser)` usage; user creation now happens in signup/oauth.

### 5. Google OAuth — `src/lib/auth/google.ts`
- `arctic` Google client; `createGoogleAuthUrl()` (sets state + code-verifier cookies), `validateGoogleCallback(code, verifier)` → profile (sub, email, given/family name, picture).
- `upsertOAuthUser(profile)` — find by email or create (provider=google).

### 6. Auth surfaces
- `(auth)/actions.ts`: `login` (verify pw → createSession → cookie → redirect), `signup` (create user w/ hash → session), `signInWithGoogle` (redirect to Google URL).
- `auth/callback/route.ts`: read state/verifier cookies, validate, upsert user, create session, redirect.
- `api/auth/logout/route.ts`: invalidate session + clear cookie, 303 → /login.
- `settings/actions.ts` `changePasswordAction`: verify current (if set) → write new `password_hash`.

### 7. Middleware — `src/middleware.ts` (+ delete `lib/supabase/middleware.ts`)
- Inline cookie-presence check: no `session` cookie + protected route → /login; has cookie + auth route → /dashboard. Same route lists as before.

### 8. Storage — Cloudflare R2
- `src/lib/storage.ts`: S3 client to R2 endpoint; `uploadObject(bucket,key,body,contentType)`, `getSignedUrl(bucket,key,expires)`, `getReadUrl(bucket,key)`.
- `POST /api/upload` (auth-checked): accepts FormData file + kind → puts to R2 → returns `{ key }`.
- `step-assets.tsx`: replace browser Supabase upload with `fetch('/api/upload')`; store returned key in `logoUrl`.
- Brand view: resolve `logoUrl` key → signed URL for display.
- `next.config.ts`: image `remotePatterns` → R2 host (drop `**.supabase.co`).

### 9. Cleanup + verification
- Delete `src/lib/supabase/`, `src/lib/auth/sync-user.ts` (folded in), `scripts/fix-db-url.mjs` (Supabase-specific).
- `pnpm remove` the two supabase packages; update `.env(.example)`.
- Gates: `tsc --noEmit`, `vitest run`, `biome check` (new/edited files clean).
- **Live integration test** against local DB: create user → login → validate session → upload stub to R2 (or skip if R2 creds absent) → strategy generateObject (real OpenAI). Scripted, then removed.

## Out of scope
- Email verification / password reset flows (later).
- Migrating any existing Supabase auth users (none — fresh local DB).
