// ============================================================
// MIYORA — Public API routes (user-facing)
// ============================================================
import type { NextApiRequest, NextApiResponse } from "next";
import {
  dbConnect, User, ApiListing, ApiKey, Subscription, UsageLog,
  signSession, setSessionCookie, clearSessionCookie, getSession, requireUser,
  hashPassword, verifyPassword, generateApiKey, hashApiKey, verifyApiKey, keyPrefix,
  rateLimit, RegisterSchema, LoginSchema, parseBody, forwardRequest,
} from "./lib";

type Handler = (req: NextApiRequest, res: NextApiResponse, parts: string[]) => Promise<any>;
const routes: { method: string; parts: string[]; handler: Handler }[] = [];
function route(method: string, path: string, handler: Handler) {
  routes.push({ method, parts: path.split("/").filter(Boolean), handler });
}

// -------- Auth --------
route("POST", "auth/register", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string) || "anon";
  if (!rateLimit(`reg:${ip}`, 10, 60_000).ok) return res.status(429).json({ error: "Too many attempts" });
  const p = parseBody(RegisterSchema, req.body);
  if (!p.ok) return res.status(400).json({ error: p.errors.join("; ") });
  await dbConnect();
  if (await User.findOne({ email: p.data.email })) return res.status(409).json({ error: "Email already registered" });
  const passwordHash = await hashPassword(p.data.password);
  const user = await User.create({ name: p.data.name, email: p.data.email, passwordHash, role: "user" });
  const token = await signSession({ uid: user._id.toString(), email: user.email, role: "user" });
  setSessionCookie(res, token);
  res.status(201).json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

route("POST", "auth/login", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string) || "anon";
  if (!rateLimit(`login:${ip}`, 10, 60_000).ok) return res.status(429).json({ error: "Too many attempts" });
  const p = parseBody(LoginSchema, req.body);
  if (!p.ok) return res.status(400).json({ error: p.errors.join("; ") });
  await dbConnect();
  const user = await User.findOne({ email: p.data.email });
  if (!user || !(await verifyPassword(p.data.password, user.passwordHash)))
    return res.status(401).json({ error: "Invalid credentials" });
  const token = await signSession({ uid: user._id.toString(), email: user.email, role: user.role as any });
  setSessionCookie(res, token);
  res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
});

