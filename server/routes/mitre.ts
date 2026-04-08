import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { NotFoundError, ValidationError } from "../errors";
import { storage } from "../storage";
import { mitreKnowledgeGraph } from "../mitre-stix";
import { products } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { getGlobalCoverage } from "../services/coverage-service";
import { getCoverageGaps, getCoveragePaths } from "../services/gap-analysis-service";
import {
  respondWithCache,
  buildCacheKey,
  getDataComponentsForPlatforms,
  UI_PLATFORM_OPTIONS,
  normalizePlatformList,
  platformMatchesAny,
  PLATFORM_VALUES,
} from "./shared-helpers";

const router = Router();

// Initialize STIX data
router.post("/mitre-stix/init", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const stats = mitreKnowledgeGraph.getStats();
  res.json({ status: 'initialized', stats });
}));

// Get STIX stats
router.get("/mitre-stix/stats", asyncHandler(async (_req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const key = buildCacheKey(["mitre-stix", "stats"]);
  await respondWithCache(key, 5 * 60 * 1000, () => Promise.resolve(mitreKnowledgeGraph.getStats()), res);
}));

// Get log requirements for a technique
router.get("/mitre-stix/technique/:techniqueId/requirements", asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const { techniqueId } = req.params;
  const requirements = mitreKnowledgeGraph.getLogRequirements(techniqueId);
  res.json({ techniqueId, requirements });
}));

// Get full mapping for multiple techniques
router.post("/mitre-stix/techniques/mapping", requireAuth, asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const { techniqueIds, platforms } = req.body;
  if (!Array.isArray(techniqueIds)) throw new ValidationError("techniqueIds must be an array");
  const platformKey = Array.isArray(platforms) ? platforms.join(",") : "";
  const key = buildCacheKey(["mitre-stix", "mapping", techniqueIds.join(","), platformKey]);
  await respondWithCache(
    key,
    5 * 60 * 1000,
    () => Promise.resolve(
      mitreKnowledgeGraph.getFullMappingForTechniques(
        techniqueIds,
        Array.isArray(platforms) ? platforms : undefined
      )
    ),
    res
  );
}));

// Get tactics for multiple techniques
router.post("/mitre-stix/techniques/tactics", requireAuth, asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const { techniqueIds } = req.body;
  if (!Array.isArray(techniqueIds)) throw new ValidationError("techniqueIds must be an array");

  const normalizedIds: string[] = [];
  const seen = new Set<string>();
  for (const id of techniqueIds) {
    if (typeof id !== "string") continue;
    const normalized = mitreKnowledgeGraph.normalizeTechniqueId(id) || id.trim().toUpperCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    normalizedIds.push(normalized);
  }

  const key = buildCacheKey(["mitre-stix", "tactics", normalizedIds.join(",")]);
  await respondWithCache(
    key,
    5 * 60 * 1000,
    async () => {
      const tacticsByTechnique: Record<string, string[]> = {};
      normalizedIds.forEach((techniqueId) => {
        const tactics = mitreKnowledgeGraph.getTactics(techniqueId);
        if (tactics.length > 0) {
          tacticsByTechnique[techniqueId] = tactics;
        }
      });
      return { tacticsByTechnique };
    },
    res
  );
}));

router.get("/mitre-stix/platforms", asyncHandler(async (_req, res) => {
  const key = buildCacheKey(["mitre-stix", "platforms"]);
  await respondWithCache(
    key,
    5 * 60 * 1000,
    () => Promise.resolve({ platforms: UI_PLATFORM_OPTIONS }),
    res
  );
}));

