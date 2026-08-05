import { getAuthUser } from "@/lib/auth/get-user";
import { redirectToLogin } from "@/lib/auth/redirects";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirectToLogin();

  return (
    <SettingsClient
      user={{
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        email: dbUser.email,
        hasPassword: Boolean(dbUser.passwordHash),
      }}
    />
  );
}
