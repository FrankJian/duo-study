import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import sharp from "sharp";
import { and, asc, eq, isNull } from "drizzle-orm";
import { videoStatusSchema } from "@kids-video/contracts";
import { requireAuth, requireCsrf } from "../auth/session.js";
import { config, mediaDirs } from "../config.js";
import { db } from "../db/client.js";
import { writeAuditLog } from "../db/repositories.js";
import { units, videos } from "../db/schema.js";
import { ensureMediaDirectories } from "../storage/directories.js";
import { generatePoster, probeVideo } from "../storage/video-processing.js";

function fieldValue(fields: Record<string, unknown>, name: string) {
  const value = fields[name] as { value?: unknown } | undefined;
  return typeof value?.value === "string" ? value.value : undefined;
}

function serializeVideo(video: typeof videos.$inferSelect, unitSlug?: string) {
  return {
    ...video,
    unitSlug,
    videoUrl: `/media/videos/${video.storageKey}`,
    posterUrl: video.posterKey ? `/media/posters/${video.posterKey}` : null,
  };
}

export function registerVideoRoutes(app: FastifyInstance) {
  app.get("/api/admin/videos", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const query = request.query as { unitId?: string; status?: string };
    const predicates = [isNull(videos.deletedAt)];
    if (query.unitId) predicates.push(eq(videos.unitId, query.unitId));
    if (query.status && videoStatusSchema.safeParse(query.status).success) predicates.push(eq(videos.status, query.status as typeof videos.$inferSelect.status));
    const rows = db
      .select({ video: videos, unitSlug: units.slug })
      .from(videos)
      .innerJoin(units, eq(videos.unitId, units.id))
      .where(and(...predicates))
      .orderBy(asc(videos.unitId), asc(videos.sortOrder), asc(videos.title))
      .all();
    return reply.send(rows.map((row) => serializeVideo(row.video, row.unitSlug)));
  });

  app.get<{ Params: { id: string } }>("/api/admin/videos/:id", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const row = db.select({ video: videos, unitSlug: units.slug }).from(videos).innerJoin(units, eq(videos.unitId, units.id)).where(eq(videos.id, request.params.id)).get();
    if (!row) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "视频不存在" } });
    return reply.send(serializeVideo(row.video, row.unitSlug));
  });

  app.post("/api/admin/videos", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const part = await request.file({ limits: { fileSize: config.maxVideoBytes } });
    if (!part || part.fieldname !== "video") return reply.code(400).send({ error: { code: "VIDEO_REQUIRED", message: "请选择 MP4 视频文件" } });
    const fields = part.fields as Record<string, unknown>;
    const title = fieldValue(fields, "title")?.trim();
    const unitId = fieldValue(fields, "unitId");
    const sortOrder = Number(fieldValue(fields, "sortOrder") ?? 0);
    const requestedStatus = fieldValue(fields, "status") ?? "draft";
    if (!title || title.length > 200 || !unitId || !Number.isInteger(sortOrder) || sortOrder < 0 || !videoStatusSchema.safeParse(requestedStatus).success) {
      return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "标题、Unit、排序或状态不正确" } });
    }
    const unit = db.select().from(units).where(eq(units.id, unitId)).get();
    if (!unit) return reply.code(400).send({ error: { code: "UNIT_NOT_FOUND", message: "Unit 不存在" } });
    if (!part.filename.toLowerCase().endsWith(".mp4")) return reply.code(400).send({ error: { code: "INVALID_FILE", message: "只支持 MP4 文件" } });
    ensureMediaDirectories();
    const uploadId = randomUUID();
    const tempPath = path.join(mediaDirs.uploads, `${uploadId}.part`);
    const storageKey = `${uploadId}.mp4`;
    const videoPath = path.join(mediaDirs.videos, storageKey);
    const posterKey = `${uploadId}.webp`;
    const posterPath = path.join(mediaDirs.posters, posterKey);
    try {
      await pipeline(part.file, fs.createWriteStream(tempPath, { flags: "wx" }));
      if (part.file.truncated || fs.statSync(tempPath).size > config.maxVideoBytes) throw new Error("视频文件超过大小限制");
      const header = Buffer.alloc(12);
      const handle = fs.openSync(tempPath, "r");
      fs.readSync(handle, header, 0, header.length, 0);
      fs.closeSync(handle);
      if (header.toString("ascii", 4, 8) !== "ftyp") throw new Error("文件不是有效的 MP4");
      const probe = await probeVideo(tempPath);
      if (probe.videoCodec !== "h264" || (probe.audioCodec && probe.audioCodec !== "aac")) throw new Error("视频需要使用 H.264，音频需要使用 AAC");
      fs.renameSync(tempPath, videoPath);
      let hasPoster = false;
      try { hasPoster = await generatePoster(videoPath, posterPath); } catch (error) { request.log.warn({ err: error }, "default poster generation failed"); }
      const status = hasPoster ? requestedStatus as "draft" | "published" | "unlisted" | "deleted" : "draft";
      const now = new Date();
      const videoId = randomUUID();
      db.insert(videos).values({
        id: videoId,
        unitId,
        title,
        originalFilename: part.filename,
        storageKey,
        posterKey: hasPoster ? posterKey : null,
        mimeType: "video/mp4",
        fileSize: fs.statSync(videoPath).size,
        ...probe,
        sortOrder,
        status,
        createdAt: now,
        updatedAt: now,
      }).run();
      writeAuditLog({ actorUserId: auth.user.id, action: "video.created", entityType: "video", entityId: videoId, metadata: { title, unitId, status } });
      return reply.code(201).send({ video: serializeVideo(db.select().from(videos).where(eq(videos.id, videoId)).get()!, unit.slug), warning: hasPoster ? null : "默认封面生成失败，视频已保存为草稿" });
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      fs.rmSync(videoPath, { force: true });
      fs.rmSync(posterPath, { force: true });
      const message = error instanceof Error ? error.message : "上传失败";
      return reply.code(400).send({ error: { code: "UPLOAD_FAILED", message } });
    }
  });

  app.patch<{ Params: { id: string } }>("/api/admin/videos/:id", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const body = request.body as Partial<{ title: string; unitId: string; sortOrder: number; status: string }>;
    const updates: Partial<typeof videos.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
    if (typeof body.unitId === "string") updates.unitId = body.unitId;
    if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder) && body.sortOrder >= 0) updates.sortOrder = body.sortOrder;
    if (typeof body.status === "string" && videoStatusSchema.safeParse(body.status).success) updates.status = body.status as typeof updates.status;
    if (Object.keys(updates).length === 1) return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "没有可更新的内容" } });
    const current = db.select().from(videos).where(and(eq(videos.id, request.params.id), isNull(videos.deletedAt))).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "视频不存在" } });
    if (updates.unitId && !db.select().from(units).where(eq(units.id, updates.unitId)).get()) return reply.code(400).send({ error: { code: "UNIT_NOT_FOUND", message: "Unit 不存在" } });
    db.update(videos).set(updates).where(eq(videos.id, current.id)).run();
    writeAuditLog({ actorUserId: auth.user.id, action: "video.updated", entityType: "video", entityId: current.id, metadata: updates });
    return reply.send(db.select().from(videos).where(eq(videos.id, current.id)).get());
  });

  app.post<{ Params: { id: string } }>("/api/admin/videos/:id/poster", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const current = db.select().from(videos).where(and(eq(videos.id, request.params.id), isNull(videos.deletedAt))).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "视频不存在" } });
    const part = await request.file({ limits: { fileSize: config.maxImageBytes } });
    if (!part || part.fieldname !== "poster") return reply.code(400).send({ error: { code: "POSTER_REQUIRED", message: "请选择 JPG、PNG 或 WebP 封面" } });
    ensureMediaDirectories();
    const uploadId = randomUUID();
    const tempPath = path.join(mediaDirs.uploads, `${uploadId}.image.part`);
    const posterKey = `${uploadId}.webp`;
    const posterPath = path.join(mediaDirs.posters, posterKey);
    try {
      await pipeline(part.file, fs.createWriteStream(tempPath, { flags: "wx" }));
      if (part.file.truncated || fs.statSync(tempPath).size > config.maxImageBytes) throw new Error("封面文件超过大小限制");
      const metadata = await sharp(tempPath).metadata();
      if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new Error("封面格式必须是 JPG、PNG 或 WebP");
      await sharp(tempPath).rotate().resize(640, 360, { fit: "cover", position: "centre" }).webp({ quality: 82 }).toFile(posterPath);
      const previousPoster = current.posterKey ? path.join(mediaDirs.posters, current.posterKey) : null;
      db.update(videos).set({ posterKey, updatedAt: new Date() }).where(eq(videos.id, current.id)).run();
      if (previousPoster && fs.existsSync(previousPoster)) fs.renameSync(previousPoster, path.join(mediaDirs.trash, `${Date.now()}-${current.posterKey}`));
      fs.rmSync(tempPath, { force: true });
      writeAuditLog({ actorUserId: auth.user.id, action: "video.poster_replaced", entityType: "video", entityId: current.id });
      return reply.send({ posterUrl: `/media/posters/${posterKey}` });
    } catch (error) {
      fs.rmSync(tempPath, { force: true });
      fs.rmSync(posterPath, { force: true });
      const message = error instanceof Error ? error.message : "封面上传失败";
      return reply.code(400).send({ error: { code: "POSTER_UPLOAD_FAILED", message } });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/admin/videos/:id/poster", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const current = db.select().from(videos).where(and(eq(videos.id, request.params.id), isNull(videos.deletedAt))).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "视频不存在" } });
    if (!current.posterKey) return reply.send({ posterUrl: null });
    const oldPosterPath = path.join(mediaDirs.posters, current.posterKey);
    const newPosterKey = `${randomUUID()}.webp`;
    const newPosterPath = path.join(mediaDirs.posters, newPosterKey);
    try {
      await generatePoster(path.join(mediaDirs.videos, current.storageKey), newPosterPath);
      db.update(videos).set({ posterKey: newPosterKey, updatedAt: new Date() }).where(eq(videos.id, current.id)).run();
      if (fs.existsSync(oldPosterPath)) fs.renameSync(oldPosterPath, path.join(mediaDirs.trash, `${Date.now()}-${current.posterKey}`));
      writeAuditLog({ actorUserId: auth.user.id, action: "video.poster_reset", entityType: "video", entityId: current.id });
      return reply.send({ posterUrl: `/media/posters/${newPosterKey}` });
    } catch (error) {
      fs.rmSync(newPosterPath, { force: true });
      return reply.code(400).send({ error: { code: "POSTER_GENERATION_FAILED", message: error instanceof Error ? error.message : "默认封面生成失败" } });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/admin/videos/:id", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const current = db.select().from(videos).where(and(eq(videos.id, request.params.id), isNull(videos.deletedAt))).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "视频不存在" } });
    const deletedAt = new Date();
    const videoPath = path.join(mediaDirs.videos, current.storageKey);
    const trashVideoPath = path.join(mediaDirs.trash, `${current.id}-${current.storageKey}`);
    const posterPath = current.posterKey ? path.join(mediaDirs.posters, current.posterKey) : null;
    const trashPosterPath = current.posterKey ? path.join(mediaDirs.trash, `${current.id}-${current.posterKey}`) : null;
    try {
      if (fs.existsSync(videoPath)) fs.renameSync(videoPath, trashVideoPath);
      if (posterPath && trashPosterPath && fs.existsSync(posterPath)) fs.renameSync(posterPath, trashPosterPath);
      db.update(videos).set({ status: "deleted", deletedAt, updatedAt: deletedAt }).where(eq(videos.id, current.id)).run();
    } catch (error) {
      if (fs.existsSync(trashVideoPath) && !fs.existsSync(videoPath)) fs.renameSync(trashVideoPath, videoPath);
      if (trashPosterPath && posterPath && fs.existsSync(trashPosterPath) && !fs.existsSync(posterPath)) fs.renameSync(trashPosterPath, posterPath);
      return reply.code(500).send({ error: { code: "DELETE_FAILED", message: error instanceof Error ? error.message : "删除失败" } });
    }
    writeAuditLog({ actorUserId: auth.user.id, action: "video.deleted", entityType: "video", entityId: current.id });
    return reply.send({ ok: true });
  });

  app.post<{ Params: { id: string } }>("/api/admin/videos/:id/restore", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const current = db.select().from(videos).where(and(eq(videos.id, request.params.id), eq(videos.status, "deleted"))).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "可恢复的视频不存在" } });
    const trashVideoPath = path.join(mediaDirs.trash, `${current.id}-${current.storageKey}`);
    const videoPath = path.join(mediaDirs.videos, current.storageKey);
    const trashPosterPath = current.posterKey ? path.join(mediaDirs.trash, `${current.id}-${current.posterKey}`) : null;
    const posterPath = current.posterKey ? path.join(mediaDirs.posters, current.posterKey) : null;
    if (!fs.existsSync(trashVideoPath)) return reply.code(410).send({ error: { code: "TRASH_EXPIRED", message: "回收文件已清理，无法恢复" } });
    try {
      fs.renameSync(trashVideoPath, videoPath);
      if (trashPosterPath && posterPath && fs.existsSync(trashPosterPath)) fs.renameSync(trashPosterPath, posterPath);
      db.update(videos).set({ status: "draft", deletedAt: null, updatedAt: new Date() }).where(eq(videos.id, current.id)).run();
    } catch (error) {
      if (fs.existsSync(videoPath) && !fs.existsSync(trashVideoPath)) fs.renameSync(videoPath, trashVideoPath);
      return reply.code(500).send({ error: { code: "RESTORE_FAILED", message: error instanceof Error ? error.message : "恢复失败" } });
    }
    writeAuditLog({ actorUserId: auth.user.id, action: "video.restored", entityType: "video", entityId: current.id });
    return reply.send({ ok: true, status: "draft" });
  });
}