router.get("/mitre/data-components", asyncHandler(async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform.trim() : "";
  const platformsParam = typeof req.query.platforms === "string" ? req.query.platforms.trim() : "";
  const includeDeprecated = req.query.includeDeprecated === "true";
  const includeUnscoped = req.query.include_unscoped === "true";
  const platformList = platformsParam
    ? platformsParam.split(",").map((item) => item.trim()).filter(Boolean)
    : platform
      ? [platform]
      : [];
  const normalizedPlatforms = normalizePlatformList(platformList);
  const platformKey = normalizedPlatforms.map((item) => item.toLowerCase()).join(",") || "all";
  const cacheKey = buildCacheKey([
    "mitre-data-components",
    platformKey,
    includeDeprecated ? "with-deprecated" : "active",
    includeUnscoped ? "with-unscoped" : "strict",
  ]);

  await respondWithCache(
    cacheKey,
    5 * 60 * 1000,
    async () => {
      const { components, meta } = await getDataComponentsForPlatforms(normalizedPlatforms, includeDeprecated, includeUnscoped);
      return { dataComponents: components, meta };
    },
    res
  );
}));

router.get("/mitre/detection-strategies", asyncHandler(async (_req, res) => {
  const cacheKey = buildCacheKey(["mitre-detection-strategies"]);
  await respondWithCache(
    cacheKey,
    5 * 60 * 1000,
    async () => {
      let graphReady = true;
      try {
        await mitreKnowledgeGraph.ensureInitialized();
      } catch (error) {
        graphReady = false;
        console.warn("MITRE graph unavailable for detection strategies, falling back to stored strategies.", error);
      }

      if (graphReady) {
        return {
          detectionStrategies: mitreKnowledgeGraph.getAllDetectionStrategiesDetailed(),
        };
      }

      const stored = await storage.getAllDetectionStrategies();
      return {
        detectionStrategies: stored.map((strategy) => ({
          id: strategy.strategyId,
          name: strategy.name,
          description: strategy.description || "",
          techniques: [],
          analytics: [],
          dataComponents: [],
        })),
      };
    },
    res
  );
}));

router.get("/mitre/techniques", asyncHandler(async (req, res) => {
  const platform = typeof req.query.platform === "string" ? req.query.platform.trim() : "";
  const platformsParam = typeof req.query.platforms === "string" ? req.query.platforms.trim() : "";
  const platformList = platformsParam
    ? platformsParam.split(",").map((item) => item.trim()).filter(Boolean)
    : platform
      ? [platform]
      : [];
  const normalizedPlatforms = normalizePlatformList(platformList);
  const platformKey = normalizedPlatforms.map((item) => item.toLowerCase()).join(",") || "all";
  const cacheKey = buildCacheKey(["mitre-techniques", platformKey]);

  await respondWithCache(
    cacheKey,
    5 * 60 * 1000,
    async () => {
      let graphReady = true;
      try {
        await mitreKnowledgeGraph.ensureInitialized();
      } catch (error) {
        graphReady = false;
        console.warn("MITRE graph unavailable for techniques.", error);
      }

      if (!graphReady) {
        return { techniques: [] };
      }

      const allTechniques = mitreKnowledgeGraph.getAllTechniquesDetailed();
      const filtered = normalizedPlatforms.length > 0
        ? allTechniques.filter((technique) => platformMatchesAny(technique.platforms, normalizedPlatforms))
        : allTechniques;

      return {
        techniques: filtered,
        meta: {
          total: allTechniques.length,
          matched: filtered.length,
        },
      };
    },
    res
  );
}));

router.get("/mitre/techniques/:techniqueId", asyncHandler(async (req, res) => {
  const { techniqueId } = req.params;
  if (!techniqueId || typeof techniqueId !== "string") throw new ValidationError("techniqueId is required");
  await mitreKnowledgeGraph.ensureInitialized();
  const detail = mitreKnowledgeGraph.getTechniqueDetail(techniqueId);
  if (!detail) throw new NotFoundError("Technique not found");
  res.json({ technique: detail });
}));

router.get("/mitre/validate-dc", asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const idsParam = typeof req.query.ids === "string" ? req.query.ids : "";
  const requested = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const validSet = new Set(
    mitreKnowledgeGraph.getAllDataComponents().map((dc) => dc.id.toLowerCase())
  );
  const valid: string[] = [];
  const invalid: string[] = [];
  requested.forEach((id) => {
    if (validSet.has(id.toLowerCase())) {
      valid.push(id);
    } else {
      invalid.push(id);
    }
  });
  res.json({ valid, invalid });
}));

