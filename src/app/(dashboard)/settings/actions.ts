"use server";

import { getAuthUser } from "@/lib/auth/get-user";
import { hashPassword } from "@/lib/auth/password";
import { updateUserPassword, updateUserProfile } from "@/lib/db/queries";

export async function getProfile() {
  const { dbUser } = await getAuthUser();
  return dbUser;
}

export async function updateProfileAction(data: {
  firstName: string;
  lastName: string;
}) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) throw new Error("Not authenticated");

  const updated = await updateUserProfile(dbUser.id, {
    firstName: data.firstName,
    lastName: data.lastName,
  });

  return updated;
}

export async function changePasswordAction(newPassword: string) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) throw new Error("Not authenticated");
  if (!newPassword || newPassword.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  await updateUserPassword(dbUser.id, await hashPassword(newPassword));
  return { success: true };
}
