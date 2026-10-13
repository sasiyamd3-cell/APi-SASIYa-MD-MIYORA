// ============================================================
// MIYORA — ADMIN panel (completely separate from public site)
// ============================================================
import { useRouter } from "next/router";
import Link from "next/link";
import { useEffect, useState } from "react";

// ---------- Admin Auth Guard ----------
function AdminProtected({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : { user: null }).then(d => {
      if (!d.user || d.user.role !== "admin") return router.replace("/admin/login");
      setReady(true);
    });
  }, [router]);
  if (!ready) return <div className="p-10 text-slate-400">Checking admin session…</div>;
  return <>{children}</>;
}

// ---------- Admin Layout ----------
function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  }
  const links = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/apis", label: "API Listings" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/usage", label: "Usage Logs" },
    { href: "/admin/subscriptions", label: "Subscriptions" },
  ];
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="border-b border-amber-900/40 bg-slate-950">
        <div className="max-w-7xl mx-auto flex items-center justify-between p-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="text-xl font-bold text-amber-400">MIYORA ADMIN</Link>
            <div className="hidden md:flex items-center gap-4 text-sm">
              {links.map(l => (
                <Link key={l.href} href={l.href} className={`hover:text-amber-400 ${router.pathname === l.href ? "text-amber-400" : "text-slate-300"}`}>
                  {l.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="text-slate-400 hover:text-white">← Public site</Link>
            <button className="btn-ghost" onClick={logout}>Logout</button>
          </div>
        </div>
      </nav>
      <main className="flex-1 max-w-7xl w-full mx-auto p-6">{children}</main>
      <footer className="border-t border-slate-800 text-slate-500 text-xs text-center py-3">
        MIYORA Admin Console
      </footer>
    </div>
  );
}

// ============================================================
// ADMIN PAGES
// ============================================================

// ---- Admin Login ----
export function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error || "Login failed");
    router.push("/admin");
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="max-w-md w-full card space-y-4 border-amber-900/40">
        <h1 className="text-2xl font-bold text-amber-400">🔒 Admin Login</h1>
        <p className="text-xs text-slate-500">Restricted area. Authorized personnel only.</p>
        {err && <p className="text-red-400 text-sm">{err}</p>}
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <button className="btn w-full" type="submit">Sign in to Admin</button>
        <p className="text-xs text-slate-500 text-center">
          Default: <code>admin@miyora.dev</code> / <code>Admin@12345</code>
        </p>
      </form>
    </div>
  );
}

