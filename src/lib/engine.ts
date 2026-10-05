import { eventId, one, rows, transaction, type PoolClient } from "./db";
import { AppError } from "./errors";

export type PurchaseInput = { buyerTeamId: string; offeringId: string; quantity: number; idempotencyKey: string; actorUserId?: string };

function asNumber(value: string | number): number { return Number(value); }

export async function buyStock(input: PurchaseInput) {
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) throw new AppError("Choose a valid stock quantity.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.offeringId)) throw new AppError("Invalid stock selection.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) throw new AppError("Invalid purchase request.");
  return transaction(async (client) => {
    const event = (await client.query(
      `SELECT e.id,e.phase,e.paused,e.investment_starts_at,e.investment_ends_at
       FROM events e JOIN teams t ON t.event_id=e.id WHERE t.id=$1 FOR UPDATE OF e`, [input.buyerTeamId],
    )).rows[0];
    if (!event) throw new AppError("Event is not configured.", 503);
    const existing = await client.query("SELECT id,offering_id,quantity,total_minor FROM purchases WHERE buyer_team_id=$1 AND idempotency_key=$2", [input.buyerTeamId, input.idempotencyKey]);
    if (existing.rowCount) {
      const purchase = existing.rows[0];
      if (purchase.offering_id !== input.offeringId || purchase.quantity !== input.quantity) throw new AppError("This request key was already used for another purchase.", 409);
      return { id: purchase.id as string, totalMinor: asNumber(purchase.total_minor), repeated: true };
    }
    const now = new Date((await client.query("SELECT clock_timestamp() AS now")).rows[0].now).getTime();
    if (event.phase !== "INVESTMENT" || event.paused) throw new AppError("The investment market is closed.", 409);
    if (event.investment_starts_at && now < new Date(event.investment_starts_at).getTime()) throw new AppError("Investment has not started yet.", 409);
    if (event.investment_ends_at && now >= new Date(event.investment_ends_at).getTime()) throw new AppError("Investment time has ended.", 409);
    const wallet = (await client.query(
      "SELECT w.team_id,w.available_minor,t.is_participant FROM wallets w JOIN teams t ON t.id=w.team_id WHERE w.team_id=$1 AND t.event_id=$2 FOR UPDATE OF w",
      [input.buyerTeamId, event.id],
    )).rows[0];
    if (!wallet || !wallet.is_participant) throw new AppError("Your team is not participating.", 403);
    const offering = (await client.query(
      "SELECT o.id,o.team_id,o.initial_quantity,o.sold_quantity,o.price_minor FROM offerings o WHERE o.id=$1 AND o.event_id=$2 FOR UPDATE",
      [input.offeringId, event.id],
    )).rows[0];
    if (!offering) throw new AppError("This stock is unavailable.", 404);
    if (offering.team_id === input.buyerTeamId) throw new AppError("You cannot buy your own team's stock.", 409);
    if (offering.initial_quantity - offering.sold_quantity < input.quantity) throw new AppError("There are not enough stocks remaining.", 409);
    const total = BigInt(offering.price_minor) * BigInt(input.quantity);
    if (total > BigInt(wallet.available_minor)) throw new AppError("Your wallet has insufficient balance.", 409);
    const purchase = (await client.query(
      `INSERT INTO purchases(event_id,buyer_team_id,offering_id,quantity,price_minor,total_minor,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [event.id, input.buyerTeamId, input.offeringId, input.quantity, offering.price_minor, total.toString(), input.idempotencyKey],
    )).rows[0];
    await client.query("UPDATE wallets SET available_minor=available_minor-$1,updated_at=now() WHERE team_id=$2", [total.toString(), input.buyerTeamId]);
    await client.query("UPDATE offerings SET sold_quantity=sold_quantity+$1 WHERE id=$2", [input.quantity, input.offeringId]);
    await client.query("UPDATE events SET trading_started=true,updated_at=now() WHERE id=$1", [event.id]);
    await audit(client, event.id, input.actorUserId ?? null, "PURCHASE", input.buyerTeamId, purchase.id, { offeringId: input.offeringId, quantity: input.quantity, totalMinor: total.toString() });
    return { id: purchase.id as string, totalMinor: Number(total), repeated: false };
  });
}

export async function reversePurchase(purchaseId: string, actorId: string, reason: string) {
  if (reason.trim().length < 5) throw new AppError("Give a reason for this reversal.");
  return transaction(async (client) => {
    const event = (await client.query(
      "SELECT e.id FROM events e JOIN purchases p ON p.event_id=e.id WHERE p.id=$1 FOR UPDATE OF e", [purchaseId],
    )).rows[0];
    if (!event) throw new AppError("Purchase not found.", 404);
    const purchase = (await client.query(
      `SELECT p.* FROM purchases p WHERE p.id=$1 AND p.event_id=$2 FOR UPDATE`, [purchaseId, event.id],
    )).rows[0];
    if (!purchase) throw new AppError("Purchase not found.", 404);
    const existing = await client.query("SELECT 1 FROM purchase_reversals WHERE purchase_id=$1", [purchaseId]);
    if (existing.rowCount) throw new AppError("Purchase was already reversed.", 409);
    await client.query("SELECT 1 FROM wallets WHERE team_id=$1 FOR UPDATE", [purchase.buyer_team_id]);
    await client.query("SELECT 1 FROM offerings WHERE id=$1 FOR UPDATE", [purchase.offering_id]);
    await client.query("INSERT INTO purchase_reversals(purchase_id,actor_user_id,reason) VALUES($1,$2,$3)", [purchaseId, actorId, reason.trim()]);
    await client.query("UPDATE wallets SET available_minor=available_minor+$1,updated_at=now() WHERE team_id=$2", [purchase.total_minor, purchase.buyer_team_id]);
    await client.query("UPDATE offerings SET sold_quantity=sold_quantity-$1 WHERE id=$2", [purchase.quantity, purchase.offering_id]);
    await audit(client, event.id, actorId, "PURCHASE_REVERSED", purchase.buyer_team_id, purchaseId, { reason: reason.trim(), totalMinor: purchase.total_minor });
    return { ok: true };
  });
}

export async function audit(client: PoolClient, event: string, actor: string | null, action: string, team: string | null, purchase: string | null, details: Record<string, unknown> = {}) {
  await client.query(
    "INSERT INTO audit_logs(event_id,actor_user_id,action,team_id,purchase_id,details) VALUES($1,$2,$3,$4,$5,$6)",
    [event, actor, action, team, purchase, JSON.stringify(details)],
  );
}

export async function marketSnapshot(teamId?: string) {
  const id = await eventId();
  const event = await one<any>("SELECT * FROM events WHERE id=$1", [id]);
  const offerings = await rows<any>(
    `SELECT o.id,o.team_id,t.name,t.college,o.initial_quantity,o.sold_quantity,o.price_minor,o.presentation_order,
      COALESCE(SUM(CASE WHEN r.id IS NULL THEN p.total_minor ELSE 0 END),0)::bigint AS received_minor
     FROM offerings o JOIN teams t ON t.id=o.team_id LEFT JOIN purchases p ON p.offering_id=o.id
     LEFT JOIN purchase_reversals r ON r.purchase_id=p.id WHERE o.event_id=$1
     GROUP BY o.id,t.id ORDER BY o.presentation_order NULLS LAST,t.name`, [id],
  );
  const wallet = teamId ? await one<any>("SELECT * FROM wallets WHERE team_id=$1", [teamId]) : null;
  const portfolio = teamId ? await rows<any>(
    `SELECT o.id AS offering_id,t.name AS team_name,COALESCE(SUM(CASE WHEN r.id IS NULL THEN p.quantity ELSE 0 END),0)::integer AS quantity,
      COALESCE(SUM(CASE WHEN r.id IS NULL THEN p.total_minor ELSE 0 END),0)::bigint AS invested_minor
     FROM purchases p JOIN offerings o ON o.id=p.offering_id JOIN teams t ON t.id=o.team_id
     LEFT JOIN purchase_reversals r ON r.purchase_id=p.id WHERE p.buyer_team_id=$1 GROUP BY o.id,t.name ORDER BY t.name`, [teamId],
  ) : [];
  return {
    event: { ...event, starting_balance_minor: asNumber(event.starting_balance_minor), stock_price_minor: asNumber(event.stock_price_minor) },
    offerings: offerings.map((o) => ({ ...o, price_minor: asNumber(o.price_minor), received_minor: asNumber(o.received_minor) })),
    wallet: wallet && { ...wallet, starting_minor: asNumber(wallet.starting_minor), available_minor: asNumber(wallet.available_minor) },
    portfolio: portfolio.map((p) => ({ ...p, invested_minor: asNumber(p.invested_minor) })),
  };
}

export async function leaderboard() {
  const id = await eventId();
  const leaders = await rows<any>(
    `SELECT t.id,t.name,t.college,o.initial_quantity,o.sold_quantity,
      COALESCE(SUM(CASE WHEN r.id IS NULL THEN p.total_minor ELSE 0 END),0)::bigint AS received_minor
     FROM offerings o JOIN teams t ON t.id=o.team_id LEFT JOIN purchases p ON p.offering_id=o.id
     LEFT JOIN purchase_reversals r ON r.purchase_id=p.id WHERE o.event_id=$1
     GROUP BY t.id,o.id ORDER BY received_minor DESC,t.name`, [id],
  );
  let lastTotal: string | null = null;
  let rank = 0;
  return leaders.map((leader, index) => {
    if (leader.received_minor !== lastTotal) rank = index + 1;
    lastTotal = leader.received_minor;
    return { ...leader, received_minor: asNumber(leader.received_minor), rank };
  });
}
