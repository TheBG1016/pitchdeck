"use client";
import { useEffect, useRef, useState } from "react";
import { dateTime, money } from "@/lib/format";

type Team = { id: string; name: string; college: string; is_participant: boolean };
type Member = { slot: number; name: string; registration_number: string };
type Offering = { id: string; team_id: string; name: string; college: string; price_minor: number; initial_quantity: number; sold_quantity: number; received_minor: number; presentation_order: number };
type Market = { event: any; offerings: Offering[]; wallet: { starting_minor: number; available_minor: number } | null; portfolio: { offering_id: string; team_name: string; quantity: number; invested_minor: number }[] };

export default function TeamDashboard({ team, members }: { team: Team; members: Member[] }) {
  const [market, setMarket] = useState<Market | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [pending, setPending] = useState<string | null>(null);
  const requestKeys = useRef<Record<string, string>>({});

  async function refresh() {
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not refresh market data.");
      const data = await response.json();
      setMarket(data.market); setLeaderboard(data.leaderboard); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh market data."); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 8000); return () => clearInterval(timer); }, []);

  async function buy(offering: Offering) {
    const quantity = Number(quantities[offering.id] ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1) { setError("Choose at least one stock."); return; }
    if (!window.confirm(`Buy ${quantity} stock${quantity === 1 ? "" : "s"} in ${offering.name} for ${money(quantity * offering.price_minor, market?.event.currency_code)}?`)) return;
    setPending(offering.id); setError(""); setNotice("");
    const key = `${offering.id}:${quantity}`;
    requestKeys.current[key] ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/purchases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ offeringId: offering.id, quantity, idempotencyKey: requestKeys.current[key] }) });
      const data = await response.json();
      if (!response.ok) { delete requestKeys.current[key]; throw new Error(data.error ?? "Purchase failed."); }
      delete requestKeys.current[key];
      setNotice(data.repeated ? "This purchase was already recorded." : `Purchase complete: ${quantity} stock${quantity === 1 ? "" : "s"} in ${offering.name}.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Purchase failed."); }
    finally { setPending(null); }
  }

  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }
  const event = market?.event;
  const wallet = market?.wallet;
  const spent = wallet ? wallet.starting_minor - wallet.available_minor : 0;
  const now = Date.now();
  const marketOpen = event?.phase === "INVESTMENT" && !event?.paused && (!event.investment_starts_at || now >= new Date(event.investment_starts_at).getTime()) && (!event.investment_ends_at || now < new Date(event.investment_ends_at).getTime());
  const presenting = market?.offerings.find((offering) => offering.team_id === event?.current_presentation_team_id);

  return <div className="app-shell team-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">◆</span><span>INVESTMENT POOL <small>EVALUATION ROUND</small></span></div><div className="top-actions"><span className="role-pill">TEAM LEADER</span><button className="text-button" onClick={signOut}>Sign out ↗</button></div></header>
    <main className="page-content">
      <div className="page-heading"><div><div className="eyebrow">YOUR TEAM DASHBOARD</div><h1>Make your next move.</h1><p>Welcome, {members[0]?.name}. Watch the market and invest with confidence.</p></div><div className={`phase-pill ${marketOpen ? "live" : ""}`}><span className="status-dot" />{event?.paused ? "INVESTMENT PAUSED" : marketOpen ? "MARKET OPEN" : event?.phase ?? "LOADING"}</div></div>
      {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
      {event?.phase === "PRESENTATION" && <div className="presentation-banner"><span>ON STAGE NOW</span><strong>{presenting?.name ?? "Waiting for the next team"}</strong><p>{presenting ? `${presenting.college} is presenting. Review their profile before investment opens.` : "The administrator will announce the next presentation."}</p></div>}
      <section className="stats-grid three"><div className="stat-card"><span>AVAILABLE BALANCE</span><strong>{wallet ? money(wallet.available_minor, event?.currency_code) : "—"}</strong><small>Ready to invest</small></div><div className="stat-card"><span>TOTAL INVESTED</span><strong>{wallet ? money(spent, event?.currency_code) : "—"}</strong><small>Across your portfolio</small></div><div className="stat-card"><span>STARTING BALANCE</span><strong>{wallet ? money(wallet.starting_minor, event?.currency_code) : "—"}</strong><small>Allocated for this round</small></div></section>
      {!team.is_participant && <div className="notice">Your team has not been selected as a participant. You can still follow the presentations.</div>}
      <div className="section-heading"><div><div className="eyebrow">INVESTMENT MARKET</div><h2>Teams worth watching</h2></div><span className="muted">Updates every 8 seconds</span></div>
      <div className="market-grid">{market?.offerings.map((offering) => {
        const remaining = offering.initial_quantity - offering.sold_quantity;
        const isOwn = offering.team_id === team.id;
        const canBuy = marketOpen && team.is_participant && !isOwn && remaining > 0;
        const quantity = quantities[offering.id] ?? 1;
        return <article className="market-card" key={offering.id}>
          <div className="market-card-top"><span className="company-icon">{offering.name.slice(0, 1).toUpperCase()}</span><span className={`stock-tag ${remaining ? "available" : "sold"}`}>{remaining ? `${remaining} AVAILABLE` : "SOLD OUT"}</span></div>
          <h3>{offering.name}</h3><p>{offering.college}</p>
          {isOwn && <span className="own-tag">YOUR TEAM</span>}
          <div className="market-numbers"><div><span>STOCK PRICE</span><strong>{money(offering.price_minor, event?.currency_code)}</strong></div><div><span>RECEIVED</span><strong>{money(offering.received_minor, event?.currency_code)}</strong></div></div>
          <div className="stock-track"><span style={{ width: `${100 * offering.sold_quantity / offering.initial_quantity}%` }} /></div>
          <div className="market-foot"><span>{offering.sold_quantity} sold</span><span>{remaining} remaining</span></div>
          <div className="buy-row"><input aria-label={`Stocks to buy in ${offering.name}`} type="number" min="1" max={Math.max(1, remaining)} value={quantity} onChange={(e) => setQuantities((value) => ({ ...value, [offering.id]: Number(e.target.value) }))} disabled={!canBuy || pending === offering.id} /><button className="button primary" disabled={!canBuy || pending === offering.id} onClick={() => void buy(offering)}>{pending === offering.id ? "Buying…" : isOwn ? "Your stock" : !marketOpen ? "Unavailable" : remaining ? "Buy stock →" : "Sold out"}</button></div>
        </article>;
      })}</div>
      {!market?.offerings.length && <div className="empty-state">No investable teams have been shortlisted yet.</div>}
      <div className="lower-grid"><section className="panel"><div className="section-heading compact"><div><div className="eyebrow">PORTFOLIO</div><h2>Your investments</h2></div></div>
        {market?.portfolio.length ? <div className="portfolio-list">{market.portfolio.map((item) => <div key={item.offering_id}><strong>{item.team_name}</strong><span>{item.quantity} stocks</span><b>{money(item.invested_minor, event?.currency_code)}</b></div>)}</div> : <p className="muted">No investments yet. Your portfolio will appear here.</p>}
      </section><section className="panel"><div className="eyebrow">MY TEAM</div><h2>{team.name}</h2><p className="muted">{team.college}</p><div className="member-list">{members.map((member) => <div key={member.slot}><span>{member.slot === 1 ? "LEADER" : `MEMBER ${member.slot}`}</span><strong>{member.name}</strong><small>{member.registration_number}</small></div>)}</div></section></div>
      {leaderboard && <section className="panel results-panel"><div className="eyebrow">FINAL RESULTS</div><h2>Leaderboard</h2><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Investment received</th><th>Stocks sold</th></tr></thead><tbody>{leaderboard.map((row) => <tr key={row.id}><td>#{row.rank}</td><td>{row.name}</td><td>{money(row.received_minor, event?.currency_code)}</td><td>{row.sold_quantity}</td></tr>)}</tbody></table></div></section>}
      <footer className="footer-note">Investment window: {dateTime(event?.investment_starts_at)} – {dateTime(event?.investment_ends_at)} · Virtual currency only</footer>
    </main>
  </div>;
}
