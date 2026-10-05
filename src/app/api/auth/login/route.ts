import { signIn } from "@/lib/auth";
import { AppError, responseError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await request.json();
    if (typeof body.identifier !== "string" || typeof body.password !== "string" || body.identifier.length > 250 || body.password.length > 250) throw new AppError("Enter your credentials.");
    const actor = await signIn(body.identifier, body.password);
    return Response.json({ role: actor.role });
  } catch (error) { return responseError(error); }
}
