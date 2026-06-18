import { NextResponse } from "next/server";
import { endSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await endSession();
  // 303 (See Other) makes the browser follow the redirect with GET. The default
  // (307) would preserve the POST method and re-issue POST /login, which 404s
  // because /login is a GET-only page.
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  return NextResponse.redirect(new URL("/login", base), { status: 303 });
}
