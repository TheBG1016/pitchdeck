"use client";
import { useState } from "react";

export default function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not sign in.");
      window.location.assign(data.role === "ADMIN" ? "/admin" : "/team");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign in."); setPending(false); }
  }
  return <form onSubmit={submit} className="form-stack">
    <label>Email or leader registration number<input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required /></label>
    <label>Password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
    {error && <div role="alert" className="notice error">{error}</div>}
    <button className="button primary wide" disabled={pending}>{pending ? "Signing in…" : "Sign in"} <span>→</span></button>
  </form>;
}
