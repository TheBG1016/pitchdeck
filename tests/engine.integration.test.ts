import test from "node:test";
import assert from "node:assert/strict";
import { Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import "../scripts/env";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? (process.env.NEON_BRANCH === "investment-pool-dev" ? process.env.DATABASE_URL : undefined);

test("PostgreSQL purchase concurrency and trading rules", { skip: !testDatabaseUrl || process.env.TEST_DB_CONFIRM !== "I_AM_ON_A_DEV_BRANCH" }, async () => {
  if (!testDatabaseUrl) throw new Error("TEST_DATABASE_URL is required");
  process.env.DATABASE_URL = testDatabaseUrl;
  neonConfig.webSocketConstructor = WebSocket;
  const { buyStock, reversePurchase } = await import("../src/lib/engine");
  const client = new Client({ connectionString: testDatabaseUrl });
  await client.connect();
  const suffix = randomUUID().slice(0, 8);
  const eventId = (await client.query("INSERT INTO events(name,phase,starting_balance_minor,stock_price_minor,stocks_per_team) VALUES($1,'INVESTMENT',150000,10000,10) RETURNING id", [`Integration ${suffix}`])).rows[0].id;
  const teams: string[] = [];
  let adminId: string | null = null;
  try {
    for (let index = 0; index < 5; index++) {
      const teamId = (await client.query("INSERT INTO teams(event_id,name,college,is_participant) VALUES($1,$2,'Test College',true) RETURNING id", [eventId, `Test ${suffix}-${index}`])).rows[0].id;
      teams.push(teamId);
      await client.query("INSERT INTO wallets(team_id,starting_minor,available_minor) VALUES($1,150000,150000)", [teamId]);
    }
    const offeringA = (await client.query("INSERT INTO offerings(event_id,team_id,initial_quantity,price_minor) VALUES($1,$2,10,10000) RETURNING id", [eventId, teams[0]])).rows[0].id;
    const offeringB = (await client.query("INSERT INTO offerings(event_id,team_id,initial_quantity,price_minor) VALUES($1,$2,10,10000) RETURNING id", [eventId, teams[1]])).rows[0].id;
    const [first, second] = await Promise.allSettled([
      buyStock({ buyerTeamId: teams[2], offeringId: offeringA, quantity: 6, idempotencyKey: randomUUID() }),
      buyStock({ buyerTeamId: teams[3], offeringId: offeringA, quantity: 6, idempotencyKey: randomUUID() }),
    ]);
    assert.equal([first, second].filter((outcome) => outcome.status === "fulfilled").length, 1);
    const winner = first.status === "fulfilled" ? first.value : (second as PromiseFulfilledResult<any>).value;
    const winnerTeam = first.status === "fulfilled" ? teams[2] : teams[3];
    const repeated = await buyStock({ buyerTeamId: winnerTeam, offeringId: offeringA, quantity: 6, idempotencyKey: (await client.query("SELECT idempotency_key FROM purchases WHERE id=$1", [winner.id])).rows[0].idempotency_key });
    assert.equal(repeated.repeated, true);
    await assert.rejects(buyStock({ buyerTeamId: teams[0], offeringId: offeringA, quantity: 1, idempotencyKey: randomUUID() }), /own team/);
    await assert.rejects(buyStock({ buyerTeamId: winnerTeam, offeringId: offeringB, quantity: 10, idempotencyKey: randomUUID() }), /insufficient balance/);
    await assert.rejects(buyStock({ buyerTeamId: teams[4], offeringId: offeringA, quantity: 5, idempotencyKey: randomUUID() }), /not enough stocks/);
    await buyStock({ buyerTeamId: teams[4], offeringId: offeringA, quantity: 4, idempotencyKey: randomUUID() });
    await assert.rejects(buyStock({ buyerTeamId: teams[1], offeringId: offeringA, quantity: 1, idempotencyKey: randomUUID() }), /not enough stocks/);
    await client.query("UPDATE events SET phase='CLOSED' WHERE id=$1", [eventId]);
    await assert.rejects(buyStock({ buyerTeamId: teams[2], offeringId: offeringB, quantity: 1, idempotencyKey: randomUUID() }), /closed/);
    const createdAdminId: string = (await client.query("INSERT INTO users(role,email,password_hash) VALUES('ADMIN',$1,'test-hash') RETURNING id", [`admin-${suffix}@example.invalid`])).rows[0].id;
    adminId = createdAdminId;
    await reversePurchase(winner.id, createdAdminId, "Integration correction");
    const stock = (await client.query("SELECT sold_quantity FROM offerings WHERE id=$1", [offeringA])).rows[0].sold_quantity;
    assert.equal(stock, 4);
  } catch (error) {
    console.error("Integration test failed:", error);
    throw error;
  } finally {
    await client.query("DELETE FROM audit_logs WHERE event_id=$1", [eventId]);
    await client.query("DELETE FROM purchase_reversals WHERE purchase_id IN (SELECT id FROM purchases WHERE event_id=$1)", [eventId]);
    await client.query("DELETE FROM purchases WHERE event_id=$1", [eventId]);
    await client.query("DELETE FROM offerings WHERE event_id=$1", [eventId]);
    await client.query("DELETE FROM wallets WHERE team_id=ANY($1::uuid[])", [teams]);
    await client.query("DELETE FROM teams WHERE event_id=$1", [eventId]);
    await client.query("DELETE FROM events WHERE id=$1", [eventId]);
    if (adminId) await client.query("DELETE FROM users WHERE id=$1", [adminId]);
    await client.end();
  }
});
