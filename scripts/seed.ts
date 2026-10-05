import "./env";
import { Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { hashPassword, initialPassword } from "../src/lib/security";

if (process.env.DEV_SEED_CONFIRM !== "I_AM_ON_A_DEV_BRANCH") throw new Error("Seed is for an isolated development branch only. Set DEV_SEED_CONFIRM=I_AM_ON_A_DEV_BRANCH after checking the Neon branch.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
neonConfig.webSocketConstructor = WebSocket;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  const event = (await client.query("SELECT id,starting_balance_minor,stocks_per_team,stock_price_minor FROM events ORDER BY created_at LIMIT 1 FOR UPDATE")).rows[0];
  if (!event) throw new Error("Run migrations before seeding.");
  const count = (await client.query("SELECT COUNT(*)::integer AS count FROM teams WHERE event_id=$1", [event.id])).rows[0].count;
  if (count) throw new Error("Development seed requires an event without teams.");
  const credentials: string[] = [];
  for (let index = 1; index <= 6; index++) {
    const name = `Demo Venture ${index}`;
    const email = `dev-leader-${index}@example.invalid`;
    const registration = `DEV-${String(index).padStart(3, "0")}`;
    const teamId = (await client.query("INSERT INTO teams(event_id,name,college,is_participant) VALUES($1,$2,$3,true) RETURNING id", [event.id, name, "Demo College"])).rows[0].id;
    await client.query("INSERT INTO team_members(team_id,slot,name,email,registration_number) VALUES($1,1,$2,$3,$4)", [teamId, `Demo Leader ${index}`, email, registration]);
    const password = initialPassword();
    await client.query("INSERT INTO users(role,email,team_id,password_hash) VALUES('TEAM_LEADER',$1,$2,$3)", [email, teamId, await hashPassword(password)]);
    await client.query("INSERT INTO wallets(team_id,starting_minor,available_minor) VALUES($1,$2,$2)", [teamId, event.starting_balance_minor]);
    if (index <= 3) await client.query("INSERT INTO offerings(event_id,team_id,initial_quantity,price_minor,presentation_order) VALUES($1,$2,$3,$4,$5)", [event.id, teamId, event.stocks_per_team, event.stock_price_minor, index]);
    credentials.push(`${name}: ${email} / ${password}`);
  }
  await client.query("UPDATE events SET phase='PRESENTATION' WHERE id=$1", [event.id]);
  await client.query("COMMIT");
  console.log("Seeded six demo teams and three investable offerings. One-time development credentials:");
  for (const credential of credentials) console.log(credential);
} catch (error) {
  await client.query("ROLLBACK"); throw error;
} finally { await client.end(); }