route("POST", "auth/logout", async (_req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

route("GET", "auth/me", async (req, res) => {
  const s = await getSession(req); if (!s) return res.status(401).json({ user: null });
  await dbConnect();
  const u = await User.findById(s.uid).select("name email role").lean();
  if (!u) return res.status(401).json({ user: null });
  res.json({ user: { id: u._id, name: u.name, email: u.email, role: u.role } });
});

// -------- Public APIs --------
route("GET", "apis", async (req, res) => {
  await dbConnect();
  const { q, category } = req.query;
  const filter: any = { published: true };
  if (category) filter.category = category;
  if (q) filter.$or = [{ name: new RegExp(String(q), "i") }, { description: new RegExp(String(q), "i") }];
  const apis = await ApiListing.find(filter).select("-headers -ownerId").sort({ createdAt: -1 }).lean();
  res.json({ apis });
});

route("GET", "apis/:id", async (req, res, parts) => {
  await dbConnect();
  const id = parts[1];
  const api = await ApiListing.findOne({
    $or: [{ _id: id.length === 24 ? id : undefined }, { slug: id }],
    published: true,
  }).select("-headers -ownerId").lean();
  if (!api) return res.status(404).json({ error: "Not found" });
  res.json({ api });
});

// -------- API Keys --------
route("GET", "keys", async (req, res) => {
  const s = await requireUser(req, res); if (!s) return;
  await dbConnect();
  const keys = await ApiKey.find({ userId: s.uid }).sort({ createdAt: -1 }).lean();
  res.json({ keys: keys.map(k => ({ _id: k._id, name: k.name, prefix: k.prefix, revoked: k.revoked, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })) });
});

route("POST", "keys", async (req, res) => {
  const s = await requireUser(req, res); if (!s) return;
  if (!rateLimit(`keycreate:${s.uid}`, 10, 60_000).ok) return res.status(429).json({ error: "Too many key creations" });
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : "Default key";
  const raw = generateApiKey();
  const keyHash = await hashApiKey(raw);
  await dbConnect();
  const doc = await ApiKey.create({ userId: s.uid, name, keyHash, prefix: keyPrefix(raw) });
  res.status(201).json({ rawKey: raw, key: { _id: doc._id, name: doc.name, prefix: doc.prefix } });
});

route("DELETE", "keys/:id", async (req, res, parts) => {
  const s = await requireUser(req, res); if (!s) return;
  await dbConnect();
  const key = await ApiKey.findOne({ _id: parts[1], userId: s.uid });
  if (!key) return res.status(404).json({ error: "Not found" });
  key.revoked = true; await key.save();
  res.json({ ok: true });
});

// -------- Subscriptions --------
route("GET", "subscriptions", async (req, res) => {
  const s = await requireUser(req, res); if (!s) return;
  await dbConnect();
  const subs = await Subscription.find({ userId: s.uid }).populate("apiId").lean();
  const shaped = subs.map((sub: any) => ({ ...sub, api: sub.apiId, apiId: sub.apiId?._id }));
  res.json({ subscriptions: shaped });
});

route("POST", "subscriptions", async (req, res) => {
  const s = await requireUser(req, res); if (!s) return;
  if (!rateLimit(`sub:${s.uid}`, 20, 60_000).ok) return res.status(429).json({ error: "Too many requests" });
  const { apiId, plan } = req.body || {};
  if (!apiId) return res.status(400).json({ error: "apiId required" });
  await dbConnect();
  const api = await ApiListing.findById(apiId);
  if (!api || !api.published) return res.status(404).json({ error: "API not found" });
  const existing = await Subscription.findOne({ userId: s.uid, apiId });
  if (existing) {
    if (existing.status === "canceled") { existing.status = "active"; existing.plan = plan || existing.plan; await existing.save(); }
    return res.json({ subscription: existing });
  }
  const sub = await Subscription.create({
    userId: s.uid, apiId, plan: plan || api.pricing?.plan || "Free", status: "active",
    renewsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  res.status(201).json({ subscription: sub });
});

// -------- Usage --------
route("GET", "usage", async (req, res) => {
  const s = await requireUser(req, res); if (!s) return;
  await dbConnect();
  const logs = await UsageLog.find({ userId: s.uid }).sort({ createdAt: -1 }).limit(100).populate("apiId").lean();
  const shaped = logs.map((l: any) => ({ ...l, api: l.apiId, apiId: l.apiId?._id }));
  res.json({ logs: shaped });
});

// -------- Safe proxy: /api/proxy/<slug> --------
route("POST", "proxy/:slug", (req, res, parts) => proxyHandler(req, res, parts));
route("GET", "proxy/:slug", (req, res, parts) => proxyHandler(req, res, parts));
route("PUT", "proxy/:slug", (req, res, parts) => proxyHandler(req, res, parts));
route("PATCH", "proxy/:slug", (req, res, parts) => proxyHandler(req, res, parts));
route("DELETE", "proxy/:slug", (req, res, parts) => proxyHandler(req, res, parts));

async function proxyHandler(req: NextApiRequest, res: NextApiResponse, parts: string[]) {
  const start = Date.now();
  const slug = parts[1];
  const rawKey = (req.headers["x-api-key"] as string) || "";
  if (!rawKey) return res.status(401).json({ error: "Missing x-api-key header" });

  await dbConnect();
  const api = await ApiListing.findOne({ slug, published: true });
  if (!api) return res.status(404).json({ error: "API not found" });

  const candidates = await ApiKey.find({ prefix: rawKey.slice(0, 12), revoked: false }).limit(5);
  let matched: any = null;
  for (const c of candidates) { if (await verifyApiKey(rawKey, c.keyHash)) { matched = c; break; } }
  if (!matched) return res.status(401).json({ error: "Invalid API key" });

  const sub = await Subscription.findOne({ userId: matched.userId, apiId: api._id, status: "active" });
  if (!sub) return res.status(403).json({ error: "No active subscription for this API" });

  const perMin = api.quotas?.requestsPerMinute ?? 60;
  const rl = rateLimit(`rl:${matched._id.toString()}`, perMin, 60_000);
  res.setHeader("X-RateLimit-Limit", perMin);
  res.setHeader("X-RateLimit-Remaining", rl.remaining);
  if (!rl.ok) {
    await UsageLog.create({ userId: matched.userId, apiKeyId: matched._id, apiId: api._id,
      method: req.method, path: `/proxy/${slug}`, statusCode: 429,
      latencyMs: Date.now() - start, error: "rate_limited" });
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthCount = await UsageLog.countDocuments({ apiKeyId: matched._id, createdAt: { $gte: monthStart } });
  const perMonth = api.quotas?.requestsPerMonth ?? 10000;
  if (monthCount >= perMonth) {
    await UsageLog.create({ userId: matched.userId, apiKeyId: matched._id, apiId: api._id,
      method: req.method, path: `/proxy/${slug}`, statusCode: 429,
      latencyMs: Date.now() - start, error: "monthly_quota_exceeded" });
    return res.status(429).json({ error: "Monthly quota exceeded" });
  }

  const forwardHeaders: Record<string, string> = {};
  for (const h of api.headers || []) { if (h.name && h.value) forwardHeaders[h.name] = h.value; }

  try {
    const result = await forwardRequest({
      url: api.endpointUrl, method: api.method, headers: forwardHeaders, body: req.body,
    });
    res.setHeader("content-type", result.headers["content-type"] || "application/json");
    res.status(result.status).send(result.body);
    matched.lastUsedAt = new Date(); await matched.save();
    await UsageLog.create({ userId: matched.userId, apiKeyId: matched._id, apiId: api._id,
      method: api.method, path: `/proxy/${slug}`, statusCode: result.status,
      latencyMs: Date.now() - start, ip: (req.headers["x-forwarded-for"] as string) || "" });
  } catch (e: any) {
    await UsageLog.create({ userId: matched.userId, apiKeyId: matched._id, apiId: api._id,
      method: api.method, path: `/proxy/${slug}`, statusCode: 502,
      latencyMs: Date.now() - start, error: String(e?.message || e) });
    res.status(502).json({ error: "Upstream request failed" });
  }
}

// -------- Dispatcher --------
export async function handleApi(req: NextApiRequest, res: NextApiResponse) {
  const raw = req.query.all;
  const parts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const method = req.method || "GET";

  // Delegate /api/admin/* to admin-api
  if (parts[0] === "admin") {
    const { handleAdminApi } = await import("./admin-api");
    return handleAdminApi(req, res, parts.slice(1));
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    if (r.parts.length !== parts.length) continue;
    let ok = true;
    for (let i = 0; i < r.parts.length; i++) {
      if (r.parts[i].startsWith(":")) continue;
      if (r.parts[i] !== parts[i]) { ok = false; break; }
    }
    if (!ok) continue;
    return r.handler(req, res, parts);
  }
  res.status(404).json({ error: "Not found" });
}