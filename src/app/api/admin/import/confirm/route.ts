import { requireActor } from "@/lib/auth";
import { AppError, responseError } from "@/lib/errors";
import { confirmImport } from "@/lib/imports";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("ADMIN");
    const body = await request.json();
    if (typeof body.draftId !== "string") throw new AppError("Invalid import preview.");
    return Response.json(await confirmImport(body.draftId, actor.id));
  } catch (error) { return responseError(error); }
}