// ---- Admin Dashboard (stats) ----
export function AdminDashboardPage() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    fetch("/api/admin/stats").then(r => r.json()).then(setStats).catch(() => {});
  }, []);
  if (!stats) return <AdminProtected><AdminLayout><p className="text-slate-400">Loading stats…</p></AdminLayout></AdminProtected>;
  const cards = [
    { label: "Total Users", value: stats.users, color: "text-blue-400" },
    { label: "Total APIs", value: stats.apis, color: "text-purple-400" },
    { label: "Published", value: stats.publishedApis, color: "text-emerald-400" },
    { label: "Active Keys", value: stats.keys, color: "text-amber-400" },
    { label: "Active Subs", value: stats.subs, color: "text-pink-400" },
    { label: "Calls (24h)", value: stats.usage24h, color: "text-cyan-400" },
  ];
  return (
    <AdminProtected>
      <AdminLayout>
        <h1 className="text-3xl font-bold mb-6">Dashboard</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {cards.map(c => (
            <div key={c.label} className="card">
              <div className="text-xs text-slate-400">{c.label}</div>
              <div className={`text-3xl font-bold mt-1 ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>

        <section className="card">
          <h2 className="text-xl font-semibold mb-4">Top 5 APIs (by calls)</h2>
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr><th>API</th><th>Slug</th><th>Calls</th></tr>
            </thead>
            <tbody>
              {stats.topApis?.map((t: any) => (
                <tr key={t._id} className="border-t border-slate-800">
                  <td>{t.name || "—"}</td>
                  <td className="text-slate-400">{t.slug || "—"}</td>
                  <td className="text-emerald-400 font-mono">{t.count}</td>
                </tr>
              ))}
              {(!stats.topApis || stats.topApis.length === 0) && (
                <tr><td colSpan={3} className="py-3 text-slate-500">No usage data yet.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </AdminLayout>
    </AdminProtected>
  );
}

// ---- Admin: API Listings List ----
export function AdminApisListPage() {
  const [apis, setApis] = useState<any[]>([]);
  const [q, setQ] = useState("");
  async function load() { const d = await fetch("/api/admin/apis").then(r => r.json()); setApis(d.apis || []); }
  useEffect(() => { load(); }, []);
  async function togglePublish(id: string, published: boolean) {
    await fetch(`/api/admin/apis/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ published: !published }) });
    load();
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    await fetch(`/api/admin/apis/${id}`, { method: "DELETE" });
    load();
  }
  const filtered = apis.filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.slug.includes(q.toLowerCase()));
  return (
    <AdminProtected>
      <AdminLayout>
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">API Listings</h1>
          <Link href="/admin/apis/new" className="btn">+ New API</Link>
        </div>
        <div className="mb-4">
          <input className="input max-w-sm" placeholder="Search by name or slug…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr><th>Name</th><th>Slug</th><th>Category</th><th>Method</th><th>Price</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a._id} className="border-t border-slate-800">
                  <td className="font-medium">{a.name}</td>
                  <td className="text-slate-400 font-mono text-xs">{a.slug}</td>
                  <td>{a.category}</td>
                  <td><span className="text-xs px-2 py-0.5 rounded bg-slate-800">{a.method}</span></td>
                  <td>{a.pricing?.price === 0 ? "Free" : `$${a.pricing?.price}`}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded ${a.published ? "bg-emerald-900 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                      {a.published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="text-right space-x-2 whitespace-nowrap">
                    <Link className="btn-ghost text-xs" href={`/admin/apis/${a._id}`}>Edit</Link>
                    <button className="btn-ghost text-xs" onClick={() => togglePublish(a._id, a.published)}>
                      {a.published ? "Unpublish" : "Publish"}
                    </button>
                    <button className="btn-ghost text-xs text-red-400" onClick={() => remove(a._id, a.name)}>Delete</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={7} className="py-4 text-slate-500">No listings.</td></tr>}
            </tbody>
          </table>
        </div>
      </AdminLayout>
    </AdminProtected>
  );
}

// ---- Admin: API form (shared) ----
const emptyListing = {
  name: "", slug: "", endpointUrl: "", method: "GET", category: "General",
  description: "", docs: "", parameters: [], headers: [],
  exampleRequest: "", exampleResponse: "",
  pricing: { plan: "Free", price: 0, currency: "USD", interval: "monthly" },
  quotas: { requestsPerMinute: 60, requestsPerMonth: 10000 },
  thumbnail: "", published: false,
};

