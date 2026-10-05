import { Pool, neon, neonConfig, type NeonQueryFunction, type PoolClient, type QueryResultRow } from "@neondatabase/serverless";
import WebSocket from "ws";

neonConfig.webSocketConstructor = WebSocket;
export type { PoolClient };

const globalDb = globalThis as typeof globalThis & { __pool?: Pool; __http?: NeonQueryFunction<false, false> };

export function http(): NeonQueryFunction<false, false> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  globalDb.__http ??= neon(process.env.DATABASE_URL);
  return globalDb.__http;
}

export function pool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if (!globalDb.__pool) {
    globalDb.__pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalDb.__pool;
}

export async function rows<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return (await http().query(sql, values)) as T[]; }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === 2 || !/fetch failed|connect timeout|connection terminated|ETIMEDOUT|ECONNRESET/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw new Error("Database query retry exhausted");
}

export async function one<T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []): Promise<T | null> {
  return (await rows<T>(sql, values))[0] ?? null;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function eventId(): Promise<string> {
  const event = await one<{ id: string }>("SELECT id FROM events ORDER BY created_at LIMIT 1");
  if (!event) throw new Error("Database is not initialized. Run npm run db:migrate.");
  return event.id;
}
