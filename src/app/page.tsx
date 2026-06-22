import { redirect } from "next/navigation";
import { LandingPage } from "@/components/marketing/landing-page";
import { getAuthUser } from "@/lib/auth/get-user";

export default async function Home() {
  const { dbUser } = await getAuthUser();
  if (dbUser) {
    redirect("/dashboard");
  }

  return <LandingPage />;
}
