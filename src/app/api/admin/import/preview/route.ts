import { requireActor } from "@/lib/auth";
import { AppError, responseError } from "@/lib/errors";
import { createImportDraft } from "@/lib/imports";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor("ADMIN");
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a CSV file.");
    return Response.json(await createImportDraft(await file.text(), actor.id));
  } catch (error) { return responseError(error); }
}
