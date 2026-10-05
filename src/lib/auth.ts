import { cookies } from "next/headers";
import { http, one } from "./db";
import { AppError } from "./errors";
import { normalize, sha256, token, verifyPassword } from "./security";

const COOKIE_NAME = "investment_pool_session";
const SESSION_SECONDS = 60 * 60 * 12;

export type Actor = { id: string; role: "ADMIN" | "TEAM_LEADER"; team_id: string | null; email: string };

export async function currentActor(): Promise<Actor | null> {
  const cookie = (await cookies()).get(COOKIE_NAME)?.value;
  if (!cookie) return null;
  return one<Actor>(
    `SELECT u.id,u.role,u.team_id,u.email FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at>now()`,
    [sha256(cookie)],
  );
}

export async function requireActor(role?: Actor["role"]): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new AppError("Please sign in.", 401);
  if (role && actor.role !== role) throw new AppError("Access denied.", 403);
  return actor;
}

export async function signIn(identifier: string, password: string): Promise<Actor> {
  const key = sha256(`login:${normalize(identifier)}`);
  const attempts = await one<{ count: number; locked_until: Date | null }>("SELECT count,locked_until FROM login_attempts WHERE attempt_key=$1", [key]);
  if (attempts?.locked_until && new Date(attempts.locked_until).getTime() > Date.now()) throw new AppError("Too many attempts. Try again in 15 minutes.", 429);
  const user = await one<Actor & { password_hash: string }>(
    `SELECT u.id,u.role,u.team_id,u.email,u.password_hash FROM users u
     LEFT JOIN team_members m ON m.team_id=u.team_id AND m.slot=1
     WHERE lower(u.email)=$1 OR (u.role='TEAM_LEADER' AND lower(m.registration_number)=$1) LIMIT 1`,
    [normalize(identifier)],
  );
  const valid = user ? await verifyPassword(user.password_hash, password) : false;
  if (!valid || !user) {
    await http().query(
      `INSERT INTO login_attempts(attempt_key,count,window_started_at,locked_until) VALUES($1,1,now(),NULL)
       ON CONFLICT(attempt_key) DO UPDATE SET
       count=CASE WHEN login_attempts.window_started_at < now()-interval '15 minutes' THEN 1 ELSE login_attempts.count+1 END,
       window_started_at=CASE WHEN login_attempts.window_started_at < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_started_at END,
       locked_until=CASE WHEN login_attempts.window_started_at >= now()-interval '15 minutes' AND login_attempts.count+1>=5 THEN now()+interval '15 minutes' ELSE NULL END`,
      [key],
    );
    throw new AppError("Invalid credentials.", 401);
  }
  await http().query("DELETE FROM login_attempts WHERE attempt_key=$1", [key]);
  await http().query("DELETE FROM sessions WHERE expires_at<now()");
  const raw = token();
  await http().query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')", [sha256(raw), user.id]);
  (await cookies()).set(COOKIE_NAME, raw, {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return { id: user.id, role: user.role, team_id: user.team_id, email: user.email };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const raw = jar.get(COOKIE_NAME)?.value;
  if (raw) await http().query("DELETE FROM sessions WHERE token_hash=$1", [sha256(raw)]);
  jar.delete(COOKIE_NAME);
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await http().query("DELETE FROM sessions WHERE user_id=$1", [userId]);
}
