import { requireActor } from "@/lib/auth";
import { adminSnapshot } from "@/lib/admin";
import { responseError } from "@/lib/errors";

export async function GET() {
  try {
    await requireActor("ADMIN");
    return Response.json(await adminSnapshot(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
