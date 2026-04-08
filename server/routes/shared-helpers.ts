import type { Request, Response } from "express";
import { storage } from "../storage";
import { mitreKnowledgeGraph } from "../mitre-stix";
import { normalizePlatformList, platformMatchesAny } from "../../shared/platforms";
import { PLATFORM_VALUES } from "../../shared/platforms";
import { getCache, setCache, buildCacheKey } from "../utils/cache";
import { db } from "../db";
import { products } from "@shared/schema";
import { eq } from "drizzle-orm";

/**
 * Resolve the owner (createdBy) of a product from req.params.productId.
 * Returns null if the product doesn't exist or has no owner.
 */
export async function resolveProductOwner(req: Request): Promise<string | null> {
  const productId = req.params.productId || req.body?.productId;
  if (!productId || typeof productId !== "string") return null;
  const row = await db.select({ createdBy: products.createdBy })
    .from(products)
    .where(eq(products.productId, productId))
    .limit(1);
  return row[0]?.createdBy ?? null;
}

export const UI_PLATFORM_OPTIONS = PLATFORM_VALUES;

export const buildShortDescription = (description: string): string => {
  const trimmed = description.trim();
  if (!trimmed) return "";
  const match = trimmed.match(/^[^.!?]+[.!?]/);
  if (match) return match[0].trim();
  if (trimmed.length <= 200) return trimmed;
  return `${trimmed.slice(0, 200).trim()}...`;
};

