import Fastify from "fastify";
import { createHash } from "node:crypto";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { catalogResponseSchema } from "@kids-video/contracts";
import { loadAuth } from "./auth/session.js";
import { requireSiteAccess } from "./auth/site-access.js";
import { config } from "./config.js";
import { isDatabaseMigrated } from "./db/client.js";
import { listPublishedCatalog } from "./db/repositories.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerSiteAuthRoutes } from "./routes/site-auth.js";
import { registerUnitRoutes } from "./routes/units.js";
import { registerVideoRoutes } from "./routes/videos.js";
import { ensureMediaDirectories } from "./storage/directories.js";

export function buildServer() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    trustProxy: config.trustProxy,
  });

  app.register(cookie);
  app.register(rateLimit, { global: true, max: 120, timeWindow: "1 minute" });
  app.register(multipart, { limits: { fileSize: config.maxVideoBytes, files: 1, parts: 20 } });
  app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  app.decorateRequest("auth", null);
  app.addHook("onRequest", async (request) => {
    loadAuth(request);
  });

  void registerAuthRoutes(app);
  registerSiteAuthRoutes(app);
  registerUnitRoutes(app);
  registerMediaRoutes(app);
  registerVideoRoutes(app);
  ensureMediaDirectories();

  app.get("/api/health", async (_request, reply) => {
    const migrated = isDatabaseMigrated();
    return reply.code(migrated ? 200 : 503).send({
      status: migrated ? "ok" : "migration_required",
      service: "api",
      time: new Date().toISOString(),
    });
  });

  app.get("/api/catalog", async (request, reply) => {
    if (!requireSiteAccess(request, reply)) return;
    const units = listPublishedCatalog().map((unit) => ({
      id: unit.id,
      slug: unit.slug,
      title: unit.title,
      subtitle: unit.subtitle,
      sortOrder: unit.sortOrder,
      videos: unit.videos.map((video) => ({
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
    }));
    const etag = `"${createHash("sha256").update(JSON.stringify(units)).digest("hex")}"`;
    if (request.headers["if-none-match"] === etag) return reply.code(304).header("etag", etag).send();
    const payload = catalogResponseSchema.parse({ units, generatedAt: new Date().toISOString() });
    const cacheControl = config.siteAccessPassword ? "private, no-store" : "public, max-age=30, stale-while-revalidate=120";
    return reply.header("etag", etag).header("cache-control", cacheControl).send(payload);
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
    const errorMessage = error instanceof Error ? error.message : "Unknown request error";
    return reply.code(statusCode).send({
      error: {
        code: "INTERNAL_ERROR",
        message: config.nodeEnv === "production" ? "服务暂时不可用" : errorMessage,
        requestId: request.id,
      },
    });
  });

  return app;
}

const app = buildServer();

try {
  if (!isDatabaseMigrated()) {
    throw new Error("数据库尚未迁移，请先运行 npm run db:migrate");
  }
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
