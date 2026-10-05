import "./env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
neonConfig.webSocketConstructor = WebSocket;
const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const name = "001_initial.sql";
  const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
  if (!existing.rowCount) {
    await client.query(readFileSync(join("db", name), "utf8"));
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    console.log(`Applied ${name}`);
  } else console.log("Database schema is current");
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
