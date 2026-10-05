import { requireActor } from "@/lib/auth";
import { buyStock } from "@/lib/engine";
import { AppError, responseError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("TEAM_LEADER");
    if (!actor.team_id) throw new AppError("Team missing.", 403);
    const body = await request.json();
    if (typeof body.offeringId !== "string" || typeof body.idempotencyKey !== "string") throw new AppError("Invalid purchase request.");
    return Response.json(await buyStock({ buyerTeamId: actor.team_id, actorUserId: actor.id, offeringId: body.offeringId, quantity: Number(body.quantity), idempotencyKey: body.idempotencyKey }));
  } catch (error) { return responseError(error); }
}
