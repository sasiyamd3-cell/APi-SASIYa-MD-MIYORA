// ============================================================
// MIYORA — Public frontend (home, apis, login, dashboard)
// ============================================================
import type { AppProps } from "next/app";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState, createContext, useContext } from "react";
import { GetServerSideProps } from "next";

// ---------- Session context ----------
type Me = { id: string; name: string; email: string; role: "user" | "admin" } | null;
const SessionCtx = createContext<{ me: Me; refresh: () => void }>({ me: null, refresh: () => {} });
export const useSession = () => useContext(SessionCtx);

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me>(null);
  const refresh = () => fetch("/api/auth/me").then(r => r.ok ? r.json() : { user: null }).then(d => setMe(d.user)).catch(() => setMe(null));
  useEffect(() => { refresh(); }, []);
  return <SessionCtx.Provider value={{ me, refresh }}>{children}</SessionCtx.Provider>;
}

// ---------- Layout ----------
function Nav() {
  const { me, refresh } = useSession();
  return (
    <nav className="border-b border-slate-800">
      <div className="max-w-6xl mx-auto flex items-center justify-between p-4">
        <Link href="/" className="text-xl font-bold text-brand">MIYORA</Link>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/apis">APIs</Link>
          {me ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              {me.role === "admin" && <Link href="/admin" className="text-brand">Admin</Link>}
              <button className="btn-ghost" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); refresh(); location.href = "/"; }}>Logout</button>
            </>
          ) : (
            <>
              <Link href="/login">Login</Link>
              <Link className="btn" href="/register">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main className="flex-1 max-w-6xl w-full mx-auto p-6">{children}</main>
      <footer className="border-t border-slate-800 text-slate-500 text-sm text-center py-4">
        © {new Date().getFullYear()} MIYORA
      </footer>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : { user: null }).then(d => {
      if (!d.user) return router.replace("/login");
      setReady(true);
    });
  }, [router]);
  if (!ready) return <div className="p-10 text-slate-400">Checking session…</div>;
  return <>{children}</>;
}

// ---------- ApiCard ----------
export function ApiCard({ api }: { api: any }) {
  return (
    <Link href={`/apis/${api.slug}`} className="card hover:border-brand transition block">
      {api.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={api.thumbnail} alt={api.name} className="w-full h-36 object-cover rounded-lg mb-3" />
      )}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs px-2 py-1 rounded bg-slate-800 text-slate-300">{api.category}</span>
        <span className={`text-xs px-2 py-1 rounded ${api.method === "GET" ? "bg-emerald-900" : "bg-amber-900"}`}>{api.method}</span>
      </div>
      <h3 className="font-semibold text-lg">{api.name}</h3>
      <p className="text-slate-400 text-sm line-clamp-2 mt-1">{api.description}</p>
      <div className="text-xs text-slate-500 mt-3">
        {api.pricing?.price === 0 ? "Free" : `$${api.pricing?.price} / ${api.pricing?.interval}`}
      </div>
    </Link>
  );
}

// ============================================================
// PAGES
// ============================================================

export function HomePage({ apis }: { apis: any[] }) {
  return (
    <div>
      <section className="text-center py-16">
        <h1 className="text-5xl font-extrabold tracking-tight">MIYORA API Marketplace</h1>
        <p className="text-slate-400 mt-4 max-w-xl mx-auto">Discover, subscribe, and integrate production APIs.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href="/apis" className="btn">Browse APIs</Link>
          <Link href="/register" className="btn-ghost">Get an API key</Link>
        </div>
      </section>
      <section>
        <h2 className="text-2xl font-bold mb-4">Featured APIs</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {apis.map(a => <ApiCard key={a._id} api={a} />)}
        </div>
        {apis.length === 0 && <p className="text-slate-500">No APIs published yet.</p>}
      </section>
    </div>
  );
}
export const getHomeProps: GetServerSideProps = async () => {
  const { dbConnect, ApiListing } = await import("./lib");
  await dbConnect();
  const apis = await ApiListing.find({ published: true }).sort({ createdAt: -1 }).limit(9).lean();
  return { props: { apis: JSON.parse(JSON.stringify(apis)) } };
};

