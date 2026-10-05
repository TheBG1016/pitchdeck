import { requireActor } from "@/lib/auth";
import { eventId, rows } from "@/lib/db";
import { leaderboard } from "@/lib/engine";
import { AppError, responseError } from "@/lib/errors";

function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  const safe = /^[=+@\-\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
function csv(headers: string[], data: unknown[][]) {
  return `\uFEFF${[headers, ...data].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  try {
    await requireActor("ADMIN");
    const { kind } = await context.params;
    let content: string;
    if (kind === "results") {
      const leaders = await leaderboard();
      content = csv(["Rank", "Team", "College", "Investment received (minor units)", "Stocks sold"], leaders.map((item) => [item.rank, item.name, item.college, item.received_minor, item.sold_quantity]));
    } else if (kind === "transactions") {
      const id = await eventId();
      const purchases = await rows<any>(
        `SELECT p.id,p.created_at,b.name AS buyer,t.name AS target,p.quantity,p.price_minor,p.total_minor,
         CASE WHEN r.id IS NULL THEN 'COMMITTED' ELSE 'REVERSED' END AS status,r.reason
         FROM purchases p JOIN teams b ON b.id=p.buyer_team_id JOIN offerings o ON o.id=p.offering_id
         JOIN teams t ON t.id=o.team_id LEFT JOIN purchase_reversals r ON r.purchase_id=p.id
         WHERE p.event_id=$1 ORDER BY p.created_at`, [id],
      );
      content = csv(["ID", "Timestamp", "Buyer", "Target", "Quantity", "Unit price (minor units)", "Total (minor units)", "Status", "Reversal reason"], purchases.map((p) => [p.id, p.created_at, p.buyer, p.target, p.quantity, p.price_minor, p.total_minor, p.status, p.reason]));
    } else throw new AppError("Unknown export.", 404);
    return new Response(content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=${kind}.csv`, "Cache-Control": "no-store" } });
  } catch (error) { return responseError(error); }
}
