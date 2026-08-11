import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import {
  loginRequestSchema,
  passwordChangeRequestSchema,
  userSchema,
} from "@kids-video/contracts";
import { db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { writeAuditLog } from "../db/repositories.js";
import {
  clearSessionCookies,
  createSession,
  loadAuth,
  normalizeUsername,
  requireAuth,
  requireCsrf,
  setSessionCookies,
} from "../auth/session.js";

function publicUser(user: typeof users.$inferSelect) {
  return userSchema.parse({ id: user.id, username: user.username, role: user.role, status: user.status });
}

export function registerAuthRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/login",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "用户名或密码格式不正确" } });
      }

      const username = normalizeUsername(parsed.data.username);
      const user = db.select().from(users).where(eq(users.username, username)).get();
      const valid = user && user.status === "active" && await argon2.verify(user.passwordHash, parsed.data.password);
      if (!valid || !user) {
        writeAuditLog({ action: "auth.login_failed", entityType: "user", metadata: { username } });
        return reply.code(401).send({ error: { code: "LOGIN_FAILED", message: "用户名或密码不正确" } });
      }

      const created = createSession(user.id);
      setSessionCookies(reply, created.sessionToken, created.csrfToken);
      writeAuditLog({ actorUserId: user.id, action: "auth.login_succeeded", entityType: "user", entityId: user.id });
      return reply.send({ user: publicUser(user) });
    },
  );

  app.get("/api/auth/me", async (request, reply) => {
    const auth = loadAuth(request);
    return reply.send({ user: auth ? publicUser(auth.user) : null });
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    if (!requireCsrf(request, reply, auth)) return;
    db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, auth.session.id)).run();
    clearSessionCookies(reply);
    writeAuditLog({ actorUserId: auth.user.id, action: "auth.logout", entityType: "user", entityId: auth.user.id });
    return reply.send({ ok: true });
  });

  app.put("/api/auth/password", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth) return;
    if (!requireCsrf(request, reply, auth)) return;
    const parsed = passwordChangeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "新密码至少需要 12 个字符" } });
    }
    if (!(await argon2.verify(auth.user.passwordHash, parsed.data.currentPassword))) {
      return reply.code(400).send({ error: { code: "PASSWORD_INVALID", message: "当前密码不正确" } });
    }
    const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });
    db.transaction((tx) => {
      tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, auth.user.id)).run();
      tx.update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, auth.user.id), isNull(sessions.revokedAt)))
        .run();
    });
    clearSessionCookies(reply);
    writeAuditLog({ actorUserId: auth.user.id, action: "auth.password_changed", entityType: "user", entityId: auth.user.id });
    return reply.send({ ok: true });
  });
}
