import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import { rows } from "@/lib/db";
import TeamDashboard from "./dashboard";

export default async function TeamPage() {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  if (actor.role !== "TEAM_LEADER" || !actor.team_id) redirect("/admin");
  const team = (await rows<any>("SELECT id,name,college,is_participant FROM teams WHERE id=$1", [actor.team_id]))[0];
  const members = await rows<any>("SELECT slot,name,registration_number FROM team_members WHERE team_id=$1 ORDER BY slot", [actor.team_id]);
  return <TeamDashboard team={team} members={members} />;
}