// Get strategies for a technique
router.get("/mitre-stix/technique/:techniqueId/strategies", asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const { techniqueId } = req.params;
  const strategies = mitreKnowledgeGraph.getStrategiesForTechnique(techniqueId);
  res.json({ techniqueId, strategies });
}));

// Hybrid Selector endpoints
router.get("/hybrid-selector/options", (_req, res) => {
  const options = PLATFORM_VALUES.map((platform) => ({
    label: platform,
    type: "platform",
    value: platform,
  }));
  res.json(options);
});

// Get techniques by hybrid selector
router.post("/mitre-stix/techniques/by-selector", requireAuth, asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const { selectorType, selectorValue } = req.body;
  if (!selectorType || !selectorValue) throw new ValidationError("selectorType and selectorValue are required");
  if (selectorType !== 'platform') throw new ValidationError("Only 'platform' selectorType is supported (Enterprise ATT&CK focus)");
  const techniqueIds = mitreKnowledgeGraph.getTechniquesByHybridSelector(selectorType, selectorValue);
  res.json({ techniqueIds, count: techniqueIds.length });
}));

// Graph coverage
router.get("/graph/coverage", asyncHandler(async (req, res) => {
  const mitreVersion = typeof req.query.mitreVersion === "string" ? req.query.mitreVersion : "18.1";
  const localVersion = typeof req.query.localVersion === "string" ? req.query.localVersion : "current";
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const scopeParam = typeof req.query.scope === "string" ? req.query.scope : "detection";
  const scope = scopeParam === "visibility" ? "visibility" : "detection";
  const platformsParam = typeof req.query.platforms === "string" ? req.query.platforms : "";
  const platforms = platformsParam
    ? platformsParam.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  const key = buildCacheKey(["graph-coverage", mitreVersion, localVersion, productId, platforms.join(","), scope]);
  await respondWithCache(
    key,
    30 * 1000,
    async () => ({ coverage: await getGlobalCoverage(mitreVersion, localVersion, productId, platforms, scope) }),
    res
  );
}));

router.get("/graph/coverage/paths", asyncHandler(async (req, res) => {
  const mitreVersion = typeof req.query.mitreVersion === "string" ? req.query.mitreVersion : "18.1";
  const localVersion = typeof req.query.localVersion === "string" ? req.query.localVersion : "current";
  const productId = typeof req.query.productId === "string" ? req.query.productId.trim() : "";
  const techniquesParam = typeof req.query.techniques === "string" ? req.query.techniques : "";
  const techniqueIds = techniquesParam
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 200;
  const safeLimit = Number.isNaN(limit) ? 200 : limit;
  const key = buildCacheKey([
    "graph-coverage-paths",
    mitreVersion,
    localVersion,
    safeLimit,
    productId,
    techniqueIds.join(","),
  ]);
  await respondWithCache(
    key,
    30 * 1000,
    async () => ({
      paths: await getCoveragePaths(
        mitreVersion,
        localVersion,
        safeLimit,
        productId || undefined,
        techniqueIds.length > 0 ? techniqueIds : undefined
      ),
    }),
    res
  );
}));

router.get("/graph/gaps", asyncHandler(async (req, res) => {
  const mitreVersion = typeof req.query.mitreVersion === "string" ? req.query.mitreVersion : "18.1";
  const localVersion = typeof req.query.localVersion === "string" ? req.query.localVersion : "current";
  const productId = typeof req.query.productId === "string" ? req.query.productId : undefined;
  const platformsParam = typeof req.query.platforms === "string" ? req.query.platforms : "";
  const platforms = platformsParam
    ? platformsParam.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  let productDbId: number | undefined;
  if (productId) {
    const product = await db.select()
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);
    productDbId = product[0]?.id;
  }

  const key = buildCacheKey(["graph-gaps", mitreVersion, localVersion, productId, platforms.join(",")]);
  await respondWithCache(
    key,
    30 * 1000,
    async () => ({ gaps: await getCoverageGaps(mitreVersion, localVersion, productDbId, platforms) }),
    res
  );
}));

export default router;
