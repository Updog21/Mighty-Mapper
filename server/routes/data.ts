import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { NotFoundError, ValidationError } from "../errors";
import { storage } from "../storage";
import { techniques, ssmMappings } from "@shared/schema";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import { respondWithCache, buildCacheKey, normalizePlatformList } from "./shared-helpers";

const router = Router();

// Get all data components
router.get("/data-components", asyncHandler(async (req, res) => {
  const rawPlatforms = typeof req.query.platforms === "string"
    ? req.query.platforms
    : typeof req.query.platform === "string"
      ? req.query.platform
      : "";
  const platforms = rawPlatforms
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const normalizedPlatforms = normalizePlatformList(platforms);
  const key = buildCacheKey(["data-components", normalizedPlatforms.join("|") || "all"]);
  await respondWithCache(key, 5 * 60 * 1000, async () => {
    if (normalizedPlatforms.length === 0) {
      return storage.getAllDataComponents();
    }
    const ids = await storage.getDataComponentIdsForPlatforms(normalizedPlatforms);
    if (ids.length === 0) return [];
    return storage.getDataComponentsByComponentIds(ids);
  }, res);
}));

// Get data component by ID
router.get("/data-components/:componentId", asyncHandler(async (req, res) => {
  const { componentId } = req.params;
  const component = await storage.getDataComponentById(componentId);
  if (!component) throw new NotFoundError("Data component not found");
  res.json(component);
}));

// Bulk create data components
router.post("/data-components/bulk", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { components } = req.body;
  if (!Array.isArray(components)) throw new ValidationError("Expected array of components");
  await storage.bulkCreateDataComponents(components);
  res.status(201).json({ message: "Data components created successfully" });
}));

// Get all detection strategies
router.get("/detection-strategies", asyncHandler(async (_req, res) => {
  const key = buildCacheKey(["detection-strategies"]);
  await respondWithCache(key, 5 * 60 * 1000, () => storage.getAllDetectionStrategies(), res);
}));

// Bulk create detection strategies
router.post("/detection-strategies/bulk", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { strategies } = req.body;
  if (!Array.isArray(strategies)) throw new ValidationError("Expected array of strategies");
  await storage.bulkCreateDetectionStrategies(strategies);
  res.status(201).json({ message: "Detection strategies created successfully" });
}));

// Get technique names by IDs (from DB)
router.post("/techniques/names", requireAuth, asyncHandler(async (req, res) => {
  const { techniqueIds, limit, offset } = req.body;
  if (!Array.isArray(techniqueIds)) throw new ValidationError("Expected techniqueIds array");
  const normalizedIds = techniqueIds
    .filter((id: unknown) => typeof id === "string" && id.trim().length > 0)
    .map((id: string) => id.trim().toUpperCase());
  if (normalizedIds.length === 0) {
    return res.json({ techniqueNames: {} });
  }

  const safeLimit = typeof limit === "number" && limit > 0 ? Math.min(limit, 500) : normalizedIds.length;
  const safeOffset = typeof offset === "number" && offset >= 0 ? offset : 0;
  const key = buildCacheKey([
    "technique-names",
    normalizedIds.join(","),
    safeLimit,
    safeOffset,
  ]);

  await respondWithCache(key, 10 * 60 * 1000, async () => {
    const rows = await db.select({
      techniqueId: techniques.techniqueId,
      name: techniques.name,
    })
      .from(techniques)
      .where(inArray(techniques.techniqueId, normalizedIds))
      .limit(safeLimit)
      .offset(safeOffset);

    const techniqueNames = rows.reduce<Record<string, string>>((acc, row) => {
      acc[row.techniqueId.toUpperCase()] = row.name;
      return acc;
    }, {});

    return { techniqueNames, total: normalizedIds.length, limit: safeLimit, offset: safeOffset };
  }, res);
}));

// Get analytics by strategy ID
router.get("/analytics/:strategyId", asyncHandler(async (req, res) => {
  const { strategyId } = req.params;
  const analyticsList = await storage.getAnalyticsByStrategyId(strategyId);
  res.json(analyticsList);
}));

// Bulk create analytics
router.post("/analytics/bulk", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { analytics } = req.body;
  if (!Array.isArray(analytics)) throw new ValidationError("Expected array of analytics");
  await storage.bulkCreateAnalytics(analytics);
  res.status(201).json({ message: "Analytics created successfully" });
}));

// Get all MITRE assets
router.get("/mitre-assets", asyncHandler(async (_req, res) => {
  const assets = await storage.getAllMitreAssets();
  res.json(assets);
}));

// Bulk create MITRE assets
router.post("/mitre-assets/bulk", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { assets } = req.body;
  if (!Array.isArray(assets)) throw new ValidationError("Expected array of assets");
  await storage.bulkCreateMitreAssets(assets);
  res.status(201).json({ message: "MITRE assets created successfully" });
}));

// Update SSM mapping metadata
router.patch("/ssm/mappings/:mappingId", requireAuth, requireRole("admin", "user"), asyncHandler(async (req, res) => {
  const mappingId = Number(req.params.mappingId);
  if (Number.isNaN(mappingId)) throw new ValidationError("Invalid mapping ID");
  const { metadata } = req.body;
  if (!metadata || typeof metadata !== "object") throw new ValidationError("metadata is required");
  const existing = await db.select().from(ssmMappings).where(eq(ssmMappings.id, mappingId)).limit(1);
  if (!existing[0]) throw new NotFoundError("Mapping not found");
  const nextMetadata = {
    ...(existing[0].metadata || {}),
    ...(metadata as Record<string, unknown>),
  };
  const updated = await db.update(ssmMappings)
    .set({ metadata: nextMetadata })
    .where(eq(ssmMappings.id, mappingId))
    .returning();
  res.json(updated[0]);
}));

// Get detections
router.get("/detections", asyncHandler(async (req, res) => {
  const { getAllDetections } = await import("../services");
  const query = typeof req.query.q === "string" ? req.query.q : "";
  const normalized = query.trim();
  const key = buildCacheKey(["detections", normalized || "all"]);
  await respondWithCache(key, 5 * 60 * 1000, () => getAllDetections(normalized), res);
}));

export default router;
