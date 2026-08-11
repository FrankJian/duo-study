import { describe, expect, it } from "vitest";
import { catalogResponseSchema, unitInputSchema } from "@kids-video/contracts";
import { hashToken } from "./auth/session.js";

describe("shared contracts", () => {
  it("accepts a public catalog with media URLs and rejects server paths", () => {
    const valid = {
      units: [{ id: "00000000-0000-0000-0000-000000000001", slug: "unit1", title: "Unit 1", subtitle: null, sortOrder: 0, videos: [{ id: "00000000-0000-0000-0000-000000000002", title: "A", unitSlug: "unit1", sortOrder: 1, durationMs: null, width: null, height: null, videoUrl: "/media/videos/a.mp4", posterUrl: "/media/posters/a.webp" }] }],
      generatedAt: "2026-08-11T00:00:00.000Z",
    };
    expect(catalogResponseSchema.safeParse(valid).success).toBe(true);
    expect(catalogResponseSchema.safeParse({ ...valid, units: [{ ...valid.units[0], videos: [{ ...valid.units[0].videos[0], videoUrl: "/srv/media/a.mp4" }] }] }).success).toBe(false);
  });

  it("normalizes Unit input constraints", () => {
    expect(unitInputSchema.safeParse({ slug: "unit-3", title: "Unit 3", sortOrder: 2 }).success).toBe(true);
    expect(unitInputSchema.safeParse({ slug: "Unit 3", title: "Unit 3", sortOrder: -1 }).success).toBe(false);
  });
});

describe("session tokens", () => {
  it("stores a one-way stable hash", () => {
    expect(hashToken("same-token")).toBe(hashToken("same-token"));
    expect(hashToken("same-token")).not.toBe(hashToken("other-token"));
    expect(hashToken("same-token")).toHaveLength(64);
  });
});
