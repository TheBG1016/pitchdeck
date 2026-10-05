import "./env";
import { Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { hashPassword } from "../src/lib/security";

const email = process.argv[2]?.trim().toLowerCase();
const password = process.env.ADMIN_INITIAL_PASSWORD;
if (!email || !password || password.length < 12) throw new Error("Set ADMIN_INITIAL_PASSWORD (12+ characters) and run: npm run admin:create -- <email>");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
neonConfig.webSocketConstructor = WebSocket;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const existing = await client.query("SELECT 1 FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (existing.rowCount) throw new Error("An admin already exists. Use the application to manage credentials.");
  await client.query("INSERT INTO users(role,email,password_hash) VALUES('ADMIN',$1,$2)", [email, await hashPassword(password)]);
  console.log(`Created admin ${email}`);
} finally {
  await client.end();
}