export function ApisPage({ apis }: { apis: any[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const cats = Array.from(new Set(apis.map(a => a.category)));
  const filtered = apis.filter(a =>
    (!q || a.name.toLowerCase().includes(q.toLowerCase()) || a.description.toLowerCase().includes(q.toLowerCase())) &&
    (!cat || a.category === cat)
  );
  return (
    <div>
      <h1 className="text-3xl font-bold mb-4">Browse APIs</h1>
      <div className="flex flex-wrap gap-3 mb-6">
        <input className="input max-w-sm" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        <select className="input max-w-xs" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(a => <ApiCard key={a._id} api={a} />)}
      </div>
      {filtered.length === 0 && <p className="text-slate-500">No APIs match your filters.</p>}
    </div>
  );
}
export const getApisProps: GetServerSideProps = async () => {
  const { dbConnect, ApiListing } = await import("./lib");
  await dbConnect();
  const apis = await ApiListing.find({ published: true }).sort({ createdAt: -1 }).lean();
  return { props: { apis: JSON.parse(JSON.stringify(apis)) } };
};

export function ApiDetailPage({ api }: { api: any }) {
  const { me } = useSession();
  const [subscribing, setSubscribing] = useState(false);
  const [msg, setMsg] = useState("");
  if (!api) return <p>Not found.</p>;

  async function subscribe() {
    if (!me) return location.href = "/login";
    setSubscribing(true); setMsg("");
    const r = await fetch("/api/subscriptions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiId: api._id, plan: api.pricing?.plan }),
    });
    const d = await r.json();
    setSubscribing(false);
    if (!r.ok) return setMsg(d.error || "Failed");
    setMsg("Subscribed! Create an API key in your dashboard to start calling.");
  }

  return (
    <div className="space-y-6">
      <header>
        {api.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={api.thumbnail} alt={api.name} className="w-full h-56 object-cover rounded-xl mb-4" />
        )}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs px-2 py-1 rounded bg-slate-800">{api.category}</span>
          <span className="text-xs px-2 py-1 rounded bg-emerald-900">{api.method}</span>
        </div>
        <h1 className="text-3xl font-bold">{api.name}</h1>
        <p className="text-slate-400 mt-2">{api.description}</p>
        {api.docs && <a className="text-brand underline text-sm" href={api.docs} target="_blank" rel="noreferrer">Documentation ↗</a>}
      </header>

      <section className="card">
        <h2 className="font-semibold mb-2">Endpoint</h2>
        <code className="text-sm break-all">{api.method} {api.endpointUrl}</code>
      </section>

      <section className="card">
        <h2 className="font-semibold mb-2">Pricing</h2>
        <p>{api.pricing?.price === 0 ? "Free" : `$${api.pricing?.price} / ${api.pricing?.interval}`} • {api.quotas?.requestsPerMinute} req/min • {api.quotas?.requestsPerMonth} req/mo</p>
        <button onClick={subscribe} disabled={subscribing} className="btn mt-3">
          {subscribing ? "Subscribing…" : "Subscribe"}
        </button>
        {msg && <p className="text-sm text-emerald-400 mt-2">{msg}</p>}
      </section>

      {api.parameters?.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">Parameters</h2>
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr><th>Name</th><th>In</th><th>Type</th><th>Required</th><th>Description</th></tr>
            </thead>
            <tbody>
              {api.parameters.map((p: any, i: number) => (
                <tr key={i} className="border-t border-slate-800">
                  <td>{p.name}</td><td>{p.in}</td><td>{p.type}</td><td>{p.required ? "yes" : "no"}</td><td>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {api.exampleRequest && (
        <section className="card">
          <h2 className="font-semibold mb-2">Example request</h2>
          <pre className="text-xs bg-slate-950 p-3 rounded overflow-auto">{api.exampleRequest}</pre>
        </section>
      )}
      {api.exampleResponse && (
        <section className="card">
          <h2 className="font-semibold mb-2">Example response</h2>
          <pre className="text-xs bg-slate-950 p-3 rounded overflow-auto">{api.exampleResponse}</pre>
        </section>
      )}

      <section className="card">
        <h2 className="font-semibold mb-2">Call this API</h2>
        <p className="text-sm text-slate-400 mb-3">Generate an API key from your dashboard, then call:</p>
        <pre className="text-xs bg-slate-950 p-3 rounded overflow-auto">{`POST /api/proxy/${api.slug}
Header: x-api-key: miy_...`}</pre>
      </section>
    </div>
  );
}
export const getApiDetailProps: GetServerSideProps = async (ctx) => {
  const { dbConnect, ApiListing } = await import("./lib");
  await dbConnect();
  const slug = ctx.params!.slug;
  const api = await ApiListing.findOne({ slug, published: true }).select("-headers -ownerId").lean();
  return { props: { api: api ? JSON.parse(JSON.stringify(api)) : null } };
};

export function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error || "Login failed");
    refresh(); router.push("/dashboard");
  }
  return (
    <form onSubmit={submit} className="max-w-md mx-auto card mt-10 space-y-4">
      <h1 className="text-2xl font-bold">Log in</h1>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
      <div><label className="label">Password</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
      <button className="btn w-full" type="submit">Log in</button>
      <p className="text-sm text-slate-400 text-center">Admin? <Link href="/admin/login" className="text-brand underline">Admin login</Link></p>
    </form>
  );
}

