import { redirect } from "next/navigation";
import { currentActor } from "@/lib/auth";
import LoginForm from "./login-form";

export default async function LoginPage() {
  const actor = await currentActor();
  if (actor) redirect(actor.role === "ADMIN" ? "/admin" : "/team");
  return <main className="login-page"><div className="login-shell">
    <div className="login-brand"><span className="brand-mark">◆</span><span>INVESTMENT POOL <small>Evaluation Round</small></span></div>
    <div className="login-card"><div className="eyebrow">TEAM MARKET ACCESS</div><h1>Welcome back.</h1><p>Sign in to follow the presentations, invest, and track your team’s position.</p><LoginForm /></div>
    <div className="login-note">A virtual market for your event. All investments are simulated.</div>
  </div></main>;
}
