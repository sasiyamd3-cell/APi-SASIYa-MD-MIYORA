// ============================================================
// MIYORA — Core backend logic
// ============================================================
import mongoose, { Schema, model, models } from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { SignJWT, jwtVerify } from "jose";
import { serialize, parse } from "cookie";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { URL } from "url";

// ---------- MongoDB ----------
// ⚠️ PRODUCTION: Move to .env  →  MONGODB_URI=...
const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://mrshrii404:JLtbz0CEOC1u6CwS@shri.gkhohrr.mongodb.net/miyora?retryWrites=true&w=majority";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = global as unknown as { _mongoose?: Cache };
const cached: Cache = g._mongoose || { conn: null, promise: null };

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) cached.promise = mongoose.connect(MONGODB_URI, { bufferCommands: false });
  cached.conn = await cached.promise;
  g._mongoose = cached;
  return cached.conn;
}

// ---------- Models ----------
const UserSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["user", "admin"], default: "user" },
}, { timestamps: true });
export const User = models.User || model("User", UserSchema);

const ParamSchema = new Schema({
  name: String, in: { type: String, enum: ["query", "path", "body"] },
  type: String, required: Boolean, description: { type: String, default: "" },
}, { _id: false });
const HeaderSchema = new Schema({ name: String, value: String }, { _id: false });

const ApiListingSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  endpointUrl: { type: String, required: true },
  method: { type: String, enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], required: true },
  category: { type: String, required: true, index: true },
  description: { type: String, required: true },
  docs: { type: String, default: "" },
  parameters: { type: [ParamSchema], default: [] },
  headers: { type: [HeaderSchema], default: [] },
  exampleRequest: { type: String, default: "" },
  exampleResponse: { type: String, default: "" },
  pricing: {
    plan: { type: String, default: "Free" },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
    interval: { type: String, enum: ["monthly", "yearly", "one-time"], default: "monthly" },
  },
  quotas: {
    requestsPerMinute: { type: Number, default: 60 },
    requestsPerMonth: { type: Number, default: 10000 },
  },
  thumbnail: { type: String, default: "" },
  published: { type: Boolean, default: false, index: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });
export const ApiListing = models.ApiListing || model("ApiListing", ApiListingSchema);

const ApiKeySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  name: { type: String, required: true },
  keyHash: { type: String, required: true },
  prefix: { type: String, required: true },
  revoked: { type: Boolean, default: false },
  lastUsedAt: { type: Date },
}, { timestamps: true });
export const ApiKey = models.ApiKey || model("ApiKey", ApiKeySchema);

const SubscriptionSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  apiId: { type: Schema.Types.ObjectId, ref: "ApiListing", required: true, index: true },
  plan: { type: String, required: true },
  status: { type: String, enum: ["active", "canceled", "pending"], default: "active" },
  startedAt: { type: Date, default: Date.now },
  renewsAt: { type: Date },
}, { timestamps: true });
SubscriptionSchema.index({ userId: 1, apiId: 1 }, { unique: true });
export const Subscription = models.Subscription || model("Subscription", SubscriptionSchema);

const UsageLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  apiKeyId: { type: Schema.Types.ObjectId, ref: "ApiKey", index: true },
  apiId: { type: Schema.Types.ObjectId, ref: "ApiListing", index: true },
  method: String, path: String, statusCode: Number, latencyMs: Number,
  ip: String, error: String,
}, { timestamps: true });
export const UsageLog = models.UsageLog || model("UsageLog", UsageLogSchema);

// ---------- Auth ----------
const SECRET_RAW = process.env.JWT_SECRET || "miyora-dev-secret-change-me-in-production-32bytes!";
const secret = new TextEncoder().encode(SECRET_RAW);
export const COOKIE = "miyora_token";

export type SessionPayload = { uid: string; email: string; role: "user" | "admin" };

