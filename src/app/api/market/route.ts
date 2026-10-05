import { requireActor } from "@/lib/auth";
import { leaderboard, marketSnapshot } from "@/lib/engine";
import { responseError } from "@/lib/errors";

export async function GET() {
  try {
    const actor = await requireActor();
    const market = await marketSnapshot(actor.role === "TEAM_LEADER" ? actor.team_id ?? undefined : undefined);
    const result = market.event.results_revealed || actor.role === "ADMIN" ? await leaderboard() : null;
    return Response.json({ market, leaderboard: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
