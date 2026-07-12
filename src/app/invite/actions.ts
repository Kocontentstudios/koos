"use server";

import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { setActiveWorkspaceCookie } from "@/lib/auth/workspace";
import {
  addWorkspaceMember,
  getInvitationByTokenHash,
  getWorkspaceOwner,
  markInvitationAccepted,
} from "@/lib/db/queries";
import { appUrl } from "@/lib/design/notify";
import { sendMemberJoinedEmail } from "@/lib/notify/workspace";
import { acceptInvitation } from "@/lib/workspace/invitations";

export async function acceptInviteAction(formData: FormData) {
  const token = formData.get("token");
  if (typeof token !== "string" || !token) redirect("/invite/invalid");

  const { dbUser } = await getAuthUser();
  if (!dbUser)
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  const result = await acceptInvitation(
    {
      getInvitationByTokenHash: (hash) => getInvitationByTokenHash(hash),
      addWorkspaceMember,
      markInvitationAccepted,
      notifyOwnerMemberJoined: async (args) => {
        // Look up the workspace owner's email for the joined notification.
        const owner = await getWorkspaceOwner(args.workspaceId);
        if (!owner) return;
        await sendMemberJoinedEmail({
          to: owner.email,
          input: {
            memberName: args.memberName,
            memberEmail: args.memberEmail,
            workspaceName: args.workspaceName,
            teamUrl: appUrl("/team"),
          },
        });
      },
    },
    {
      token,
      user: {
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
      },
    },
  );

  if (!result.ok) redirect(`/invite/${encodeURIComponent(token)}`); // page re-renders the error state
  await setActiveWorkspaceCookie(result.workspaceId);
  redirect("/dashboard");
}
