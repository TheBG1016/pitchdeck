import { parse } from "csv-parse/sync";
import { eventId, rows, transaction, type PoolClient } from "./db";
import { AppError } from "./errors";
import { audit } from "./engine";
import { hashPassword, initialPassword, normalize } from "./security";

export type ImportMember = { slot: number; name: string; email: string; registrationNumber: string };
export type ImportRow = { name: string; college: string; members: ImportMember[] };

export const CSV_HEADERS = [
  "team_name", "team_leader_name", "team_leader_email", "team_leader_registration_number", "college",
  ...[2, 3, 4].flatMap((n) => [`member_${n}_name`, `member_${n}_email`, `member_${n}_registration_number`]),
];

// Registration form export headers (normalized) mapped to the template columns above.
const FORM_HEADER_ALIASES: Record<string, string> = {
  "team member 1 (team leader) email id": "team_leader_email",
  "team member 1 (team leader) registration number": "team_leader_registration_number",
  "team member 1 (team leader) college": "college",
  ...Object.fromEntries([2, 3].flatMap((n) => [
    [`team member ${n} name`, `member_${n}_name`],
    [`team member ${n} email id`, `member_${n}_email`],
    [`team member ${n} registration number`, `member_${n}_registration_number`],
  ])),
};

export function parseTeamsCsv(content: string): ImportRow[] {
  if (Buffer.byteLength(content, "utf8") > 2_000_000) throw new AppError("CSV must be smaller than 2 MB.");
  let records: string[][];
  try { records = parse(content, { bom: true, skip_empty_lines: true, relax_quotes: false }); }
  catch { throw new AppError("The CSV could not be parsed. Check quotes and commas."); }
  if (records.length < 2) throw new AppError("CSV must have a header and at least one team.");
  const header = records[0].map((cell) => FORM_HEADER_ALIASES[normalize(cell)] ?? normalize(cell).replaceAll(" ", "_"));
  const missing = CSV_HEADERS.slice(0, 5).filter((column) => !header.includes(column));
  if (missing.length) throw new AppError(`Missing required columns: ${missing.join(", ")}`);
  const rowsRead: { line: number; team: ImportRow; errors: string[] }[] = [];
  for (let index = 1; index < records.length; index++) {
    const row = records[index];
    const get = (key: string) => (row[header.indexOf(key)] ?? "").trim();
    const name = get("team_name");
    const college = get("college");
    const members: ImportMember[] = [];
    const rowErrors: string[] = [];
    for (let slot = 1; slot <= 4; slot++) {
      const prefix = slot === 1 ? "team_leader" : `member_${slot}`;
      const member = { slot, name: get(`${prefix}_name`), email: normalize(get(`${prefix}_email`)), registrationNumber: get(`${prefix}_registration_number`) };
      const filled = [member.name, member.email, member.registrationNumber].filter(Boolean).length;
      // Members 2-4 with missing fields are skipped; the leader must be complete.
      if (filled === 3) members.push(member);
      else if (slot === 1) rowErrors.push(`Row ${index + 1}: ${prefix} needs a name, email, and registration number.`);
    }
    if (!name || !college) rowErrors.push(`Row ${index + 1}: team name and college are required.`);
    for (const member of members) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)) rowErrors.push(`Row ${index + 1}: invalid email ${member.email}.`);
    }
    rowsRead.push({ line: index + 1, team: { name, college, members }, errors: rowErrors });
  }
  // A later row with the same team leader (registration number or email) is a resubmission and replaces the earlier row.
  const kept = rowsRead.map(() => true);
  const leaderRows = new Map<string, number>();
  rowsRead.forEach(({ team }, index) => {
    const leader = team.members.find((member) => member.slot === 1);
    if (!leader) return;
    for (const key of [`reg:${normalize(leader.registrationNumber)}`, `email:${leader.email}`]) {
      const earlier = leaderRows.get(key);
      if (earlier !== undefined) kept[earlier] = false;
      leaderRows.set(key, index);
    }
  });
  const result: ImportRow[] = [];
  const emailSet = new Set<string>();
  const registrationSet = new Set<string>();
  const errors: string[] = [];
  rowsRead.forEach(({ line, team, errors: rowErrors }, index) => {
    if (!kept[index]) return;
    errors.push(...rowErrors);
    for (const member of team.members) {
      const reg = normalize(member.registrationNumber);
      if (emailSet.has(member.email)) errors.push(`Row ${line}: duplicate email ${member.email}.`);
      if (registrationSet.has(reg)) errors.push(`Row ${line}: duplicate registration number ${member.registrationNumber}.`);
      emailSet.add(member.email);
      registrationSet.add(reg);
    }
    result.push(team);
  });
  if (result.length > 1000) errors.push("CSV may contain at most 1,000 teams.");
  if (errors.length) throw new AppError(errors.slice(0, 20).join("\n"));
  return result;
}

