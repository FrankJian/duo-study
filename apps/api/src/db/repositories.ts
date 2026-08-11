import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "./client.js";
import { auditLogs, sessions, units, users, videos } from "./schema.js";

export function listPublishedCatalog() {
  const publishedUnits = db
    .select()
    .from(units)
    .where(eq(units.status, "published"))
    .orderBy(asc(units.sortOrder), asc(units.slug))
    .all();

  return publishedUnits.map((unit) => ({
    ...unit,
    videos: db
      .select()
      .from(videos)
      .where(and(eq(videos.unitId, unit.id), eq(videos.status, "published"), isNull(videos.deletedAt)))
      .orderBy(asc(videos.sortOrder), asc(videos.title), asc(videos.id))
      .all(),
  }));
}

export function findUserByUsername(username: string) {
  return db.select().from(users).where(eq(users.username, username)).get();
}

export function findSessionByTokenHash(tokenHash: string) {
  return db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
    .get();
}

export function revokeOtherSessions(userId: string, exceptSessionId: string) {
  return db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), ne(sessions.id, exceptSessionId), isNull(sessions.revokedAt)))
    .run();
}

export function writeAuditLog(input: {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  return db
    .insert(auditLogs)
    .values({
      id: randomUUID(),
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
      createdAt: new Date(),
    })
    .run();
}