export function AdminApiForm({ initial, id, onSaved }: { initial?: any; id?: string; onSaved: () => void }) {
  const [data, setData] = useState<any>(initial || emptyListing);
  const [paramsText, setParamsText] = useState(JSON.stringify(initial?.parameters || [], null, 2));
  const [headersText, setHeadersText] = useState(JSON.stringify(initial?.headers || [], null, 2));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function upd<K extends string>(k: K, v: any) { setData((d: any) => ({ ...d, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setSaving(true);
    try {
      const parameters = JSON.parse(paramsText || "[]");
      const headers = JSON.parse(headersText || "[]");
      const payload = { ...data, parameters, headers };
      const url = id ? `/api/admin/apis/${id}` : "/api/admin/apis";
      const method = id ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || (d.errors || []).join("; ") || "Save failed");
      onSaved();
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {err && <div className="bg-red-900/40 border border-red-700 text-red-300 p-3 rounded-lg text-sm">{err}</div>}

      <section className="card space-y-4">
        <h3 className="font-semibold text-amber-400">Basic Info</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Name *</label><input className="input" value={data.name} onChange={e => upd("name", e.target.value)} required /></div>
          <div><label className="label">Slug * (lowercase, dashes)</label><input className="input font-mono" value={data.slug} onChange={e => upd("slug", e.target.value)} required /></div>
          <div><label className="label">Endpoint URL *</label><input className="input font-mono" value={data.endpointUrl} onChange={e => upd("endpointUrl", e.target.value)} placeholder="https://api.example.com/v1/endpoint" required /></div>
          <div>
            <label className="label">HTTP Method *</label>
            <select className="input" value={data.method} onChange={e => upd("method", e.target.value)}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div><label className="label">Category *</label><input className="input" value={data.category} onChange={e => upd("category", e.target.value)} /></div>
          <div><label className="label">Docs URL</label><input className="input" value={data.docs} onChange={e => upd("docs", e.target.value)} placeholder="https://docs.example.com" /></div>
          <div className="md:col-span-2"><label className="label">Description * (min 10 chars)</label><textarea className="input h-24" value={data.description} onChange={e => upd("description", e.target.value)} /></div>
          <div><label className="label">Thumbnail URL</label><input className="input" value={data.thumbnail} onChange={e => upd("thumbnail", e.target.value)} placeholder="https://..." /></div>
          <div className="flex items-center gap-3 mt-6">
            <input id="pub" type="checkbox" className="w-4 h-4" checked={data.published} onChange={e => upd("published", e.target.checked)} />
            <label htmlFor="pub" className="text-sm">Publish immediately (visible on public site)</label>
          </div>
        </div>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-amber-400">Pricing</h3>
        <div className="grid md:grid-cols-4 gap-3">
          <div><label className="label">Plan name</label><input className="input" value={data.pricing.plan} onChange={e => upd("pricing", { ...data.pricing, plan: e.target.value })} /></div>
          <div><label className="label">Price</label><input type="number" min="0" className="input" value={data.pricing.price} onChange={e => upd("pricing", { ...data.pricing, price: Number(e.target.value) })} /></div>
          <div><label className="label">Currency</label><input className="input" value={data.pricing.currency} onChange={e => upd("pricing", { ...data.pricing, currency: e.target.value })} /></div>
          <div>
            <label className="label">Interval</label>
            <select className="input" value={data.pricing.interval} onChange={e => upd("pricing", { ...data.pricing, interval: e.target.value })}>
              {["monthly", "yearly", "one-time"].map(i => <option key={i}>{i}</option>)}
            </select>
          </div>
        </div>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-amber-400">Quotas</h3>
        <div className="grid md:grid-cols-2 gap-3">
          <div><label className="label">Requests / minute</label><input type="number" min="1" className="input" value={data.quotas.requestsPerMinute} onChange={e => upd("quotas", { ...data.quotas, requestsPerMinute: Number(e.target.value) })} /></div>
          <div><label className="label">Requests / month</label><input type="number" min="1" className="input" value={data.quotas.requestsPerMonth} onChange={e => upd("quotas", { ...data.quotas, requestsPerMonth: Number(e.target.value) })} /></div>
        </div>
      </section>

      <section className="card space-y-2">
        <h3 className="font-semibold text-amber-400">Parameters (JSON array)</h3>
        <p className="text-xs text-slate-500">Example: <code>{`[{"name":"city","in":"query","type":"string","required":true,"description":"City name"}]`}</code></p>
        <textarea className="input h-40 font-mono text-xs" value={paramsText} onChange={e => setParamsText(e.target.value)} />
      </section>

      <section className="card space-y-2">
        <h3 className="font-semibold text-amber-400">Required headers (JSON array)</h3>
        <p className="text-xs text-slate-500">Headers forwarded to the upstream API. <strong>Do NOT store secrets here</strong> — they will be visible.</p>
        <textarea className="input h-32 font-mono text-xs" value={headersText} onChange={e => setHeadersText(e.target.value)} />
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="card"><label className="label">Example request</label><textarea className="input h-40 font-mono text-xs" value={data.exampleRequest} onChange={e => upd("exampleRequest", e.target.value)} /></div>
        <div className="card"><label className="label">Example response</label><textarea className="input h-40 font-mono text-xs" value={data.exampleResponse} onChange={e => upd("exampleResponse", e.target.value)} /></div>
      </div>

      <div className="flex gap-3">
        <button className="btn" type="submit" disabled={saving}>{saving ? "Saving…" : "Save listing"}</button>
        <Link href="/admin/apis" className="btn-ghost">Cancel</Link>
      </div>
    </form>
  );
}

export function AdminNewApiPage() {
  const router = useRouter();
  return (
    <AdminProtected>
      <AdminLayout>
        <h1 className="text-3xl font-bold mb-6">New API listing</h1>
        <AdminApiForm onSaved={() => router.push("/admin/apis")} />
      </AdminLayout>
    </AdminProtected>
  );
}

export function AdminEditApiPage() {
  const router = useRouter();
  const { id } = router.query;
  const [initial, setInitial] = useState<any>(null);
  useEffect(() => {
    if (!id) return;
    fetch(`/api/admin/apis/${id}`).then(r => r.json()).then(d => setInitial(d.api));
  }, [id]);
  if (!initial) return <AdminProtected><AdminLayout><p className="text-slate-400">Loading…</p></AdminLayout></AdminProtected>;
  return (
    <AdminProtected>
      <AdminLayout>
        <h1 className="text-3xl font-bold mb-6">Edit API listing</h1>
        <AdminApiForm initial={initial} id={id as string} onSaved={() => router.push("/admin/apis")} />
      </AdminLayout>
    </AdminProtected>
  );
}

// ---- Admin: Users ----
export function AdminUsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  async function load() { const d = await fetch("/api/admin/users").then(r => r.json()); setUsers(d.users || []); }
  useEffect(() => { load(); }, []);
  async function setRole(id: string, role: string) {
    await fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ role }) });
    load();
  }
  return (
    <AdminProtected>
      <AdminLayout>
        <h1 className="text-3xl font-bold mb-6">Users</h1>
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u._id} className="border-t border-slate-800">
                  <td>{u.name}</td>
                  <td className="text-slate-400">{u.email}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded ${u.role === "admin" ? "bg-amber-900 text-amber-300" : "bg-slate-800"}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="text-slate-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    {u.role === "user"
                      ? <button className="btn-ghost text-xs" onClick={() => setRole(u._id, "admin")}>Make admin</button>
                      : <button className="btn-ghost text-xs" onClick={() => setRole(u._id, "user")}>Demote</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminLayout>
    </AdminProtected>
  );
}

