import { signOut } from "@/lib/auth";
import { responseError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await signOut();
    return Response.json({ ok: true });
  } catch (error) { return responseError(error); }
}
