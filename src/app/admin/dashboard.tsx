"use client";
import { useEffect, useMemo, useState } from "react";
import { dateTime, money } from "@/lib/format";

type Tab = "overview" | "teams" | "import" | "presentations" | "transactions" | "results" | "audit";
type Team = { id: string; name: string; college: string; is_participant: boolean; leader_name: string; leader_email: string; leader_registration: string; offering_id: string | null; presentation_order: number | null; available_minor: number | null };
type State = { event: any; teams: Team[]; members: any[]; purchases: any[]; audits: any[]; leaderboard: any[]; stats: { activeTransactions: number; allTransactions: number; circulatedMinor: number; mostActiveInvestor: string | null; mostActiveInvestedMinor: number } };

function toIstInput(value: string | null): string { return value ? new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 16) : ""; }
function fromIstInput(value: string): string | null { return value ? new Date(`${value}+05:30`).toISOString() : null; }

function credentialCsv(credentials: { team: string; email: string; registrationNumber?: string; password: string }[]) {
  const encode = (value: string) => `"${(/^[=+@\-\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const lines = [["team", "leader_email", "leader_registration", "initial_password"], ...credentials.map((c) => [c.team, c.email, c.registrationNumber ?? "", c.password])];
  const blob = new Blob([`\uFEFF${lines.map((line) => line.map(encode).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = "leader-credentials.csv"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AdminDashboard({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [credentials, setCredentials] = useState<any[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/admin/state", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setState(data);
      setShortlist(data.teams.filter((team: Team) => team.offering_id).map((team: Team) => team.id));
      setSettings({ name: data.event.name, currencyCode: data.event.currency_code, startingBalance: data.event.starting_balance_minor / 100, stocksPerTeam: data.event.stocks_per_team, stockPrice: data.event.stock_price_minor / 100, investmentStartsAt: toIstInput(data.event.investment_starts_at), investmentEndsAt: toIstInput(data.event.investment_ends_at) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the dashboard."); }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!["transactions", "results", "audit"].includes(tab)) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [tab]);

  async function post(body: any, success = "Saved.") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Action failed.");
      setNotice(success); await load(); return data;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed."); return null; }
    finally { setBusy(false); }
  }

  async function previewCsv() {
    if (!file) return setError("Choose a CSV file.");
    setBusy(true); setError(""); setPreview(null); setCredentials([]);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/admin/import/preview", { method: "POST", body: form });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPreview(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not preview CSV."); }
    finally { setBusy(false); }
  }
  async function confirmCsv() {
    if (!preview || !window.confirm(`Import ${preview.count} teams? New leader passwords will be shown once.`)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draftId: preview.draftId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPreview(null); setCredentials(data.credentials); setNotice(`Imported ${data.created} new teams and updated ${data.updated}. Download new credentials now.`); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Import failed."); }
    finally { setBusy(false); }
  }
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.assign("/login"); }

  const event = state?.event;
  const filteredTeams = useMemo(() => state?.teams.filter((team) => `${team.name} ${team.college} ${team.leader_name} ${team.leader_registration}`.toLowerCase().includes(search.toLowerCase())) ?? [], [state, search]);
  const selected = state?.teams.find((team) => team.id === selectedTeam);
  const members = state?.members.filter((member) => member.team_id === selectedTeam) ?? [];
  const totalInvestment = state?.leaderboard.reduce((sum, team) => sum + team.received_minor, 0) ?? 0;
  const order = state?.teams.filter((team) => team.offering_id).sort((a, b) => (a.presentation_order ?? 0) - (b.presentation_order ?? 0)) ?? [];
  const tabs: { id: Tab; label: string; icon: string }[] = [{ id: "overview", label: "Overview", icon: "◫" }, { id: "teams", label: "Teams & shortlist", icon: "◈" }, { id: "import", label: "Import teams", icon: "↥" }, { id: "presentations", label: "Presentations", icon: "▷" }, { id: "transactions", label: "Transactions", icon: "⇄" }, { id: "results", label: "Results", icon: "♛" }, { id: "audit", label: "Audit log", icon: "≡" }];

  return <div className="admin-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">◆</span><span>INVESTMENT POOL <small>ADMIN CONSOLE</small></span></div><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav><div className="sidebar-footer"><span>Signed in as</span><strong>{email}</strong><button className="text-button" onClick={signOut}>Sign out ↗</button></div></aside>
    <main className="admin-main"><div className="mobile-nav"><div className="brand"><span className="brand-mark">◆</span> INVESTMENT POOL</div><select value={tab} onChange={(e) => setTab(e.target.value as Tab)}>{tabs.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
      <div className="admin-top"><div><div className="eyebrow">EVENT OPERATIONS</div><h1>{tabs.find((item) => item.id === tab)?.label}</h1></div><div className="phase-pill"><span className="status-dot" />{event?.paused ? "PAUSED" : event?.phase ?? "LOADING"}</div></div>
      {error && <div className="notice error" role="alert">{error}</div>}{notice && <div className="notice success" role="status">{notice}</div>}
      {!state ? <div className="empty-state">Loading event data…</div> : <>
      {tab === "overview" && <><div className="stats-grid four"><div className="stat-card"><span>REGISTERED TEAMS</span><strong>{state.teams.length}</strong><small>{state.teams.filter((team) => team.is_participant).length} participants</small></div><div className="stat-card"><span>SHORTLISTED</span><strong>{order.length}</strong><small>Investable teams</small></div><div className="stat-card"><span>TOTAL INVESTED</span><strong>{money(totalInvestment, event.currency_code)}</strong><small>Net of reversals</small></div><div className="stat-card"><span>TRANSACTIONS</span><strong>{state.stats.activeTransactions}</strong><small>Committed purchases</small></div></div>
        <div className="admin-grid"><section className="panel"><div className="eyebrow">RUN THE ROUND</div><h2>Event phase</h2><p className="muted">Move through the event. Trading is allowed only during the investment phase and within its configured window.</p><div className="phase-steps">{["REGISTRATION", "SHORTLISTING", "PRESENTATION", "INVESTMENT", "CLOSED", "RESULTS"].map((phase) => <button key={phase} disabled={busy || event.phase === phase} className={event.phase === phase ? "current" : ""} onClick={() => window.confirm(`Set event phase to ${phase}?`) && void post({ action: "phase", phase }, `Phase changed to ${phase}.`)}>{phase}</button>)}</div>{event.phase === "INVESTMENT" && <button className="button secondary" disabled={busy} onClick={() => void post({ action: "pause", paused: !event.paused }, event.paused ? "Market resumed." : "Market paused.")}>{event.paused ? "Resume investment" : "Pause investment"}</button>}
        </section><section className="panel"><div className="eyebrow">EVENT SETTINGS</div><h2>Market rules</h2><div className="settings-grid"><label>Event name<input value={settings?.name ?? ""} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></label><label>Currency code<input value={settings?.currencyCode ?? ""} maxLength={3} onChange={(e) => setSettings({ ...settings, currencyCode: e.target.value })} /></label><label>Starting balance ({event.currency_code})<input type="number" step="0.01" value={settings?.startingBalance ?? ""} onChange={(e) => setSettings({ ...settings, startingBalance: e.target.value })} /></label><label>Stocks per shortlisted team<input type="number" value={settings?.stocksPerTeam ?? ""} onChange={(e) => setSettings({ ...settings, stocksPerTeam: e.target.value })} /></label><label>Stock price ({event.currency_code})<input type="number" step="0.01" value={settings?.stockPrice ?? ""} onChange={(e) => setSettings({ ...settings, stockPrice: e.target.value })} /></label><label>Investment starts<input type="datetime-local" value={settings?.investmentStartsAt ?? ""} onChange={(e) => setSettings({ ...settings, investmentStartsAt: e.target.value })} /></label><label>Investment ends<input type="datetime-local" value={settings?.investmentEndsAt ?? ""} onChange={(e) => setSettings({ ...settings, investmentEndsAt: e.target.value })} /></label></div><button className="button primary" disabled={busy || event.trading_started} onClick={() => void post({ action: "saveSettings", ...settings, startingBalanceMinor: Math.round(Number(settings.startingBalance) * 100), stockPriceMinor: Math.round(Number(settings.stockPrice) * 100), investmentStartsAt: settings.investmentStartsAt ? fromIstInput(settings.investmentStartsAt) : null, investmentEndsAt: settings.investmentEndsAt ? fromIstInput(settings.investmentEndsAt) : null })}>Save settings</button>{event.trading_started && <p className="muted">Economic settings are locked because trading has started.</p>}{event.trading_started && <button className="text-button" onClick={() => { const value = window.prompt("New closing time (YYYY-MM-DDTHH:MM)"); if (value) void post({ action: "extendWindow", investmentEndsAt: fromIstInput(value) }, "Closing time extended."); }}>Extend closing time</button>}</section></div>
        <section className="panel"><div className="eyebrow">CURRENT STANDINGS</div><h2>Leaderboard preview</h2><Leaderboard rows={state.leaderboard} currency={event.currency_code} /></section></>}
      {tab === "teams" && <><div className="panel"><div className="section-heading compact"><div><div className="eyebrow">TEAM DIRECTORY</div><h2>Participants & shortlist</h2></div><div className="selection-count">{shortlist.length} selected</div></div><p className="muted">Select participants first, then check the teams that should issue stock. Confirm the shortlist when ready.</p><input className="search-input" placeholder="Search teams, colleges, leaders, registrations…" value={search} onChange={(e) => setSearch(e.target.value)} /><div className="table-wrap"><table><thead><tr><th>Team</th><th>Leader</th><th>Participant</th><th>Shortlist</th><th></th></tr></thead><tbody>{filteredTeams.map((team) => <tr key={team.id}><td><strong>{team.name}</strong><small>{team.college}</small></td><td>{team.leader_name}<small>{team.leader_registration}</small></td><td><input type="checkbox" checked={team.is_participant} disabled={busy || event.trading_started} onChange={(e) => { if (window.confirm(`${e.target.checked ? "Add" : "Remove"} ${team.name} ${e.target.checked ? "as a participant" : "from participants"}?`)) void post({ action: "participant", teamId: team.id, selected: e.target.checked }); }} /></td><td><input type="checkbox" checked={shortlist.includes(team.id)} disabled={!team.is_participant || busy || event.trading_started} onChange={(e) => setShortlist((list) => e.target.checked ? [...list, team.id] : list.filter((id) => id !== team.id))} /></td><td><button className="text-button" onClick={() => setSelectedTeam(team.id)}>Details →</button></td></tr>)}</tbody></table></div><div className="panel-actions"><button className="button primary" disabled={busy || event.trading_started} onClick={() => window.confirm(`Confirm ${shortlist.length} shortlisted teams?`) && void post({ action: "shortlistBatch", teamIds: shortlist }, "Shortlist confirmed.")}>Confirm shortlist</button></div></div>
        {selected && <section className="panel detail-panel"><div className="section-heading compact"><h2>{selected.name}</h2><button className="text-button" onClick={() => setSelectedTeam(null)}>Close ×</button></div><p>{selected.college} · {selected.leader_email}</p><div className="member-list">{members.map((m) => <div key={m.id}><span>{m.slot === 1 ? "LEADER" : `MEMBER ${m.slot}`}</span><strong>{m.name}</strong><small>{m.email} · {m.registration_number}</small><button className="text-button" disabled={busy || event.trading_started} onClick={() => { const name = window.prompt("Member name", m.name); if (name === null) return; const email = window.prompt("Member email", m.email); if (email === null) return; const registrationNumber = window.prompt("Registration number", m.registration_number); if (registrationNumber !== null) void post({ action: "editMember", memberId: m.id, name, email, registrationNumber }); }}>Edit</button></div>)}</div><div className="panel-actions"><button className="button secondary" disabled={busy || event.trading_started} onClick={() => { const name = window.prompt("Team name", selected.name); if (name === null) return; const college = window.prompt("College", selected.college); if (college !== null) void post({ action: "editTeam", teamId: selected.id, name, college }); }}>Edit team</button><button className="button secondary" disabled={busy} onClick={async () => { if (!window.confirm(`Reset ${selected.leader_name}'s password? Their sessions will end.`)) return; const result = await post({ action: "resetCredential", teamId: selected.id }, "Password reset. Download the new credential now."); if (result) setCredentials([{ team: result.team, email: result.email, password: result.password }]); }}>Reset leader password</button></div></section>}
        {!!credentials.length && <CredentialPanel credentials={credentials} clear={() => setCredentials([])} />}</>}
      {tab === "import" && <><section className="panel import-panel"><div className="eyebrow">STEP 01 / 03</div><h2>Upload registered teams</h2><p className="muted">Download the template, fill one row per team, and upload the CSV. Empty member 2–4 fields are accepted.</p><a className="button secondary" href="/api/admin/import/template">Download CSV template ↓</a><label className="file-drop">Choose CSV file<input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /><small>{file?.name ?? "No file selected"}</small></label><button className="button primary" disabled={!file || busy} onClick={() => void previewCsv()}>{busy ? "Validating…" : "Validate & preview"}</button></section>
        {preview && <section className="panel"><div className="eyebrow">STEP 02 / 03</div><h2>Review {preview.count} teams</h2><p className="muted">{preview.preview.filter((row: any) => row.action === "CREATE").length} new · {preview.preview.filter((row: any) => row.action === "UPDATE").length} existing teams. Existing credentials are retained.</p><div className="table-wrap"><table><thead><tr><th>Action</th><th>Team</th><th>Leader</th><th>Members</th></tr></thead><tbody>{preview.preview.map((row: any, index: number) => <tr key={index}><td><span className="stock-tag available">{row.action}</span></td><td>{row.name}<small>{row.college}</small></td><td>{row.members[0]?.name}<small>{row.members[0]?.email}</small></td><td>{row.members.length}</td></tr>)}</tbody></table></div><div className="panel-actions"><button className="button primary" disabled={busy} onClick={() => void confirmCsv()}>Confirm import →</button></div></section>}
        {!!credentials.length && <CredentialPanel credentials={credentials} clear={() => setCredentials([])} />}</>}
      {tab === "presentations" && <><section className="panel"><div className="eyebrow">PRESENTATION SEQUENCE</div><h2>On stage</h2><p className="muted">Change the order before or during presentations. Choose the current team to highlight on leader dashboards.</p><div className="presentation-list">{order.map((team, index) => <div key={team.id} className={event.current_presentation_team_id === team.id ? "presenting" : ""}><span className="order-number">{index + 1}</span><div><strong>{team.name}</strong><small>{team.college}</small></div><div className="row-actions"><button className="small-button" disabled={index === 0 || busy} onClick={() => { const ids = order.map((t) => t.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; void post({ action: "order", teamIds: ids }, "Presentation order updated."); }}>↑</button><button className="small-button" disabled={index === order.length - 1 || busy} onClick={() => { const ids = order.map((t) => t.id); [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; void post({ action: "order", teamIds: ids }, "Presentation order updated."); }}>↓</button><button className="button secondary" disabled={event.phase !== "PRESENTATION" || busy} onClick={() => void post({ action: "presentation", teamId: team.id }, `${team.name} is now presenting.`)}>{event.current_presentation_team_id === team.id ? "On stage" : "Present now"}</button></div></div>)}</div>{event.phase === "PRESENTATION" && <button className="text-button" onClick={() => void post({ action: "presentation", teamId: null }, "Presentation cleared.")}>Clear current presentation</button>}</section></>}
      {tab === "transactions" && <section className="panel"><div className="section-heading compact"><div><div className="eyebrow">PERMANENT HISTORY</div><h2>Investments</h2></div><a className="button secondary" href="/api/admin/export/transactions">Export CSV ↓</a></div><div className="table-wrap"><table><thead><tr><th>Time</th><th>Buyer → Target</th><th>Quantity</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>{state.purchases.map((purchase) => <tr key={purchase.id}><td>{dateTime(purchase.created_at)}</td><td>{purchase.buyer_name} → {purchase.target_name}</td><td>{purchase.quantity}</td><td>{money(purchase.total_minor, event.currency_code)}</td><td>{purchase.reversal_id ? "REVERSED" : "COMMITTED"}</td><td>{!purchase.reversal_id && <button className="text-button" disabled={busy} onClick={() => { const reason = window.prompt("Reason for reversal (at least 5 characters)"); if (reason && window.confirm("Reverse this purchase and restore balance and stock?")) void post({ action: "reversePurchase", purchaseId: purchase.id, reason }, "Purchase reversed and audited."); }}>Reverse</button>}</td></tr>)}</tbody></table></div>{!state.purchases.length && <p className="muted">No purchases yet.</p>}</section>}
      {tab === "results" && <><div className="stats-grid four"><div className="stat-card"><span>MARKET INVESTMENT</span><strong>{money(totalInvestment, event.currency_code)}</strong></div><div className="stat-card"><span>TRANSACTIONS</span><strong>{state.stats.activeTransactions}</strong></div><div className="stat-card"><span>UNSOLD STOCKS</span><strong>{state.leaderboard.reduce((sum, row) => sum + row.initial_quantity - row.sold_quantity, 0)}</strong></div><div className="stat-card"><span>TOP TEAM</span><strong className="name-stat">{state.leaderboard[0]?.name ?? "—"}</strong></div></div><section className="panel"><div className="section-heading compact"><div><div className="eyebrow">FINAL STANDINGS</div><h2>Leaderboard</h2></div><a className="button secondary" href="/api/admin/export/results">Export CSV ↓</a></div><Leaderboard rows={state.leaderboard} currency={event.currency_code} /><p className="muted">Most active investor: {state.stats.mostActiveInvestor ?? "—"} · Virtual money circulated: {money(state.stats.circulatedMinor, event.currency_code)} · {state.stats.allTransactions} purchases recorded including reversals</p><div className="panel-actions"><button className="button primary" disabled={busy || !["CLOSED", "RESULTS"].includes(event.phase)} onClick={() => window.confirm(`${event.results_revealed ? "Hide" : "Reveal"} final results for leaders?`) && void post({ action: "reveal", revealed: !event.results_revealed }, event.results_revealed ? "Results hidden." : "Results revealed.")}>{event.results_revealed ? "Hide team results" : "Reveal to teams"}</button><span className="muted">{event.results_revealed ? "Visible to team leaders" : "Admin only"}</span></div></section></>}
      {tab === "audit" && <section className="panel"><div className="eyebrow">ACTIVITY TRAIL</div><h2>Recent admin & market actions</h2><div className="table-wrap"><table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Details</th></tr></thead><tbody>{state.audits.map((entry) => <tr key={entry.id}><td>{dateTime(entry.created_at)}</td><td>{entry.action}</td><td>{entry.actor_email ?? "Team market"}</td><td><code>{JSON.stringify(entry.details)}</code></td></tr>)}</tbody></table></div></section>}
      </>}
      <footer className="footer-note">All values are virtual · Event time zone: Asia/Kolkata · Market data refreshes automatically</footer>
    </main></div>;
}

function Leaderboard({ rows, currency }: { rows: any[]; currency: string }) {
  return <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Investment received</th><th>Stocks sold</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>#{row.rank}</strong></td><td>{row.name}<small>{row.college}</small></td><td>{money(row.received_minor, currency)}</td><td>{row.sold_quantity} / {row.initial_quantity}</td></tr>)}</tbody></table>{!rows.length && <p className="muted">Shortlist teams to see standings.</p>}</div>;
}

function CredentialPanel({ credentials, clear }: { credentials: any[]; clear: () => void }) {
  return <section className="panel credential-panel"><div className="eyebrow">ONE-TIME CREDENTIALS</div><h2>Download before leaving</h2><p>These initial passwords are shown only now. Later access requires a password reset.</p><div className="panel-actions"><button className="button primary" onClick={() => credentialCsv(credentials)}>Download credentials CSV ↓</button><button className="button secondary" onClick={clear}>I have saved them</button></div></section>;
}


