import { createHash, randomBytes, randomInt } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { AppError } from "./errors";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

export function initialPassword(): string {
  let result = "";
  for (let index = 0; index < 8; index++) result += alphabet[randomInt(alphabet.length)];
  return result;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export function verifyPassword(stored: string, password: string): Promise<boolean> {
  return verify(stored, password);
}

export function token(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = new URL(request.url).host;
  if (!origin || new URL(origin).host !== host) throw new AppError("Invalid request origin.", 403);
}
