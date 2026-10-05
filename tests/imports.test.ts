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
