import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";

export const SESSION_COOKIE = "kids_session";
export const CSRF_COOKIE = "kids_csrf";

export type AuthContext = {
  session: typeof sessions.$inferSelect;
  user: typeof users.$inferSelect;
};

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function safeTokenEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax" as const,
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  };
}

export function csrfCookieOptions() {
  return {
    path: "/",
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: "lax" as const,
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  };
}

export function createSession(userId: string) {
  const now = new Date();
  const sessionToken = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + config.sessionTtlDays * 24 * 60 * 60 * 1000);

  const session = {
    id: randomBytes(16).toString("hex"),
    userId,
    tokenHash: hashToken(sessionToken),
    csrfTokenHash: hashToken(csrfToken),
    expiresAt,
    revokedAt: null,
    createdAt: now,
    lastSeenAt: now,
  };
  db.insert(sessions).values(session).run();
  return { sessionToken, csrfToken, session };
}

export function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: "/" });
  reply.clearCookie(CSRF_COOKIE, { path: "/" });
}

export function setSessionCookies(reply: FastifyReply, sessionToken: string, csrfToken: string) {
  reply.setCookie(SESSION_COOKIE, sessionToken, sessionCookieOptions());
  reply.setCookie(CSRF_COOKIE, csrfToken, csrfCookieOptions());
}

export function loadAuth(request: FastifyRequest) {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) {
    request.auth = null;
    return null;
  }

  const record = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .get();

  if (!record || record.user.status !== "active" || record.session.expiresAt.getTime() <= Date.now()) {
    request.auth = null;
    return null;
  }

  request.auth = record;
  return record;
}

export function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.auth ?? loadAuth(request);
  if (!auth) {
    void reply.code(401).send({ error: { code: "AUTH_REQUIRED", message: "请先登录" } });
    return null;
  }
  return auth;
}

export function requireCsrf(request: FastifyRequest, reply: FastifyReply, auth: AuthContext) {
  const csrfToken = request.headers["x-csrf-token"];
  if (typeof csrfToken !== "string" || !safeTokenEqual(hashToken(csrfToken), auth.session.csrfTokenHash)) {
    void reply.code(403).send({ error: { code: "CSRF_INVALID", message: "请求校验失败，请刷新页面后重试" } });
    return false;
  }
  return true;
}
