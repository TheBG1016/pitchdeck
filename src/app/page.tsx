import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";

export default async function Home() {
  const actor = await currentActor();
  redirect(actor?.role === "ADMIN" ? "/admin" : actor?.role === "TEAM_LEADER" ? "/team" : "/login");
}
