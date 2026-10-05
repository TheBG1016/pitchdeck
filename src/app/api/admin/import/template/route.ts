import { requireActor } from "@/lib/auth";
import { CSV_HEADERS } from "@/lib/imports";
import { responseError } from "@/lib/errors";

export async function GET() {
  try {
    await requireActor("ADMIN");
    return new Response(`${CSV_HEADERS.join(",")}\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=team-template.csv" } });
  } catch (error) { return responseError(error); }
}