export async function createImportDraft(content: string, actorId: string) {
  const parsed = parseTeamsCsv(content);
  const id = await eventId();
  const existing = await rows<{ registration_number: string; team_id: string; name: string }>(
    `SELECT m.registration_number,m.team_id,t.name FROM team_members m JOIN teams t ON t.id=m.team_id
     WHERE m.slot=1 AND t.event_id=$1`, [id],
  );
  const existingMembers = await rows<{ email: string; registration_number: string; team_id: string }>(
    `SELECT m.email,m.registration_number,m.team_id FROM team_members m JOIN teams t ON t.id=m.team_id WHERE t.event_id=$1`, [id],
  );
  const map = new Map(existing.map((team) => [normalize(team.registration_number), team]));
  const emails = new Map(existingMembers.map((member) => [normalize(member.email), member.team_id]));
  const registrations = new Map(existingMembers.map((member) => [normalize(member.registration_number), member.team_id]));
  const conflicts: string[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const team = parsed[index];
    const matchedTeamId = map.get(normalize(team.members[0].registrationNumber))?.team_id;
    for (const member of team.members) {
      const emailOwner = emails.get(normalize(member.email));
      const registrationOwner = registrations.get(normalize(member.registrationNumber));
      if (emailOwner && emailOwner !== matchedTeamId) conflicts.push(`Row ${index + 2}: email ${member.email} belongs to another team.`);
      if (registrationOwner && registrationOwner !== matchedTeamId) conflicts.push(`Row ${index + 2}: registration ${member.registrationNumber} belongs to another team.`);
    }
  }
  if (conflicts.length) throw new AppError(conflicts.slice(0, 20).join("\n"), 409);
  const preview = parsed.map((team) => ({ ...team, action: map.has(normalize(team.members[0].registrationNumber)) ? "UPDATE" : "CREATE" }));
  const draft = await transaction(async (client) => {
    const event = (await client.query("SELECT phase,trading_started FROM events WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (event.trading_started || !["REGISTRATION", "SHORTLISTING"].includes(event.phase)) throw new AppError("Imports are closed after presentations begin.", 409);
    await client.query("DELETE FROM import_drafts WHERE expires_at<now()");
    return (await client.query(
      "INSERT INTO import_drafts(event_id,actor_user_id,rows,expires_at) VALUES($1,$2,$3,now()+interval '1 hour') RETURNING id",
      [id, actorId, JSON.stringify(parsed)],
    )).rows[0].id as string;
  });
  return { draftId: draft, preview, count: parsed.length };
}

async function writeMember(client: PoolClient, teamId: string, member: ImportMember) {
  await client.query(
    "INSERT INTO team_members(team_id,slot,name,email,registration_number) VALUES($1,$2,$3,$4,$5)",
    [teamId, member.slot, member.name, member.email, member.registrationNumber],
  );
}

export async function confirmImport(draftId: string, actorId: string) {
  return transaction(async (client) => {
    const draft = (await client.query(
      "SELECT * FROM import_drafts WHERE id=$1 AND actor_user_id=$2 AND expires_at>now() FOR UPDATE",
      [draftId, actorId],
    )).rows[0];
    if (!draft) throw new AppError("Import preview expired. Upload the CSV again.", 409);
    const event = (await client.query("SELECT phase,trading_started FROM events WHERE id=$1 FOR UPDATE", [draft.event_id])).rows[0];
    if (event.trading_started || !["REGISTRATION", "SHORTLISTING"].includes(event.phase)) throw new AppError("Imports are closed after presentations begin.", 409);
    const teams = draft.rows as ImportRow[];
    const credentials: { team: string; email: string; registrationNumber: string; password: string }[] = [];
    let created = 0;
    let updated = 0;
    const existingRows = (await client.query(
      `SELECT t.id,m.registration_number FROM teams t JOIN team_members m ON m.team_id=t.id AND m.slot=1
       WHERE t.event_id=$1 AND lower(m.registration_number)=ANY($2::text[])`,
      [draft.event_id, teams.map((team) => normalize(team.members[0].registrationNumber))],
    )).rows;
    const existingByRegistration = new Map(existingRows.map((row) => [normalize(row.registration_number), row.id as string]));
    const assigned: { team: ImportRow; teamId: string }[] = [];
    for (const team of teams) {
      const leader = team.members[0];
      const existing = existingByRegistration.get(normalize(leader.registrationNumber));
      let teamId: string;
      if (existing) {
        teamId = existing;
        await client.query("UPDATE teams SET name=$1,college=$2,updated_at=now() WHERE id=$3", [team.name, team.college, teamId]);
        updated++;
      } else {
        teamId = (await client.query("INSERT INTO teams(event_id,name,college) VALUES($1,$2,$3) RETURNING id", [draft.event_id, team.name, team.college])).rows[0].id;
        created++;
      }
      assigned.push({ team, teamId });
    }
    await client.query("DELETE FROM team_members WHERE team_id=ANY($1::uuid[])", [assigned.map((item) => item.teamId)]);
    await client.query("UPDATE users SET email=id::text || '@import.invalid' WHERE team_id=ANY($1::uuid[])", [assigned.map((item) => item.teamId)]);
    for (const { team, teamId } of assigned) {
      const leader = team.members[0];
      for (const member of team.members) await writeMember(client, teamId, member);
      const user = (await client.query("SELECT id FROM users WHERE team_id=$1", [teamId])).rows[0];
      if (user) await client.query("UPDATE users SET email=$1,updated_at=now() WHERE id=$2", [leader.email, user.id]);
      else {
        const password = initialPassword();
        await client.query("INSERT INTO users(role,email,team_id,password_hash) VALUES('TEAM_LEADER',$1,$2,$3)", [leader.email, teamId, await hashPassword(password)]);
        credentials.push({ team: team.name, email: leader.email, registrationNumber: leader.registrationNumber, password });
      }
    }
    await client.query("DELETE FROM import_drafts WHERE id=$1", [draftId]);
    await audit(client, draft.event_id, actorId, "TEAMS_IMPORTED", null, null, { created, updated, credentialsGenerated: credentials.length });
    return { created, updated, credentials };
  });
}
