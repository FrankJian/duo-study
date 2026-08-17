import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { config, mediaDirs } from "../config.js";
import { db } from "../db/client.js";
import { units, videos } from "../db/schema.js";
import { loadAuth, requireAuth } from "../auth/session.js";
import { requireSiteAccess } from "../auth/site-access.js";

const mediaKeyPattern = /^[0-9a-f-]{36}\.(?:mp4|webp)$/i;

function isPublicVideo(videoId: string) {
  const record = db
    .select({ video: videos, unit: units })
    .from(videos)
    .innerJoin(units, eq(videos.unitId, units.id))
    .where(and(eq(videos.id, videoId), eq(videos.status, "published"), eq(units.status, "published"), isNull(videos.deletedAt)))
    .get();
  return Boolean(record);
}

function sendLocalVideo(filePath: string, request: FastifyRequest, reply: FastifyReply) {
  const size = fs.statSync(filePath).size;
  const range = request.headers.range;
  reply.header("accept-ranges", "bytes").type("video/mp4");
  if (!range) return reply.send(fs.createReadStream(filePath));
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return reply.code(416).header("content-range", `bytes */${size}`).send();
  const start = match[1] ? Number(match[1]) : Math.max(size - Number(match[2]), 0);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return reply.code(416).header("content-range", `bytes */${size}`).send();
  }
  const boundedEnd = Math.min(end, size - 1);
  reply.code(206).header("content-range", `bytes ${start}-${boundedEnd}/${size}`).header("content-length", boundedEnd - start + 1);
  return reply.send(fs.createReadStream(filePath, { start, end: boundedEnd }));
}

export function registerMediaRoutes(app: FastifyInstance) {
  app.get<{ Params: { key: string } }>("/media/videos/:key", async (request, reply) => {
    const key = request.params.key;
    if (!mediaKeyPattern.test(key) || !key.toLowerCase().endsWith(".mp4")) return reply.code(400).send({ error: { code: "INVALID_MEDIA_KEY", message: "媒体地址无效" } });
    const record = db.select({ video: videos }).from(videos).where(eq(videos.storageKey, key)).get();
    if (!record) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "媒体不存在" } });
    const publicAccess = isPublicVideo(record.video.id);
    const adminAccess = Boolean(request.auth ?? loadAuth(request));
    if (!publicAccess) {
      if (!requireAuth(request, reply)) return;
    } else if (!adminAccess && !requireSiteAccess(request, reply)) return;
    const filePath = path.join(mediaDirs.videos, key);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "媒体不存在" } });
    reply.header("cache-control", publicAccess && !config.siteAccessPassword ? "public, max-age=86400" : "private, no-store");
    if (process.env.NGINX_ACCEL_REDIRECT === "true") {
      return reply.type("video/mp4").header("x-accel-redirect", `/protected-media/videos/${key}`).send();
    }
    return sendLocalVideo(filePath, request, reply);
  });

  app.get<{ Params: { key: string } }>("/media/posters/:key", async (request, reply) => {
    const key = request.params.key;
    if (!mediaKeyPattern.test(key) || !key.toLowerCase().endsWith(".webp")) return reply.code(400).send({ error: { code: "INVALID_MEDIA_KEY", message: "媒体地址无效" } });
    const record = db.select({ video: videos }).from(videos).where(eq(videos.posterKey, key)).get();
    if (!record) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "封面不存在" } });
    const publicAccess = isPublicVideo(record.video.id);
    const adminAccess = Boolean(request.auth ?? loadAuth(request));
    if (!publicAccess) {
      if (!requireAuth(request, reply)) return;
    } else if (!adminAccess && !requireSiteAccess(request, reply)) return;
    const filePath = path.join(mediaDirs.posters, key);
    if (!fs.existsSync(filePath)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "封面不存在" } });
    reply.header("cache-control", publicAccess && !config.siteAccessPassword ? "public, max-age=86400" : "private, no-store");
    if (process.env.NGINX_ACCEL_REDIRECT === "true") {
      return reply.type("image/webp").header("x-accel-redirect", `/protected-media/posters/${key}`).send();
    }
    return reply.type("image/webp").send(fs.createReadStream(filePath));
  });
}
