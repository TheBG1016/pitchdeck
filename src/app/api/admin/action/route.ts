import { requireActor } from "@/lib/auth";
import { adminAction } from "@/lib/admin";
import { responseError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("ADMIN");
    return Response.json(await adminAction(await request.json(), actor.id));
  } catch (error) { return responseError(error); }
}
