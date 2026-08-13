import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { unitInputSchema, unitPatchSchema, unitStatusPatchSchema } from "@kids-video/contracts";
import { requireAuth, requireCsrf } from "../auth/session.js";
import { db } from "../db/client.js";
import { writeAuditLog } from "../db/repositories.js";
import { units, videos } from "../db/schema.js";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}

export function registerUnitRoutes(app: FastifyInstance) {
  app.get<{ Params: { slug: string } }>("/api/units/:slug", async (request, reply) => {
    const unit = db.select().from(units).where(and(eq(units.slug, request.params.slug), eq(units.status, "published"))).get();
    if (!unit) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "课程不存在" } });
    const publishedVideos = db
      .select()
      .from(videos)
      .where(and(eq(videos.unitId, unit.id), eq(videos.status, "published"), isNull(videos.deletedAt)))
      .orderBy(asc(videos.sortOrder), asc(videos.title), asc(videos.id))
      .all();
    return reply.send({
      id: unit.id,
      slug: unit.slug,
      title: unit.title,
      subtitle: unit.subtitle,
      sortOrder: unit.sortOrder,
      videos: publishedVideos.map((video) => ({
        id: video.id,
        title: video.title,
        unitSlug: unit.slug,
        sortOrder: video.sortOrder,
        durationMs: video.durationMs,
        width: video.width,
        height: video.height,
        videoUrl: `/media/videos/${video.storageKey}`,
        posterUrl: video.posterKey ? `/media/posters/${video.posterKey}` : null,
      })),
    });
  });

  app.get("/api/admin/units", async (request, reply) => {
    if (!requireAuth(request, reply)) return;
    const rows = db.select().from(units).orderBy(asc(units.sortOrder), asc(units.slug)).all();
    return reply.send(rows.map((unit) => ({
      ...unit,
      videoCount: db.select({ id: videos.id }).from(videos).where(and(eq(videos.unitId, unit.id), isNull(videos.deletedAt))).all().length,
    })));
  });

  app.delete<{ Params: { id: string } }>("/api/admin/units/:id", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const current = db.select().from(units).where(eq(units.id, request.params.id)).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Unit 不存在" } });
    const activeVideoCount = db.select({ id: videos.id }).from(videos).where(and(eq(videos.unitId, current.id), isNull(videos.deletedAt))).all().length;
    if (activeVideoCount > 0) return reply.code(409).send({ error: { code: "UNIT_NOT_EMPTY", message: "请先删除该 Unit 下的视频，再删除 Unit" } });
    db.update(units).set({ status: "archived", updatedAt: new Date() }).where(eq(units.id, current.id)).run();
    writeAuditLog({ actorUserId: auth.user.id, action: "unit.archived", entityType: "unit", entityId: current.id });
    return reply.send({ ok: true });
  });

  app.post("/api/admin/units", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const parsed = unitInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "Unit 信息不完整或格式不正确" } });
    const now = new Date();
    const id = randomUUID();
    try {
      db.insert(units).values({ id, ...parsed.data, subtitle: parsed.data.subtitle ?? null, createdAt: now, updatedAt: now }).run();
    } catch (error) {
      return reply.code(409).send({ error: { code: "SLUG_EXISTS", message: errorMessage(error) } });
    }
    writeAuditLog({ actorUserId: auth.user.id, action: "unit.created", entityType: "unit", entityId: id });
    return reply.code(201).send(db.select().from(units).where(eq(units.id, id)).get());
  });

  app.patch<{ Params: { id: string } }>("/api/admin/units/:id", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const parsed = unitPatchSchema.safeParse(request.body);
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "没有可更新的内容" } });
    try {
      db.update(units).set({ ...parsed.data, updatedAt: new Date() }).where(eq(units.id, request.params.id)).run();
    } catch (error) {
      return reply.code(409).send({ error: { code: "SLUG_EXISTS", message: errorMessage(error) } });
    }
    const updated = db.select().from(units).where(eq(units.id, request.params.id)).get();
    if (!updated) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Unit 不存在" } });
    writeAuditLog({ actorUserId: auth.user.id, action: "unit.updated", entityType: "unit", entityId: updated.id, metadata: parsed.data });
    return reply.send(updated);
  });

  app.patch<{ Params: { id: string } }>("/api/admin/units/:id/status", async (request, reply) => {
    const auth = requireAuth(request, reply);
    if (!auth || !requireCsrf(request, reply, auth)) return;
    const parsed = unitStatusPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_INPUT", message: "状态不正确" } });
    const current = db.select().from(units).where(eq(units.id, request.params.id)).get();
    if (!current) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Unit 不存在" } });
    db.update(units).set({ status: parsed.data.status, updatedAt: new Date() }).where(eq(units.id, current.id)).run();
    writeAuditLog({ actorUserId: auth.user.id, action: `unit.${parsed.data.status}`, entityType: "unit", entityId: current.id });
    return reply.send(db.select().from(units).where(eq(units.id, current.id)).get());
  });
}
