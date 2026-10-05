import { eventId, one, rows, transaction } from "./db";
import { AppError } from "./errors";
import { audit, leaderboard, reversePurchase } from "./engine";
import { hashPassword, initialPassword } from "./security";

const phases = ["REGISTRATION", "SHORTLISTING", "PRESENTATION", "INVESTMENT", "CLOSED", "RESULTS"] as const;

export async function adminSnapshot() {
  const id = await eventId();
  const event = await one<any>("SELECT * FROM events WHERE id=$1", [id]);
  const teams = await rows<any>(
    `SELECT t.*,u.id AS user_id,m.name AS leader_name,m.email AS leader_email,m.registration_number AS leader_registration,
       o.id AS offering_id,o.presentation_order,w.available_minor
     FROM teams t JOIN team_members m ON m.team_id=t.id AND m.slot=1
     LEFT JOIN users u ON u.team_id=t.id LEFT JOIN offerings o ON o.team_id=t.id
     LEFT JOIN wallets w ON w.team_id=t.id WHERE t.event_id=$1 ORDER BY t.name`, [id],
  );
  const members = await rows<any>("SELECT m.* FROM team_members m JOIN teams t ON t.id=m.team_id WHERE t.event_id=$1 ORDER BY m.team_id,m.slot", [id]);
  const purchases = await rows<any>(
    `SELECT p.id,p.created_at,p.quantity,p.price_minor,p.total_minor,b.name AS buyer_name,t.name AS target_name,
      r.id AS reversal_id,r.reason AS reversal_reason
     FROM purchases p JOIN teams b ON b.id=p.buyer_team_id JOIN offerings o ON o.id=p.offering_id
     JOIN teams t ON t.id=o.team_id LEFT JOIN purchase_reversals r ON r.purchase_id=p.id
     WHERE p.event_id=$1 ORDER BY p.created_at DESC LIMIT 500`, [id],
  );
  const audits = await rows<any>(
    `SELECT a.id,a.action,a.details,a.created_at,u.email AS actor_email,t.name AS team_name
     FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id LEFT JOIN teams t ON t.id=a.team_id
     WHERE a.event_id=$1 ORDER BY a.created_at DESC LIMIT 200`, [id],
  );
  const purchaseStats = await one<any>(
    `SELECT COUNT(*) FILTER (WHERE r.id IS NULL)::integer AS active_transactions,
      COUNT(*)::integer AS all_transactions,
      COALESCE(SUM(p.total_minor) FILTER (WHERE r.id IS NULL),0)::bigint AS circulated_minor
     FROM purchases p LEFT JOIN purchase_reversals r ON r.purchase_id=p.id WHERE p.event_id=$1`, [id],
  );
  const mostActive = await one<any>(
    `SELECT t.name,COALESCE(SUM(p.total_minor),0)::bigint AS invested_minor
     FROM purchases p JOIN teams t ON t.id=p.buyer_team_id LEFT JOIN purchase_reversals r ON r.purchase_id=p.id
     WHERE p.event_id=$1 AND r.id IS NULL GROUP BY t.id ORDER BY invested_minor DESC,t.name LIMIT 1`, [id],
  );
  return {
    event: { ...event, starting_balance_minor: Number(event.starting_balance_minor), stock_price_minor: Number(event.stock_price_minor) },
    teams: teams.map((t) => ({ ...t, available_minor: t.available_minor == null ? null : Number(t.available_minor) })),
    members,
    purchases: purchases.map((p) => ({ ...p, price_minor: Number(p.price_minor), total_minor: Number(p.total_minor) })),
    audits,
    leaderboard: await leaderboard(),
    stats: { activeTransactions: purchaseStats?.active_transactions ?? 0, allTransactions: purchaseStats?.all_transactions ?? 0, circulatedMinor: Number(purchaseStats?.circulated_minor ?? 0), mostActiveInvestor: mostActive?.name ?? null, mostActiveInvestedMinor: Number(mostActive?.invested_minor ?? 0) },
  };
}

