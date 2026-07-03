import { redirect } from "next/navigation";
import { LandingPage } from "@/components/marketing/landing-page";
import { getAuthUser } from "@/lib/auth/get-user";

export default async function Home() {
  const { dbUser } = await getAuthUser();
  if (dbUser) {
    // The app lives on app.kocontentstudios.com in production; NEXT_PUBLIC_APP_URL
    // points there. Falls back to a relative path for local dev.
    redirect(`${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard`);
  }

  return <LandingPage />;
}
