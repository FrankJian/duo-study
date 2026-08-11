import { z } from "zod";

export const unitStatusSchema = z.enum(["draft", "published", "archived"]);
export const videoStatusSchema = z.enum(["draft", "published", "unlisted", "deleted"]);

export const publicVideoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  unitSlug: z.string(),
  sortOrder: z.number().int(),
  durationMs: z.number().int().nonnegative().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  videoUrl: z.string().startsWith("/media/"),
  posterUrl: z.string().startsWith("/media/").nullable(),
});

export const publicUnitSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().nullable(),
  sortOrder: z.number().int(),
  videos: z.array(publicVideoSchema),
});

export const catalogResponseSchema = z.object({
  units: z.array(publicUnitSchema),
  generatedAt: z.string().datetime(),
});

export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const passwordChangeRequestSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256),
});

export const unitInputSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(240).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000),
  status: unitStatusSchema.default("draft"),
});

export const unitPatchSchema = unitInputSchema.partial();

export const unitStatusPatchSchema = z.object({ status: unitStatusSchema });

export const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  role: z.literal("admin"),
  status: z.enum(["active", "disabled"]),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type UnitStatus = z.infer<typeof unitStatusSchema>;
export type VideoStatus = z.infer<typeof videoStatusSchema>;
export type PublicVideo = z.infer<typeof publicVideoSchema>;
export type PublicUnit = z.infer<typeof publicUnitSchema>;
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;
export type UnitInput = z.infer<typeof unitInputSchema>;
export type User = z.infer<typeof userSchema>;