// ---- Admin: Usage Logs ----
export function AdminUsagePage() {
  const [logs, setLogs] = useState<any[]>([]);
  useEffect(() => { fetch("/api/admin/usage").then(r => r.json()).then(d => setLogs(d.logs || [])); }, []);
  return (
    <AdminProtected>
      <AdminLayout>
        <h1 className="text-3xl font-bold mb-6">Usage Logs (last 200)</h1>
        <div className="card overflow-auto">
          <table className="w-full text-xs">
            <thead className="text-slate-400 text-left">
              <tr><th>Time</th><th>User</th><th>API</th><th>Method</th><th>Status</th><th>Latency</th><th>Error</th></tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <tr key={l._id} className="border-t border-slate-800">
                  <td>{new Date(l.createdAt).toLocaleString()}</td>
                  <td className="text-slate-400">{l.userId?.email || "—"}</td>
                  <td>{l.apiId?.name || "—"}</td>
                  <td><span className="font-mono">{l.method}</span></td>
                  <td className={l.statusCode >= 400 ? "text-red-400" : "text-emerald-400"}>{l.statusCode}</td>
                  <td>{l.latencyMs}ms</td>
                  <td className="text-red-400">{l.error || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminLayout>
    </AdminProtected>
  );
}

// ---- Admin: Subscriptions ----
export function AdminSubsPage() {
  const [subs, setSubs] = useState<any[]>([]);
  useEffect(() => { fetch("/api/admin/subscriptions").then(r => r.json()).then(d => setSubs(d.subscriptions || [])); }, []);
  return (
    <AdminProtected>
      <AdminLayout>
        <h1 className="text-3xl font-bold mb-6">Subscriptions</h1>
        <div className="card overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr><th>User</th><th>API</th><th>Plan</th><th>Status</th><th>Started</th></tr>
            </thead>
            <tbody>
              {subs.map(s => (
                <tr key={s._id} className="border-t border-slate-800">
                  <td className="text-slate-400">{s.userId?.email || "—"}</td>
                  <td>{s.apiId?.name || "—"}</td>
                  <td>{s.plan}</td>
                  <td>
                    <span className={`text-xs px-2 py-0.5 rounded ${s.status === "active" ? "bg-emerald-900 text-emerald-300" : "bg-slate-800"}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="text-slate-500 text-xs">{new Date(s.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminLayout>
    </AdminProtected>
  );
}