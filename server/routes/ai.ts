import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { ValidationError } from "../errors";
import { storage } from "../storage";
import { mitreKnowledgeGraph } from "../mitre-stix";
import { getChannelsForDCs } from "../mitre-stix/channel-aggregator";
import { geminiMappingService, geminiResearchService } from "../services";
import { getDataComponentsForPlatforms, normalizePlatformList } from "./shared-helpers";

const router = Router();

router.post("/gemini/data-components", requireAuth, requireRole("admin", "user"), asyncHandler(async (req, res) => {
  const { vendor, product, description, platforms, aliases } = req.body || {};
  if (!Array.isArray(platforms) || platforms.length === 0) {
    throw new ValidationError("platforms must be a non-empty array");
  }

  const normalizedPlatforms = normalizePlatformList(
    platforms.map((item: string) => item.trim()).filter(Boolean)
  );
  const { components: candidates } = await getDataComponentsForPlatforms(normalizedPlatforms, false, false);

  if (candidates.length === 0) {
    throw new ValidationError("No data components available for the selected platforms.");
  }

  await mitreKnowledgeGraph.ensureInitialized();
  const channelAggregations = await getChannelsForDCs(candidates.map((candidate) => candidate.name));

  const result = await geminiMappingService.suggestDataComponents({
    vendor,
    product,
    description,
    aliases: Array.isArray(aliases) ? aliases : undefined,
    platforms: normalizedPlatforms,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      description: candidate.shortDescription || candidate.description,
      dataSourceName: candidate.dataSourceName,
      examples: candidate.examples || [],
      mutableElements: (channelAggregations[candidate.name]?.mutableElements || []).map((element) => element.field),
      logSourceHints: (() => {
        const hints: Array<{ name: string; channel?: string }> = [];
        const rawCandidateSources = Array.isArray((candidate as { logSources?: unknown }).logSources)
          ? (candidate as { logSources?: Array<{ name?: string; channel?: string }> }).logSources || []
          : [];
        rawCandidateSources.forEach((source) => {
          const name = source?.name?.trim();
          if (!name) return;
          const channel = source?.channel?.toString().trim();
          hints.push({ name, channel: channel || undefined });
        });
        (channelAggregations[candidate.name]?.logSources || []).forEach((source) => {
          if (!source?.name) return;
          hints.push({
            name: source.name,
            channel: source.channel,
          });
        });
        const seen = new Set<string>();
        return hints.filter((hint) => {
          const key = `${hint.name.toLowerCase()}|${(hint.channel || '').toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 8);
      })(),
    })),
  });

  if (!result) {
    throw new ValidationError("Gemini API key is not configured.");
  }

  res.json({
    suggestedIds: result.suggestedIds,
    notes: result.notes,
    metrics: result.metrics,
    candidateCount: candidates.length,
    evaluatedCount: result.evaluatedCount,
    decisions: result.decisions,
    sources: result.sources,
    debug: {
      platforms: normalizedPlatforms,
      candidateIds: candidates.map((candidate) => candidate.id),
    },
  });
}));

// Intentional: returns graceful fallback JSON on error instead of 500
router.post("/research/platforms", requireAuth, requireRole("admin", "user"), async (req, res) => {
  try {
    const { vendor, product, description, platforms, aliases } = req.body || {};
    const normalizedPlatforms = Array.isArray(platforms)
      ? normalizePlatformList(platforms.map((item: string) => item.trim()).filter(Boolean))
      : [];
    const aliasList = Array.isArray(aliases)
      ? aliases.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (!vendor && !product && aliasList.length === 0) {
      return res.status(400).json({ error: "vendor, product, or alias is required", status: 400 });
    }

    const result = await geminiResearchService.suggestPlatforms({
      vendor,
      product,
      description,
      aliases: aliasList,
      platforms: normalizedPlatforms,
    });

    if (!result) {
      return res.status(400).json({
        error: "Online research is not configured. Set GEMINI_API_KEY.",
        status: 400,
      });
    }

    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error running platform research:", error);
    res.json({
      model: "unknown",
      suggestedPlatforms: [],
      validation: [],
      alternativePlatformsFound: [],
      sources: [],
      note: `Platform research returned no results: ${message}`,
    });
  }
});

router.post("/research/log-sources", requireAuth, requireRole("admin", "user"), asyncHandler(async (req, res) => {
  const { vendor, product, description, platforms, aliases, dataComponentIds, dataComponentNames } = req.body || {};
  const ids = Array.isArray(dataComponentIds)
    ? dataComponentIds.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const names = Array.isArray(dataComponentNames)
    ? dataComponentNames.filter((item: unknown): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  const dcHints = Array.from(new Set([...ids, ...names]));
  if (dcHints.length === 0) throw new ValidationError("Select at least one data component to research.");

  await mitreKnowledgeGraph.ensureInitialized();
  const resolved = mitreKnowledgeGraph.resolveDataComponentsFromHints(dcHints);
  if (resolved.length === 0) throw new ValidationError("No matching data components found for the request.");

  const channelAggregations = await getChannelsForDCs(resolved.map((dc) => dc.name));
  let storedComponents = await storage.getDataComponentsByComponentIds(resolved.map((dc) => dc.id));
  if (storedComponents.length === 0) {
    storedComponents = await storage.getAllDataComponents();
  }
  const storedById = new Map(storedComponents.map((component) => [component.componentId.toLowerCase(), (component.logSources || []) as any[]]));
  const storedByName = new Map(storedComponents.map((component) => [component.name.toLowerCase(), (component.logSources || []) as any[]]));

  const normalizedPlatforms = Array.isArray(platforms)
    ? normalizePlatformList(platforms.map((item: string) => item.trim()).filter(Boolean))
    : [];

  const result = await geminiResearchService.enrichLogSources({
    vendor,
    product,
    description,
    aliases: Array.isArray(aliases) ? aliases : undefined,
    platforms: normalizedPlatforms,
    dataComponents: resolved.map((dc) => ({
      id: dc.id,
      name: dc.name,
      dataSourceName: dc.dataSourceName,
      description: dc.description,
      mutableElements: (channelAggregations[dc.name]?.mutableElements || []).map((element) => element.field),
      logSourceHints: (() => {
        const hints: Array<{ name: string; channel?: string }> = [];
        const rawCandidateSources =
          storedById.get(dc.id.toLowerCase()) || storedByName.get(dc.name.toLowerCase()) || [];
        rawCandidateSources.forEach((source: any) => {
          const name = typeof source?.name === 'string' ? source.name.trim() : '';
          if (!name) return;
          const channel = typeof source?.channel === 'string' ? source.channel.trim() : '';
          hints.push({ name, channel: channel || undefined });
        });
        (channelAggregations[dc.name]?.logSources || []).forEach((source) => {
          if (!source?.name) return;
          hints.push({
            name: source.name,
            channel: source.channel,
          });
        });
        const seen = new Set<string>();
        return hints.filter((hint) => {
          const key = `${hint.name.toLowerCase()}|${(hint.channel || '').toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 8);
      })(),
    })),
  });

  if (!result) {
    throw new ValidationError("Online research is not configured. Set GEMINI_API_KEY.");
  }

  res.json(result);
}));

export default router;
