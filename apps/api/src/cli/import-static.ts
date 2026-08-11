import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";
import { config, mediaDirs } from "../config.js";
import { db, closeDatabase, isDatabaseMigrated } from "../db/client.js";
import { units, videos } from "../db/schema.js";
import { writeAuditLog } from "../db/repositories.js";
import { ensureMediaDirectories } from "../storage/directories.js";
import { probeVideo } from "../storage/video-processing.js";

type StaticVideo = { order: number; title: string; file: string; poster?: string };
type StaticUnit = { id: string; title: string; subtitle?: string; videos: StaticVideo[] };

const rootDir = path.resolve(process.env.STATIC_ROOT ?? path.resolve(config.dataDir, ".."));
const manifestPath = path.join(rootDir, "videos.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { units: StaticUnit[] };

try {
  if (!isDatabaseMigrated()) throw new Error("数据库尚未迁移，请先运行 npm run db:migrate");
  ensureMediaDirectories();
  let importedVideos = 0;
  let skippedVideos = 0;
  for (const [unitOrder, staticUnit] of manifest.units.entries()) {
    const slug = staticUnit.id.toLowerCase();
    const now = new Date();
    let unit = db.select().from(units).where(eq(units.slug, slug)).get();
    if (!unit) {
      const id = randomUUID();
      db.insert(units).values({
        id,
        slug,
        title: staticUnit.title,
        subtitle: staticUnit.subtitle ?? null,
        sortOrder: unitOrder,
        status: "published",
        createdAt: now,
        updatedAt: now,
      }).run();
      unit = db.select().from(units).where(eq(units.id, id)).get();
      if (!unit) throw new Error(`无法创建 Unit: ${slug}`);
      writeAuditLog({ action: "migration.unit_imported", entityType: "unit", entityId: unit.id, metadata: { source: manifestPath } });
    }

    for (const item of staticUnit.videos) {
      const sourceVideo = path.resolve(rootDir, item.file);
      const sourcePoster = item.poster ? path.resolve(rootDir, item.poster) : null;
      if (!fs.existsSync(sourceVideo)) throw new Error(`找不到视频文件: ${sourceVideo}`);
      const existing = db.select().from(videos).where(and(eq(videos.unitId, unit.id), eq(videos.originalFilename, path.basename(sourceVideo)))).get();
      if (existing) {
        skippedVideos += 1;
        if (existing.durationMs === null || existing.width === null || existing.videoCodec === null) {
          const probe = await probeVideo(sourceVideo);
          db.update(videos).set({ ...probe, fileSize: fs.statSync(sourceVideo).size, updatedAt: new Date() }).where(eq(videos.id, existing.id)).run();
        }
        continue;
      }

      const id = randomUUID();
      const videoStorageKey = `${id}.mp4`;
      const posterStorageKey = `${id}.webp`;
      const videoDestination = path.join(mediaDirs.videos, videoStorageKey);
      const posterDestination = path.join(mediaDirs.posters, posterStorageKey);
      const probe = await probeVideo(sourceVideo);
      fs.copyFileSync(sourceVideo, videoDestination);
      if (sourcePoster && fs.existsSync(sourcePoster)) {
        await sharp(sourcePoster).rotate().resize(640, 360, { fit: "cover", position: "centre" }).webp({ quality: 82 }).toFile(posterDestination);
      }
      try {
        db.insert(videos).values({
          id,
          unitId: unit.id,
          title: item.title,
          originalFilename: path.basename(sourceVideo),
          storageKey: videoStorageKey,
          posterKey: sourcePoster && fs.existsSync(sourcePoster) ? posterStorageKey : null,
          mimeType: "video/mp4",
          fileSize: fs.statSync(videoDestination).size,
          ...probe,
          sortOrder: item.order,
          status: "published",
          createdAt: now,
          updatedAt: now,
        }).run();
      } catch (error) {
        fs.rmSync(videoDestination, { force: true });
        fs.rmSync(posterDestination, { force: true });
        throw error;
      }
      importedVideos += 1;
    }
  }
  console.log(`Static migration complete: ${importedVideos} imported, ${skippedVideos} skipped from ${manifestPath}`);
} finally {
  closeDatabase();
}