export function RegisterPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error || "Registration failed");
    refresh(); router.push("/dashboard");
  }
  return (
    <form onSubmit={submit} className="max-w-md mx-auto card mt-10 space-y-4">
      <h1 className="text-2xl font-bold">Create account</h1>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div><label className="label">Name</label><input className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
      <div><label className="label">Email</label><input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></div>
      <div><label className="label">Password (min 8)</label><input className="input" type="password" minLength={8} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required /></div>
      <button className="btn w-full" type="submit">Sign up</button>
    </form>
  );
}

export function DashboardPage() {
  const [keys, setKeys] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);

  async function load() {
    const [k, s, u] = await Promise.all([
      fetch("/api/keys").then(r => r.json()),
      fetch("/api/subscriptions").then(r => r.json()),
      fetch("/api/usage").then(r => r.json()),
    ]);
    setKeys(k.keys || []); setSubs(s.subscriptions || []); setUsage(u.logs || []);
  }
  useEffect(() => { load(); }, []);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    const r = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name || "Default key" }) });
    const d = await r.json();
    if (r.ok) { setNewKey(d.rawKey); setName(""); load(); }
  }
  async function revoke(id: string) { await fetch(`/api/keys/${id}`, { method: "DELETE" }); load(); }

  return (
    <Protected>
      <div className="space-y-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>

        <section className="card">
          <h2 className="text-xl font-semibold mb-3">API Keys</h2>
          {newKey && (
            <div className="bg-emerald-900/40 border border-emerald-700 rounded-lg p-3 mb-3 text-sm">
              Copy your new key now — it will not be shown again:
              <pre className="mt-2 break-all">{newKey}</pre>
            </div>
          )}
          <form onSubmit={createKey} className="flex gap-2 mb-4">
            <input className="input" placeholder="Key name" value={name} onChange={e => setName(e.target.value)} />
            <button className="btn" type="submit">Create key</button>
          </form>
          <ul className="divide-y divide-slate-800">
            {keys.map(k => (
              <li key={k._id} className="py-2 flex items-center justify-between">
                <div>
                  <div className="font-medium">{k.name}</div>
                  <div className="text-xs text-slate-400">{k.prefix}••• • {k.revoked ? "revoked" : "active"}</div>
                </div>
                {!k.revoked && <button className="btn-ghost" onClick={() => revoke(k._id)}>Revoke</button>}
              </li>
            ))}
            {keys.length === 0 && <li className="text-slate-500 text-sm py-2">No keys yet.</li>}
          </ul>
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold mb-3">Subscriptions</h2>
          <ul className="divide-y divide-slate-800 text-sm">
            {subs.map(s => (
              <li key={s._id} className="py-2 flex items-center justify-between">
                <div>{s.api?.name || s.apiId} — {s.plan}</div>
                <span className="text-xs text-slate-400">{s.status}</span>
              </li>
            ))}
            {subs.length === 0 && <li className="text-slate-500 py-2">No subscriptions.</li>}
          </ul>
        </section>

        <section className="card">
          <h2 className="text-xl font-semibold mb-3">Recent usage</h2>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left"><tr><th>Time</th><th>API</th><th>Method</th><th>Status</th><th>Latency</th></tr></thead>
              <tbody>
                {usage.map(u => (
                  <tr key={u._id} className="border-t border-slate-800">
                    <td>{new Date(u.createdAt).toLocaleString()}</td>
                    <td>{u.api?.name || u.apiId}</td>
                    <td>{u.method}</td><td>{u.statusCode}</td><td>{u.latencyMs}ms</td>
                  </tr>
                ))}
                {usage.length === 0 && <tr><td colSpan={5} className="text-slate-500 py-2">No usage yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Protected>
  );
}

// ---------- Custom App ----------
export default function App({ Component, pageProps }: AppProps) {
  return (
    <SessionProvider>
      <Head><title>MIYORA — API Marketplace</title></Head>
      <Layout><Component {...pageProps} /></Layout>
    </SessionProvider>
  );
}