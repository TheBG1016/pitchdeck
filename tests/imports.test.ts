import test from "node:test";
import assert from "node:assert/strict";
import { CSV_HEADERS, parseTeamsCsv } from "../src/lib/imports";
import { hashPassword, initialPassword, verifyPassword } from "../src/lib/security";

const row = (index: number) => [
  `Venture ${index}`, `Leader ${index}`, `leader${index}@example.com`, `REG${index}`, "Example College",
  "", "", "", "", "", "", "", "", "",
].join(",");

test("parses five teams and optional empty members", () => {
  const parsed = parseTeamsCsv([CSV_HEADERS.join(","), ...Array.from({ length: 5 }, (_, index) => row(index + 1))].join("\n"));
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].members.length, 1);
  assert.equal(parsed[0].members[0].registrationNumber, "REG1");
});

test("accepts the registration form export columns", () => {
  const header = "Timestamp,Team Name,Team Leader Name,Team Member 1 (Team Leader) Email ID,Team Member 1 (Team Leader) Phone Number,Team Member 1 (Team Leader) College,Team Member 1 (Team Leader) Registration Number,Team Member 2 Name,Team Member 2 Email ID,Team Member 2 Phone Number,Team Member 2 College,Team Member 2 Registration Number,Team Member 3 Name,Team Member 3 Email ID,Team Member 3 Phone Number,Team Member 3 College,Team Member 3 Registration Number,Confirmation";
  const line = "2026-10-01 10:00,Venture,Leader,Leader@Example.com,999,Example College,REG1,Two,two@example.com,888,Example College,REG2,,,,,,Yes";
  const [team] = parseTeamsCsv([header, line].join("\n"));
  assert.equal(team.name, "Venture");
  assert.equal(team.college, "Example College");
  assert.deepEqual(team.members.map((m) => [m.slot, m.name, m.email, m.registrationNumber]), [
    [1, "Leader", "leader@example.com", "REG1"],
    [2, "Two", "two@example.com", "REG2"],
  ]);
});

test("rejects missing columns, duplicate identities, and incomplete leaders", () => {
  assert.throws(() => parseTeamsCsv("team_name,college\nA,B"), /Missing required columns/);
  const sharedMember = row(2).split(","); sharedMember.splice(5, 3, "Leader 1", "leader1@example.com", "REG1");
  assert.throws(() => parseTeamsCsv([CSV_HEADERS.join(","), row(1), sharedMember.join(",")].join("\n")), /duplicate email leader1@example.com/);
  const noLeaderEmail = row(3).split(","); noLeaderEmail[2] = "";
  assert.throws(() => parseTeamsCsv([CSV_HEADERS.join(","), noLeaderEmail.join(",")].join("\n")), /team_leader needs/);
});

test("a later row from the same leader replaces the earlier one", () => {
  const resubmitted = row(1).split(","); resubmitted[0] = "Venture 1 Renamed";
  const byEmail = row(2).split(","); byEmail[3] = "REG2-NEW";
  const parsed = parseTeamsCsv([CSV_HEADERS.join(","), row(1), row(2), resubmitted.join(","), byEmail.join(",")].join("\n"));
  assert.deepEqual(parsed.map((team) => team.name), ["Venture 1 Renamed", "Venture 2"]);
  assert.equal(parsed[1].members[0].registrationNumber, "REG2-NEW");
});

test("skips members 2-4 with missing fields", () => {
  const partial = row(2).split(","); partial[5] = "Member Two";
  const [team] = parseTeamsCsv([CSV_HEADERS.join(","), partial.join(",")].join("\n"));
  assert.equal(team.members.length, 1);
});

test("initial credentials are eight characters and hash verification works", async () => {
  const password = initialPassword();
  assert.equal(password.length, 8);
  const stored = await hashPassword(password);
  assert.notEqual(stored, password);
  assert.equal(await verifyPassword(stored, password), true);
  assert.equal(await verifyPassword(stored, "wrongpass"), false);
});
