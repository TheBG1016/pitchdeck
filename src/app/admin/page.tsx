import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import AdminDashboard from "./dashboard";

export default async function AdminPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (actor.role !== "ADMIN") redirect("/team");
  return <AdminDashboard email={actor.email} />;
}
