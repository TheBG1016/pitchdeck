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

test("rejects missing columns, duplicate identities, and partial members", () => {
  assert.throws(() => parseTeamsCsv("team_name,college\nA,B"), /Missing required columns/);
  assert.throws(() => parseTeamsCsv([CSV_HEADERS.join(","), row(1), row(1)].join("\n")), /duplicate email/);
  const partial = row(2).split(","); partial[5] = "Member Two";
  assert.throws(() => parseTeamsCsv([CSV_HEADERS.join(","), partial.join(",")].join("\n")), /member_2 needs/);
});

test("initial credentials are eight characters and hash verification works", async () => {
  const password = initialPassword();
  assert.equal(password.length, 8);
  const stored = await hashPassword(password);
  assert.notEqual(stored, password);
  assert.equal(await verifyPassword(stored, password), true);
  assert.equal(await verifyPassword(stored, "wrongpass"), false);
});
