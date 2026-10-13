// ============================================================
// MIYORA — ADMIN API routes (completely separate)
// ============================================================
import type { NextApiRequest, NextApiResponse } from "next";
import {
  dbConnect, User, ApiListing, ApiKey, Subscription, UsageLog,
  signSession, setSessionCookie, requireAdmin,
  hashPassword, verifyPassword, rateLimit,
  ApiListingSchema, LoginSchema, parseBody,
} from "./lib";

type Handler = (req: NextApiRequest, res: NextApiResponse, parts: string[]) => Promise<any>;
const routes: { method: string; parts: string[]; handler: Handler }[] = [];
function route(method: string, path: string, handler: Handler) {
  routes.push({ method, parts: path.split("/").filter(Boolean), handler });
}

// ⚠️ PRODUCTION: move to .env →  ADMIN_EMAIL, ADMIN_PASSWORD
const FALLBACK_ADMIN_EMAIL = "admin@miyora.dev";
const FALLBACK_ADMIN_PASSWORD = "Admin@12345";

// -------- Admin login (bootstrap from env) --------
route("POST", "login", async (req, res) => {
  const ip = (req.headers["x-forwarded-for"] as string) || "anon";
  if (!rateLimit(`adminlogin:${ip}`, 5, 60_000).ok) return res.status(429).json({ error: "Too many attempts" });

  const p = parseBody(LoginSchema, req.body);
  if (!p.ok) return res.status(400).json({ error: p.errors.join("; ") });

  const adminEmail = (process.env.ADMIN_EMAIL || FALLBACK_ADMIN_EMAIL).toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || FALLBACK_ADMIN_PASSWORD;

  await dbConnect();
  let user = await User.findOne({ email: adminEmail });
  if (!user) {
    const passwordHash = await hashPassword(adminPassword);
    user = await User.create({ name: "Administrator", email: adminEmail, passwordHash, role: "admin" });
  }

  const emailOk = p.data.email.toLowerCase() === adminEmail;
  const passOk = await verifyPassword(p.data.password, user.passwordHash);
  if (!emailOk || !passOk) return res.status(401).json({ error: "Invalid credentials" });

  if (user.role !== "admin") { user.role = "admin"; await user.save(); }

  const token = await signSession({ uid: user._id.toString(), email: user.email, role: "admin" });
  setSessionCookie(res, token);
  res.json({ user: { id: user._id, email: user.email, role: "admin" } });
});

// -------- Admin: stats dashboard --------
route("GET", "stats", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const [users, apis, publishedApis, keys, subs, usage24h] = await Promise.all([
    User.countDocuments({}),
    ApiListing.countDocuments({}),
    ApiListing.countDocuments({ published: true }),
    ApiKey.countDocuments({ revoked: false }),
    Subscription.countDocuments({ status: "active" }),
    UsageLog.countDocuments({ createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
  ]);
  const topApis = await UsageLog.aggregate([
    { $group: { _id: "$apiId", count: { $sum: 1 } } },
    { $sort: { count: -1 } }, { $limit: 5 },
    { $lookup: { from: "apilistings", localField: "_id", foreignField: "_id", as: "api" } },
    { $unwind: { path: "$api", preserveNullAndEmptyArrays: true } },
    { $project: { count: 1, name: "$api.name", slug: "$api.slug" } },
  ]);
  res.json({ users, apis, publishedApis, keys, subs, usage24h, topApis });
});

// -------- Admin: API CRUD --------
route("GET", "apis", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const apis = await ApiListing.find({}).sort({ createdAt: -1 }).lean();
  res.json({ apis });
});

route("POST", "apis", async (req, res) => {
  const admin = await requireAdmin(req, res); if (!admin) return;
  const p = parseBody(ApiListingSchema, req.body);
  if (!p.ok) return res.status(400).json({ errors: p.errors });
  await dbConnect();
  if (await ApiListing.findOne({ slug: p.data.slug })) return res.status(409).json({ error: "Slug exists" });
  const api = await ApiListing.create({ ...p.data, ownerId: admin.uid });
  res.status(201).json({ api });
});

route("GET", "apis/:id", async (req, res, parts) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const api = await ApiListing.findById(parts[1]).lean();
  if (!api) return res.status(404).json({ error: "Not found" });
  res.json({ api });
});

route("PATCH", "apis/:id", async (req, res, parts) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const body = req.body || {};
  const keys = Object.keys(body);
  if (keys.length === 1 && keys[0] === "published") {
    const api = await ApiListing.findByIdAndUpdate(parts[1], { published: !!body.published }, { new: true }).lean();
    if (!api) return res.status(404).json({ error: "Not found" });
    return res.json({ api });
  }
  const p = parseBody(ApiListingSchema, body);
  if (!p.ok) return res.status(400).json({ errors: p.errors });
  const api = await ApiListing.findByIdAndUpdate(parts[1], p.data, { new: true }).lean();
  if (!api) return res.status(404).json({ error: "Not found" });
  res.json({ api });
});

route("DELETE", "apis/:id", async (req, res, parts) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  await ApiListing.findByIdAndDelete(parts[1]);
  res.json({ ok: true });
});

// -------- Admin: users --------
route("GET", "users", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const users = await User.find({}).select("name email role createdAt").sort({ createdAt: -1 }).limit(200).lean();
  res.json({ users });
});

route("PATCH", "users/:id", async (req, res, parts) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const { role } = req.body || {};
  if (!["user", "admin"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  const u = await User.findByIdAndUpdate(parts[1], { role }, { new: true }).select("name email role").lean();
  if (!u) return res.status(404).json({ error: "Not found" });
  res.json({ user: u });
});

// -------- Admin: all usage logs --------
route("GET", "usage", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const logs = await UsageLog.find({}).sort({ createdAt: -1 }).limit(200)
    .populate("apiId", "name slug").populate("userId", "email").lean();
  res.json({ logs });
});

// -------- Admin: all subscriptions --------
route("GET", "subscriptions", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  await dbConnect();
  const subs = await Subscription.find({}).sort({ createdAt: -1 }).limit(200)
    .populate("apiId", "name slug").populate("userId", "email").lean();
  res.json({ subscriptions: subs });
});

// -------- Dispatcher --------
export async function handleAdminApi(req: NextApiRequest, res: NextApiResponse, parts: string[]) {
  const method = req.method || "GET";
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
  res.status(404).json({ error: "Admin route not found" });
}