export const extractExamples = (description: string): string[] => {
  const trimmed = description.trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const idx = lower.indexOf("examples:");
  if (idx === -1) return [];
  const remainder = trimmed.slice(idx + "examples:".length).trim();
  if (!remainder) return [];
  const snippet = remainder.slice(0, 400);
  const lines = snippet
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items: string[] = [];
  const pushItem = (value: string) => {
    const cleaned = value.replace(/^[-*]\s+/, "").trim();
    if (!cleaned) return;
    items.push(cleaned);
  };

  if (lines.length <= 1) {
    const parts = snippet
      .split(/[\.;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    for (const part of parts) {
      pushItem(part);
      if (items.length >= 3) break;
    }
  } else {
    for (const line of lines) {
      pushItem(line);
      if (items.length >= 3) break;
    }
  }

  return items;
};

export const attachLogSources = async <T extends { id: string; name: string }>(components: T[]) => {
  if (!components.length) return components;
  let stored = await storage.getDataComponentsByComponentIds(components.map((component) => component.id));
  if (stored.length === 0) {
    stored = await storage.getAllDataComponents();
  }
  const byId = new Map(stored.map((item) => [item.componentId.toLowerCase(), item.logSources || []]));
  const byName = new Map(stored.map((item) => [item.name.toLowerCase(), item.logSources || []]));
  return components.map((component) => ({
    ...component,
    logSources: byId.get(component.id.toLowerCase()) || byName.get(component.name.toLowerCase()) || [],
  }));
};

export const attachDetectionStrategies = <T extends { id: string; name: string }>(components: T[]) => {
  if (!components.length) return components;
  return components.map((component) => ({
    ...component,
    detectionStrategies: mitreKnowledgeGraph.getDetectionStrategiesForDataComponent(component.id),
  }));
};

export const getDataComponentsForPlatforms = async (
  platforms: string[],
  includeDeprecated: boolean,
  includeUnscoped: boolean
) => {
  const normalizedPlatforms = normalizePlatformList(platforms);
  let mappedComponentIds: Set<string> | null = null;
  let mappingAvailable = false;
  if (normalizedPlatforms.length > 0) {
    try {
      const mappingCount = await storage.getDataComponentPlatformCount();
      if (mappingCount > 0) {
        mappingAvailable = true;
        const ids = await storage.getDataComponentIdsForPlatforms(normalizedPlatforms);
        mappedComponentIds = new Set(ids.map((id) => id.toLowerCase()));
      }
    } catch (error) {
      console.warn("Failed to load data component platform map, falling back to graph traversal.", error);
    }
  }
  let graphReady = true;
  try {
    await mitreKnowledgeGraph.ensureInitialized();
  } catch (error) {
    graphReady = false;
    console.warn("MITRE graph unavailable, falling back to stored data components.", error);
  }

  const baseComponents = graphReady
    ? mitreKnowledgeGraph.getAllDataComponents()
      .filter((dc) => includeDeprecated || (!dc.revoked && !dc.deprecated))
    : [];

  let fallbackReason: "none" | "no_detection_content" | "graph_unavailable" | "no_platform_matches" = "none";
  let unscopedIncluded = false;
  let filtered: typeof baseComponents = baseComponents;

  if (!graphReady && normalizedPlatforms.length > 0) {
    fallbackReason = "graph_unavailable";
    filtered = [];
  } else if (graphReady && normalizedPlatforms.length > 0) {
    const derivedFromMap = mappingAvailable && mappedComponentIds
      ? baseComponents.filter((dc) => mappedComponentIds.has(dc.id.toLowerCase()))
      : [];
    const derivedFromGraph = mitreKnowledgeGraph
      .getDataComponentsForPlatformsViaTechniques(normalizedPlatforms)
      .filter((dc) => includeDeprecated || (!dc.revoked && !dc.deprecated));
    const derivedById = new Map<string, typeof baseComponents[number]>();
    derivedFromMap.forEach((dc) => derivedById.set(dc.id.toLowerCase(), dc));
    derivedFromGraph.forEach((dc) => {
      if (!derivedById.has(dc.id.toLowerCase())) {
        derivedById.set(dc.id.toLowerCase(), dc);
      }
    });
    const derived = Array.from(derivedById.values());

    const directMatches = baseComponents.filter((dc) => {
      const platformList = Array.isArray(dc.platforms) ? dc.platforms : [];
      if (platformList.length === 0) return false;
      return platformMatchesAny(platformList, normalizedPlatforms);
    });
    const mergedById = new Map<string, typeof baseComponents[number]>();
    derived.forEach((dc) => mergedById.set(dc.id.toLowerCase(), dc));
    directMatches.forEach((dc) => {
      if (!mergedById.has(dc.id.toLowerCase())) {
        mergedById.set(dc.id.toLowerCase(), dc);
      }
    });
    filtered = Array.from(mergedById.values());

    if (filtered.length === 0) {
      fallbackReason = "no_detection_content";
      if (includeUnscoped) {
        filtered = baseComponents;
        unscopedIncluded = true;
      } else if (normalizedPlatforms.length > 0) {
        fallbackReason = "no_detection_content";
      }
    }
  }

  const hasDerivedScope = normalizedPlatforms.length > 0 && !unscopedIncluded && filtered.length > 0;
  let components = filtered.map((dc) => {
    const platformList = dc.platforms || [];
    const description = dc.description || "";
    return {
      id: dc.id,
      name: dc.name,
      description,
      shortDescription: buildShortDescription(description),
      examples: extractExamples(description),
      dataSourceId: dc.dataSourceId,
      dataSourceName: dc.dataSourceName,
      platforms: platformList,
      domains: dc.domains,
      revoked: dc.revoked,
      deprecated: dc.deprecated,
      relevanceScore: hasDerivedScope
        ? 1
        : platformMatchesAny(platformList, normalizedPlatforms) ? 1 : 0,
    };
  });

  if (components.length === 0) {
    const allowUnscopedFallback = includeUnscoped
      && (fallbackReason === "no_detection_content" || fallbackReason === "graph_unavailable");
    if (!allowUnscopedFallback) {
      return {
        components,
        meta: {
          total: baseComponents.length,
          withPlatforms: baseComponents.filter((dc) => (dc.platforms || []).length > 0).length,
          matched: components.length,
          fallbackReason,
          unscopedIncluded,
        },
      };
    }

    const stored = await storage.getAllDataComponents();
    components = stored
      .filter((dc) => includeDeprecated || (!dc.revoked && !dc.deprecated))
      .map((dc) => {
        const description = dc.description || "";
        return {
          id: dc.componentId,
          name: dc.name,
          description,
          shortDescription: buildShortDescription(description),
          examples: extractExamples(description),
          dataSourceId: dc.dataSourceId || "",
          dataSourceName: dc.dataSourceName || "",
          platforms: [] as string[],
          domains: dc.domains || [],
          revoked: dc.revoked,
          deprecated: dc.deprecated,
          relevanceScore: 0,
        };
      });
    unscopedIncluded = true;
  }

  components = await attachLogSources(components);
  components = attachDetectionStrategies(components);

  return {
    components,
    meta: {
      total: baseComponents.length,
      withPlatforms: baseComponents.filter((dc) => (dc.platforms || []).length > 0).length,
      matched: components.length,
      fallbackReason,
      unscopedIncluded,
    },
  };
};

export const respondWithCache = async <T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  res: Response
) => {
  const cached = getCache<T>(key);
  if (cached) {
    return res.json(cached);
  }
  const data = await fetcher();
  setCache(key, data, ttlMs);
  return res.json(data);
};

export { buildCacheKey, normalizePlatformList, platformMatchesAny, PLATFORM_VALUES };
