export async function guardWorkspaceRoute() {
  return { ctx: { dbUser: { id: "u1", role: "user" } } };
}
