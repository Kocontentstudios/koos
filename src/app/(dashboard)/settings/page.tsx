import { requireOpenWorkspace } from "@/lib/auth/require-open-workspace";
import { SettingsClient } from "./settings-client";

export default async function SettingsPage() {
  const { dbUser } = await requireOpenWorkspace();

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
