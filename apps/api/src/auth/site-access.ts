import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";

export const SITE_ACCESS_COOKIE = "kids_site_access";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function siteAccessEnabled() {
  return Boolean(config.siteAccessPassword);
}

export function siteAccessCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax" as const,
    maxAge: config.siteAccessTtlDays * 24 * 60 * 60,
  };
}

function sign(payload: string) {
  return createHmac("sha256", config.siteAccessSecret).update(payload).digest("hex");
}

export function createSiteAccessToken() {
  const expiresAt = Date.now() + config.siteAccessTtlDays * 24 * 60 * 60 * 1000;
  const payload = `v1.${expiresAt}.${randomBytes(18).toString("base64url")}`;
  return `${payload}.${sign(payload)}`;
}

export function isSiteAccessGranted(request: FastifyRequest) {
  if (!siteAccessEnabled()) return true;
  const token = request.cookies[SITE_ACCESS_COOKIE];
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = parts.slice(0, 3).join(".");
  return safeEqual(parts[3], sign(payload));
}

export function verifySiteAccessPassword(password: string) {
  if (!siteAccessEnabled()) return true;
  return safeEqual(createHash("sha256").update(password).digest("hex"), createHash("sha256").update(config.siteAccessPassword).digest("hex"));
}

export function setSiteAccessCookie(reply: FastifyReply) {
  reply.setCookie(SITE_ACCESS_COOKIE, createSiteAccessToken(), siteAccessCookieOptions());
}

export function clearSiteAccessCookie(reply: FastifyReply) {
  reply.clearCookie(SITE_ACCESS_COOKIE, { path: "/" });
}

export function requireSiteAccess(request: FastifyRequest, reply: FastifyReply) {
  if (isSiteAccessGranted(request)) return true;
  void reply.code(401).send({ error: { code: "SITE_ACCESS_REQUIRED", message: "请先登录后访问学习内容" } });
  return false;
}