function moneyInput(value: unknown, label: string, allowZero = false): number {
  if (value === null || value === undefined || value === "") throw new AppError(`${label} is required.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > 1_000_000_000_000) throw new AppError(`${label} must be a valid amount in minor units.`);
  return number;
}

export async function adminAction(body: any, actorId: string) {
  if (body.action === "reversePurchase") return reversePurchase(String(body.purchaseId), actorId, String(body.reason ?? ""));
  const id = await eventId();
  return transaction(async (client) => {
    const event = (await client.query("SELECT * FROM events WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!event) throw new AppError("Event not found.", 404);
    const action = String(body.action ?? "");
    if (action === "saveSettings") {
      if (event.trading_started) throw new AppError("Economic settings are locked after trading starts.", 409);
      const starting = moneyInput(body.startingBalanceMinor, "Starting balance", true);
      const price = moneyInput(body.stockPriceMinor, "Stock price");
      const quantity = Number(body.stocksPerTeam);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new AppError("Invalid stock quantity.");
      const currency = String(body.currencyCode ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) throw new AppError("Currency must be a three-letter code.");
      const name = String(body.name ?? "").trim();
      if (!name || name.length > 120) throw new AppError("Enter an event name.");
      const start = body.investmentStartsAt ? new Date(body.investmentStartsAt) : null;
      const end = body.investmentEndsAt ? new Date(body.investmentEndsAt) : null;
      if ((start && isNaN(start.getTime())) || (end && isNaN(end.getTime())) || (start && end && start >= end)) throw new AppError("Enter a valid investment window.");
      await client.query(
        `UPDATE events SET name=$1,currency_code=$2,starting_balance_minor=$3,stocks_per_team=$4,stock_price_minor=$5,
         investment_starts_at=$6,investment_ends_at=$7,updated_at=now() WHERE id=$8`,
        [name, currency, starting, quantity, price, start, end, id],
      );
      await client.query("UPDATE wallets SET starting_minor=$1,available_minor=$1,updated_at=now() WHERE team_id IN (SELECT id FROM teams WHERE event_id=$2)", [starting, id]);
      await client.query("UPDATE offerings SET initial_quantity=$1,price_minor=$2 WHERE event_id=$3", [quantity, price, id]);
      await audit(client, id, actorId, "SETTINGS_CHANGED", null, null, { before: { name: event.name, currency: event.currency_code, starting: event.starting_balance_minor, stock: event.stocks_per_team, price: event.stock_price_minor }, after: { name, currency, starting, quantity, price, start, end } });
      return { ok: true };
    }
    if (action === "extendWindow") {
      const end = new Date(body.investmentEndsAt);
      if (isNaN(end.getTime()) || end.getTime() <= Date.now()) throw new AppError("New closing time must be in the future.");
      if (!event.trading_started) throw new AppError("Use event settings before trading starts.");
      await client.query("UPDATE events SET investment_ends_at=$1,updated_at=now() WHERE id=$2", [end, id]);
      await audit(client, id, actorId, "WINDOW_EXTENDED", null, null, { previous: event.investment_ends_at, next: end });
      return { ok: true };
    }
    if (action === "participant") {
      if (event.trading_started || !["REGISTRATION", "SHORTLISTING"].includes(event.phase)) throw new AppError("Participant selection is closed.", 409);
      const team = (await client.query("SELECT id,is_participant FROM teams WHERE id=$1 AND event_id=$2 FOR UPDATE", [body.teamId, id])).rows[0];
      if (!team) throw new AppError("Team not found.", 404);
      const selected = body.selected === true;
      if (!selected) {
        const offering = await client.query("SELECT 1 FROM offerings WHERE team_id=$1", [team.id]);
        if (offering.rowCount) throw new AppError("Remove this team from the shortlist first.", 409);
        await client.query("DELETE FROM wallets WHERE team_id=$1", [team.id]);
      } else await client.query(
        "INSERT INTO wallets(team_id,starting_minor,available_minor) VALUES($1,$2,$2) ON CONFLICT(team_id) DO NOTHING",
        [team.id, event.starting_balance_minor],
      );
      await client.query("UPDATE teams SET is_participant=$1,updated_at=now() WHERE id=$2", [selected, team.id]);
      await audit(client, id, actorId, "PARTICIPANT_CHANGED", team.id, null, { before: team.is_participant, after: selected });
      return { ok: true };
    }
    if (action === "shortlist") {
      if (event.trading_started || !["REGISTRATION", "SHORTLISTING", "PRESENTATION"].includes(event.phase)) throw new AppError("Shortlist is locked.", 409);
      const team = (await client.query("SELECT id,is_participant FROM teams WHERE id=$1 AND event_id=$2 FOR UPDATE", [body.teamId, id])).rows[0];
      if (!team) throw new AppError("Team not found.", 404);
      if (!team.is_participant) throw new AppError("Select this team as a participant first.", 409);
      const selected = body.selected === true;
      if (selected) {
        const next = (await client.query("SELECT COALESCE(MAX(presentation_order),0)+1 AS n FROM offerings WHERE event_id=$1", [id])).rows[0].n;
        await client.query(
          "INSERT INTO offerings(event_id,team_id,initial_quantity,price_minor,presentation_order) VALUES($1,$2,$3,$4,$5) ON CONFLICT(team_id) DO NOTHING",
          [id, team.id, event.stocks_per_team, event.stock_price_minor, next],
        );
      } else {
        await client.query("UPDATE events SET current_presentation_team_id=NULL WHERE id=$1 AND current_presentation_team_id=$2", [id, team.id]);
        await client.query("DELETE FROM offerings WHERE team_id=$1", [team.id]);
      }
      await audit(client, id, actorId, "SHORTLIST_CHANGED", team.id, null, { selected });
      return { ok: true };
    }
    if (action === "shortlistBatch") {
      if (event.trading_started || !["REGISTRATION", "SHORTLISTING", "PRESENTATION"].includes(event.phase)) throw new AppError("Shortlist is locked.", 409);
      const selected: unknown[] = body.teamIds;
      if (!Array.isArray(selected) || new Set(selected).size !== selected.length || selected.some((value) => typeof value !== "string")) throw new AppError("Invalid shortlist.");
      const valid = (await client.query("SELECT id FROM teams WHERE event_id=$1 AND is_participant=true", [id])).rows.map((row) => row.id);
      if (selected.some((team) => !valid.includes(team))) throw new AppError("Shortlisted teams must be participants.");
      const current = (await client.query("SELECT team_id FROM offerings WHERE event_id=$1", [id])).rows.map((row) => row.team_id);
      for (const team of current.filter((team) => !selected.includes(team))) {
        await client.query("UPDATE events SET current_presentation_team_id=NULL WHERE id=$1 AND current_presentation_team_id=$2", [id, team]);
        await client.query("DELETE FROM offerings WHERE team_id=$1", [team]);
      }
      let next = Number((await client.query("SELECT COALESCE(MAX(presentation_order),0)+1 AS n FROM offerings WHERE event_id=$1", [id])).rows[0].n);
      for (const team of selected.filter((team) => !current.includes(team))) {
        await client.query("INSERT INTO offerings(event_id,team_id,initial_quantity,price_minor,presentation_order) VALUES($1,$2,$3,$4,$5)", [id, team, event.stocks_per_team, event.stock_price_minor, next++]);
      }
      await audit(client, id, actorId, "SHORTLIST_CONFIRMED", null, null, { previous: current, next: selected });
      return { ok: true };
    }
    if (action === "order") {
      const order: unknown[] = body.teamIds;
      if (!Array.isArray(order) || new Set(order).size !== order.length) throw new AppError("Invalid presentation order.");
      const existing = (await client.query("SELECT team_id FROM offerings WHERE event_id=$1", [id])).rows.map((r) => r.team_id);
      if (order.length !== existing.length || order.some((team) => !existing.includes(team))) throw new AppError("Include every shortlisted team once.");
      await client.query("UPDATE offerings SET presentation_order=NULL WHERE event_id=$1", [id]);
      for (let index = 0; index < order.length; index++) await client.query("UPDATE offerings SET presentation_order=$1 WHERE team_id=$2", [index + 1, order[index]]);
      await audit(client, id, actorId, "PRESENTATION_ORDER_CHANGED", null, null, { teamIds: order });
      return { ok: true };
    }
    if (action === "phase") {
      const phase = String(body.phase);
      if (!phases.includes(phase as any)) throw new AppError("Invalid phase.");
      if (event.trading_started && ["REGISTRATION", "SHORTLISTING", "PRESENTATION"].includes(phase)) throw new AppError("Cannot return to setup after trading starts.", 409);
      if (["PRESENTATION", "INVESTMENT"].includes(phase)) {
        const count = await client.query("SELECT 1 FROM offerings WHERE event_id=$1 LIMIT 1", [id]);
        if (!count.rowCount) throw new AppError("Shortlist at least one team first.", 409);
      }
      await client.query("UPDATE events SET phase=$1,paused=false,updated_at=now() WHERE id=$2", [phase, id]);
      await audit(client, id, actorId, "PHASE_CHANGED", null, null, { previous: event.phase, next: phase });
      return { ok: true };
    }
    if (action === "pause") {
      if (event.phase !== "INVESTMENT") throw new AppError("Pause is available during investment only.");
      await client.query("UPDATE events SET paused=$1,updated_at=now() WHERE id=$2", [body.paused === true, id]);
      await audit(client, id, actorId, "MARKET_PAUSE_CHANGED", null, null, { previous: event.paused, next: body.paused === true });
      return { ok: true };
    }
    if (action === "presentation") {
      if (event.phase !== "PRESENTATION") throw new AppError("Start the presentation phase first.");
      const teamId = body.teamId || null;
      if (teamId) {
        const offering = await client.query("SELECT 1 FROM offerings WHERE team_id=$1 AND event_id=$2", [teamId, id]);
        if (!offering.rowCount) throw new AppError("Team is not shortlisted.");
      }
      await client.query("UPDATE events SET current_presentation_team_id=$1,updated_at=now() WHERE id=$2", [teamId, id]);
      await audit(client, id, actorId, "PRESENTATION_CHANGED", teamId, null, { previous: event.current_presentation_team_id, next: teamId });
      return { ok: true };
    }
    if (action === "reveal") {
      if (!["CLOSED", "RESULTS"].includes(event.phase)) throw new AppError("Close investment before revealing results.");
      await client.query("UPDATE events SET results_revealed=$1,updated_at=now() WHERE id=$2", [body.revealed === true, id]);
      await audit(client, id, actorId, "RESULTS_VISIBILITY_CHANGED", null, null, { previous: event.results_revealed, next: body.revealed === true });
      return { ok: true };
    }
    if (action === "resetCredential") {
      const user = (await client.query("SELECT u.id,u.email,t.name FROM users u JOIN teams t ON t.id=u.team_id WHERE t.id=$1 AND t.event_id=$2 FOR UPDATE OF u", [body.teamId, id])).rows[0];
      if (!user) throw new AppError("Team leader not found.", 404);
      const password = initialPassword();
      await client.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [await hashPassword(password), user.id]);
      await client.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      await audit(client, id, actorId, "CREDENTIAL_RESET", body.teamId, null);
      return { team: user.name, email: user.email, password };
    }
    if (action === "editTeam") {
      if (event.trading_started) throw new AppError("Team details are locked after trading starts.", 409);
      const team = (await client.query("SELECT id,name,college FROM teams WHERE id=$1 AND event_id=$2 FOR UPDATE", [body.teamId, id])).rows[0];
      if (!team) throw new AppError("Team not found.", 404);
      const name = String(body.name ?? "").trim();
      const college = String(body.college ?? "").trim();
      if (!name || !college || name.length > 120 || college.length > 120) throw new AppError("Enter a valid team name and college.");
      await client.query("UPDATE teams SET name=$1,college=$2,updated_at=now() WHERE id=$3", [name, college, team.id]);
      await audit(client, id, actorId, "TEAM_EDITED", team.id, null, { before: team, after: { name, college } });
      return { ok: true };
    }
    if (action === "editMember") {
      if (event.trading_started) throw new AppError("Team details are locked after trading starts.", 409);
      const member = (await client.query(
        `SELECT m.* FROM team_members m JOIN teams t ON t.id=m.team_id
         WHERE m.id=$1 AND t.event_id=$2 FOR UPDATE OF m`, [body.memberId, id],
      )).rows[0];
      if (!member) throw new AppError("Member not found.", 404);
      const name = String(body.name ?? "").trim();
      const email = String(body.email ?? "").trim().toLowerCase();
      const registration = String(body.registrationNumber ?? "").trim();
      if (!name || !registration || name.length > 120 || registration.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError("Enter valid member details.");
      await client.query("UPDATE team_members SET name=$1,email=$2,registration_number=$3 WHERE id=$4", [name, email, registration, member.id]);
      if (member.slot === 1) await client.query("UPDATE users SET email=$1,updated_at=now() WHERE team_id=$2", [email, member.team_id]);
      await audit(client, id, actorId, "MEMBER_EDITED", member.team_id, null, { before: { name: member.name, email: member.email, registrationNumber: member.registration_number }, after: { name, email, registrationNumber: registration } });
      return { ok: true };
    }
    throw new AppError("Unknown admin action.");
  });
}