export async function signSession(p: SessionPayload) {
  return await new SignJWT(p as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret);
}
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try { const { payload } = await jwtVerify(token, secret); return payload as unknown as SessionPayload; }
  catch { return null; }
}
export function setSessionCookie(res: NextApiResponse, token: string) {
  res.setHeader("Set-Cookie", serialize(COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7,
  }));
}
export function clearSessionCookie(res: NextApiResponse) {
  res.setHeader("Set-Cookie", serialize(COOKIE, "", { path: "/", maxAge: 0 }));
}
export async function getSession(req: NextApiRequest) {
  const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
  const token = cookies[COOKIE]; if (!token) return null;
  return verifySession(token);
}
export async function requireUser(req: NextApiRequest, res: NextApiResponse) {
  const s = await getSession(req);
  if (!s) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return s;
}
export async function requireAdmin(req: NextApiRequest, res: NextApiResponse) {
  const s = await requireUser(req, res); if (!s) return null;
  if (s.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return null; }
  return s;
}
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, h: string) => bcrypt.compare(pw, h);

// ---------- API Keys ----------
export function generateApiKey() { return "miy_" + crypto.randomBytes(24).toString("hex"); }
export function hashApiKey(raw: string) { return bcrypt.hash(raw, 8); }
export function verifyApiKey(raw: string, hash: string) { return bcrypt.compare(raw, hash); }
export function keyPrefix(raw: string) { return raw.slice(0, 12); }

// ---------- Rate limit ----------
type Bucket = { count: number; reset: number };
const store = new Map<string, Bucket>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now(); const b = store.get(key);
  if (!b || b.reset < now) { store.set(key, { count: 1, reset: now + windowMs }); return { ok: true, remaining: limit - 1, reset: now + windowMs }; }
  if (b.count >= limit) return { ok: false, remaining: 0, reset: b.reset };
  b.count++; return { ok: true, remaining: limit - b.count, reset: b.reset };
}

// ---------- Validation ----------
export const ApiListingSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  endpointUrl: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  category: z.string().min(2).max(40),
  description: z.string().min(10).max(2000),
  docs: z.string().url().optional().or(z.literal("")),
  parameters: z.array(z.object({
    name: z.string(), in: z.enum(["query", "path", "body"]),
    type: z.string(), required: z.boolean(), description: z.string().optional().default(""),
  })).default([]),
  headers: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
  exampleRequest: z.string().max(20000).default(""),
  exampleResponse: z.string().max(20000).default(""),
  pricing: z.object({
    plan: z.string(), price: z.number().min(0), currency: z.string().default("USD"),
    interval: z.enum(["monthly", "yearly", "one-time"]).default("monthly"),
  }),
  quotas: z.object({
    requestsPerMinute: z.number().int().min(1).max(10000).default(60),
    requestsPerMonth: z.number().int().min(1).max(10000000).default(10000),
  }),
  thumbnail: z.string().url().optional().or(z.literal("")),
  published: z.boolean().default(false),
});
export const RegisterSchema = z.object({
  name: z.string().min(2).max(80), email: z.string().email(), password: z.string().min(8).max(200),
});
export const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export function parseBody<T>(schema: z.ZodSchema<T>, data: unknown):
  { ok: true; data: T } | { ok: false; errors: string[] } {
  const r = schema.safeParse(data);
  if (!r.success) return { ok: false, errors: r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`) };
  return { ok: true, data: r.data };
}

// ---------- Safe proxy (SSRF guard) ----------
const BLOCKED_HOSTS = [/^localhost$/i, /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./, /^169\.254\./, /^0\./, /^::1$/];

export function isSafeUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    if (BLOCKED_HOSTS.some(r => r.test(u.hostname))) return false;
    return true;
  } catch { return false; }
}

export async function forwardRequest(opts: {
  url: string; method: string; headers?: Record<string, string>;
  body?: unknown; timeoutMs?: number;
}) {
  if (!isSafeUrl(opts.url)) throw new Error("Unsafe target URL");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await fetch(opts.url, {
      method: opts.method,
      headers: { "content-type": "application/json", ...(opts.headers || {}) },
      body: opts.method === "GET" || opts.method === "DELETE" ? undefined : JSON.stringify(opts.body ?? {}),
      signal: controller.signal,
    });
    const text = await res.text();
    return { status: res.status, headers: Object.fromEntries(res.headers), body: text };
  } finally { clearTimeout(t); }
}