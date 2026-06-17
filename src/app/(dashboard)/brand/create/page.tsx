import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/get-user";
import { CreateBrandForm } from "./create-brand-form";

export default async function CreateBrandPage() {
  const { dbUser } = await getAuthUser();
  if (!dbUser) redirect("/login");
  return <CreateBrandForm />;
}
