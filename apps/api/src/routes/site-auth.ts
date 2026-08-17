import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  clearSiteAccessCookie,
  isSiteAccessGranted,
  requireSiteAccess,
  setSiteAccessCookie,
  siteAccessEnabled,
  verifySiteAccessPassword,
} from "../auth/site-access.js";

const loginSchema = z.object({ password: z.string().min(1).max(256) });

export function registerSiteAuthRoutes(app: FastifyInstance) {
  app.get("/api/site-auth/me", async (request, reply) => {
    return reply.send({ enabled: siteAccessEnabled(), authenticated: isSiteAccessGranted(request) });
  });

  app.post(
    "/api/site-auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      if (!siteAccessEnabled()) return reply.send({ enabled: false, authenticated: true });
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success || !verifySiteAccessPassword(parsed.data.password)) {
        return reply.code(401).send({ error: { code: "SITE_LOGIN_FAILED", message: "访问密码不正确" } });
      }
      setSiteAccessCookie(reply);
      return reply.send({ enabled: true, authenticated: true });
    },
  );

  app.post("/api/site-auth/logout", async (request, reply) => {
    if (!requireSiteAccess(request, reply)) return;
    clearSiteAccessCookie(reply);
    return reply.send({ ok: true });
  });
}
