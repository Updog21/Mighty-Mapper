import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { NotFoundError, ValidationError } from "../errors";
import { insertProductSchema, settings } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { mitreKnowledgeGraph } from "../mitre-stix";
import { productService, adminService, rebuildDetectionsIndex, geminiMappingService, settingsService } from "../services";
import { aiProviderService } from "../services/ai-provider-service";
import { db } from "../db";
import { inArray } from "drizzle-orm";
import { respondWithCache, buildCacheKey } from "./shared-helpers";

const router = Router();

// Get all products (with optional source filter)
router.get("/products", requireAuth, asyncHandler(async (req, res) => {
  const source = req.query.source as string | undefined;
  if (source) {
    const prods = await productService.getProductsBySource(source);
    res.json(prods);
  } else {
    const prods = await productService.getAllProducts();
    res.json(prods);
  }
}));

// Search products with alias resolution
router.get("/products/search", requireAuth, asyncHandler(async (req, res) => {
  const query = req.query.q as string;
  const results = await productService.searchProducts(query || "");
  res.json(results);
}));

// Resolve search terms for a product
router.get("/products/resolve/:query", requireAuth, asyncHandler(async (req, res) => {
  const { query } = req.params;
  const resolved = await productService.resolveSearchTerms(query);
  if (!resolved) throw new NotFoundError("Could not resolve product");
  res.json(resolved);
}));

// Create a custom product
router.post("/products", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const validation = insertProductSchema.safeParse(req.body);
  if (!validation.success) throw new ValidationError(fromZodError(validation.error).toString());
  const autoMap = req.query.autoMap !== "false";
  const product = await productService.createProduct(validation.data, { autoMap });
  res.status(201).json(product);
}));

// Update a product
router.patch("/products/:productId", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const updated = await productService.updateProduct(productId, req.body);
  if (!updated) throw new NotFoundError("Product not found");
  res.json(updated);
}));

// Delete a product
router.delete("/products/:productId", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const deleted = await productService.deleteProduct(productId);
  if (!deleted) throw new NotFoundError("Product not found");
  res.json({ message: "Product deleted successfully" });
}));

// ── Alias Management ──

router.get("/aliases", requireAuth, asyncHandler(async (_req, res) => {
  const aliases = await productService.getAllAliases();
  res.json(aliases);
}));

router.post("/aliases", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { productId, productName, alias, confidence } = req.body;
  if (!alias) throw new ValidationError("alias is required");
  if (!productId && !productName) throw new ValidationError("Either productId (number) or productName (string) is required");
  let newAlias;
  if (typeof productId === "number") {
    newAlias = await productService.addAlias(productId, alias, confidence || 100);
  } else if (productName) {
    newAlias = await productService.addAliasByName(productName, alias, confidence || 100);
    if (!newAlias) throw new NotFoundError(`Product "${productName}" not found`);
  }
  res.status(201).json(newAlias);
}));

router.post("/aliases/bulk", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { aliases } = req.body;
  if (!Array.isArray(aliases)) throw new ValidationError("Expected array of aliases");
  await productService.bulkAddAliases(aliases);
  res.status(201).json({ message: "Aliases added successfully" });
}));

router.delete("/aliases/:aliasId", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const aliasId = parseInt(req.params.aliasId, 10);
  if (isNaN(aliasId)) throw new ValidationError("Invalid alias ID");
  const deleted = await productService.deleteAlias(aliasId);
  if (!deleted) throw new NotFoundError("Alias not found");
  res.json({ message: "Alias deleted successfully" });
}));

router.patch("/aliases/:aliasId", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const aliasId = parseInt(req.params.aliasId, 10);
  if (isNaN(aliasId)) throw new ValidationError("Invalid alias ID");
  const { alias, confidence } = req.body;
  if (!alias) throw new ValidationError("alias is required");
  const updated = await productService.updateAlias(aliasId, alias, confidence);
  if (!updated) throw new NotFoundError("Alias not found");
  res.json(updated);
}));

// ── Maintenance ──

router.get("/status", requireAuth, asyncHandler(async (_req, res) => {
  const key = buildCacheKey(["admin-status"]);
  await respondWithCache(
    key,
    30 * 1000,
    async () => {
      const [prods, aliases, repoStatus, lastMitreSync, startupLog] = await Promise.all([
        productService.getAllProducts(),
        productService.getAllAliases(),
        adminService.getRepoStatus(),
        adminService.getLastMitreSync(),
        adminService.getStartupLog()
      ]);
      const stixStats = mitreKnowledgeGraph.getStats();
      return {
        products: {
          total: prods.length,
          bySource: {
            ctid: prods.filter(p => p.source === "ctid").length,
            custom: prods.filter(p => p.source === "custom").length,
            "ai-pending": prods.filter(p => p.source === "ai-pending").length
          }
        },
        aliases: aliases.length,
        stix: stixStats,
        sigma: repoStatus.sigma,
        repos: repoStatus,
        lastMitreSync,
        startupLog,
        timestamp: new Date().toISOString()
      };
    },
    res
  );
}));

router.get("/ai-keys/gemini", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const records = await db
    .select({ key: settings.key, value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(inArray(settings.key, [
      "gemini_api_key", "gemini_model", "gemini_temperature", "gemini_top_p",
      "gemini_top_k", "gemini_seed", "gemini_max_output_tokens",
      "gemini_dc_pipeline_mode", "gemini_dc_require_legacy_parity",
      "gemini_dc_cache_enabled", "gemini_dc_cache_ttl", "gemini_dc_policy_version",
    ]));
  const recordMap = new Map(records.map((record) => [record.key, record]));
  const resolveValue = (key: string, envKey: string, defaultValue?: string) => {
    const record = recordMap.get(key);
    if (record?.value) return { value: record.value, source: "database" as const };
    const envValue = process.env[envKey];
    if (envValue) return { value: envValue, source: "environment" as const };
    if (defaultValue !== undefined) return { value: defaultValue, source: "default" as const };
    return { value: null, source: "none" as const };
  };
  const keyRecord = recordMap.get("gemini_api_key");
  const modelRecord = recordMap.get("gemini_model");
  const envKey = process.env.GEMINI_API_KEY;
  const envModel = process.env.GEMINI_MODEL;
  const configured = Boolean(keyRecord?.value || envKey);
  const source = keyRecord?.value ? "database" : envKey ? "environment" : "none";
  const updatedAt = keyRecord?.value ? keyRecord.updatedAt?.toISOString() : null;
  const model = modelRecord?.value || envModel || "gemini-1.5-flash";
  const modelSource = modelRecord?.value ? "database" : envModel ? "environment" : "default";
  const generation = {
    temperature: resolveValue("gemini_temperature", "GEMINI_TEMPERATURE", "0.1"),
    topP: resolveValue("gemini_top_p", "GEMINI_TOP_P", "1"),
    topK: resolveValue("gemini_top_k", "GEMINI_TOP_K", "40"),
    seed: resolveValue("gemini_seed", "GEMINI_SEED"),
    maxOutputTokens: resolveValue("gemini_max_output_tokens", "GEMINI_MAX_OUTPUT_TOKENS"),
  };
  const mappingPipeline = {
    mode: resolveValue("gemini_dc_pipeline_mode", "GEMINI_DC_PIPELINE_MODE", "legacy"),
    requireLegacyParity: resolveValue("gemini_dc_require_legacy_parity", "GEMINI_DC_REQUIRE_LEGACY_PARITY", "true"),
    cacheEnabled: resolveValue("gemini_dc_cache_enabled", "GEMINI_DC_CACHE_ENABLED", "true"),
    cacheTtl: resolveValue("gemini_dc_cache_ttl", "GEMINI_DC_CACHE_TTL", "43200s"),
    policyVersion: resolveValue("gemini_dc_policy_version", "GEMINI_DC_POLICY_VERSION", "v1"),
  };
  res.json({ configured, source, updatedAt, model, modelSource, generation, mappingPipeline });
}));

router.post("/ai-keys/gemini", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
  const parseNumber = (value: unknown, field: string) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim().length === 0) return undefined;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(parsed)) throw new ValidationError(`Invalid ${field} value`);
    return String(parsed);
  };
  const temperature = parseNumber(req.body?.temperature, "temperature");
  const topP = parseNumber(req.body?.topP, "topP");
  const topK = parseNumber(req.body?.topK, "topK");
  const seed = parseNumber(req.body?.seed, "seed");
  const maxOutputTokens = parseNumber(req.body?.maxOutputTokens, "maxOutputTokens");
  const pipelineMode = typeof req.body?.pipelineMode === "string" ? req.body.pipelineMode.trim().toLowerCase() : "";
  const pipelineModeNormalized = ["legacy", "shadow", "optimized"].includes(pipelineMode) ? pipelineMode : "";
  const parseBoolean = (value: unknown) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value ? "true" : "false";
    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return "true";
    if (["false", "0", "no", "n", "off"].includes(normalized)) return "false";
    throw new ValidationError("Invalid boolean setting");
  };
  const requireLegacyParity = parseBoolean(req.body?.requireLegacyParity);
  const cacheEnabled = parseBoolean(req.body?.cacheEnabled);
  const cacheTtl = typeof req.body?.cacheTtl === "string" && req.body.cacheTtl.trim().length > 0
    ? req.body.cacheTtl.trim() : undefined;
  const policyVersion = typeof req.body?.policyVersion === "string" && req.body.policyVersion.trim().length > 0
    ? req.body.policyVersion.trim() : undefined;

  if (!apiKey && !model && !temperature && !topP && !topK && !seed && !maxOutputTokens
    && !pipelineModeNormalized && !requireLegacyParity && !cacheEnabled && !cacheTtl && !policyVersion) {
    throw new ValidationError("Provide apiKey, model, generation settings, or mapping pipeline settings to update.");
  }
  if (apiKey) await settingsService.set("gemini_api_key", apiKey);
  if (model) await settingsService.set("gemini_model", model);
  if (temperature !== undefined) await settingsService.set("gemini_temperature", temperature);
  if (topP !== undefined) await settingsService.set("gemini_top_p", topP);
  if (topK !== undefined) await settingsService.set("gemini_top_k", topK);
  if (seed !== undefined) await settingsService.set("gemini_seed", seed);
  if (maxOutputTokens !== undefined) await settingsService.set("gemini_max_output_tokens", maxOutputTokens);
  if (pipelineModeNormalized) await settingsService.set("gemini_dc_pipeline_mode", pipelineModeNormalized);
  if (requireLegacyParity !== undefined) await settingsService.set("gemini_dc_require_legacy_parity", requireLegacyParity);
  if (cacheEnabled !== undefined) await settingsService.set("gemini_dc_cache_enabled", cacheEnabled);
  if (cacheTtl !== undefined) await settingsService.set("gemini_dc_cache_ttl", cacheTtl);
  if (policyVersion !== undefined) await settingsService.set("gemini_dc_policy_version", policyVersion);
  res.json({ status: "ok" });
}));

router.post("/ai-keys/gemini/test", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : undefined;
  const result = await geminiMappingService.testKey(apiKey, model);
  if (!result) throw new ValidationError("Gemini API key is not configured.");
  res.json(result);
}));

router.get("/ai-settings", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const records = await db
    .select({ key: settings.key, updatedAt: settings.updatedAt })
    .from(settings)
    .where(inArray(settings.key, [
      "ai_provider", "gemini_api_key", "gemini_model", "openai_api_key", "openai_model",
    ]));
  const recordMap = new Map(records.map((record) => [record.key, record]));
  const activeProvider = await aiProviderService.getActiveProvider();
  const geminiKey = await settingsService.getGeminiKey();
  const openaiKey = await settingsService.getOpenAIKey();
  const geminiModel = await settingsService.getGeminiModel();
  const openaiModel = await settingsService.getOpenAIModel();
  res.json({
    activeProvider,
    providerSource: recordMap.has("ai_provider") ? "database" : process.env.AI_PROVIDER ? "environment" : "default",
    gemini: {
      configured: Boolean(geminiKey),
      source: recordMap.has("gemini_api_key") ? "database" : process.env.GEMINI_API_KEY ? "environment" : "none",
      updatedAt: recordMap.get("gemini_api_key")?.updatedAt?.toISOString() || null,
      model: geminiModel,
      modelSource: recordMap.has("gemini_model") ? "database" : process.env.GEMINI_MODEL ? "environment" : "default",
    },
    openai: {
      configured: Boolean(openaiKey),
      source: recordMap.has("openai_api_key") ? "database" : process.env.OPENAI_API_KEY ? "environment" : "none",
      updatedAt: recordMap.get("openai_api_key")?.updatedAt?.toISOString() || null,
      model: openaiModel,
      modelSource: recordMap.has("openai_model") ? "database" : process.env.OPENAI_MODEL ? "environment" : "default",
    },
  });
}));

router.post("/ai-settings", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const provider = typeof req.body?.activeProvider === "string"
    ? req.body.activeProvider.trim().toLowerCase() : "";
  if (provider !== "gemini" && provider !== "openai") throw new ValidationError("activeProvider must be 'gemini' or 'openai'.");
  await aiProviderService.setActiveProvider(provider);
  res.json({ status: "ok", activeProvider: provider });
}));

router.get("/ai-keys/openai", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const records = await db
    .select({ key: settings.key, value: settings.value, updatedAt: settings.updatedAt })
    .from(settings)
    .where(inArray(settings.key, [
      "openai_api_key", "openai_model", "openai_temperature", "openai_top_p", "openai_max_output_tokens",
    ]));
  const recordMap = new Map(records.map((record) => [record.key, record]));
  const resolveValue = (key: string, envKey: string, defaultValue?: string) => {
    const record = recordMap.get(key);
    if (record?.value) return { value: record.value, source: "database" as const };
    const envValue = process.env[envKey];
    if (envValue) return { value: envValue, source: "environment" as const };
    if (defaultValue !== undefined) return { value: defaultValue, source: "default" as const };
    return { value: null, source: "none" as const };
  };
  const keyRecord = recordMap.get("openai_api_key");
  const modelRecord = recordMap.get("openai_model");
  const envKey = process.env.OPENAI_API_KEY;
  const envModel = process.env.OPENAI_MODEL;
  const configured = Boolean(keyRecord?.value || envKey);
  const source = keyRecord?.value ? "database" : envKey ? "environment" : "none";
  const updatedAt = keyRecord?.value ? keyRecord.updatedAt?.toISOString() : null;
  const model = modelRecord?.value || envModel || "gpt-4o-mini";
  const modelSource = modelRecord?.value ? "database" : envModel ? "environment" : "default";
  const generation = {
    temperature: resolveValue("openai_temperature", "OPENAI_TEMPERATURE", "0.1"),
    topP: resolveValue("openai_top_p", "OPENAI_TOP_P", "1"),
    maxOutputTokens: resolveValue("openai_max_output_tokens", "OPENAI_MAX_OUTPUT_TOKENS"),
  };
  res.json({ configured, source, updatedAt, model, modelSource, generation });
}));

router.post("/ai-keys/openai", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
  const parseNumber = (value: unknown, field: string) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim().length === 0) return undefined;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isFinite(parsed)) throw new ValidationError(`Invalid ${field} value`);
    return String(parsed);
  };
  const temperature = parseNumber(req.body?.temperature, "temperature");
  const topP = parseNumber(req.body?.topP, "topP");
  const maxOutputTokens = parseNumber(req.body?.maxOutputTokens, "maxOutputTokens");
  if (!apiKey && !model && !temperature && !topP && !maxOutputTokens) {
    throw new ValidationError("Provide apiKey, model, or generation settings to update.");
  }
  if (apiKey) await settingsService.set("openai_api_key", apiKey);
  if (model) await settingsService.set("openai_model", model);
  if (temperature !== undefined) await settingsService.set("openai_temperature", temperature);
  if (topP !== undefined) await settingsService.set("openai_top_p", topP);
  if (maxOutputTokens !== undefined) await settingsService.set("openai_max_output_tokens", maxOutputTokens);
  res.json({ status: "ok" });
}));

router.post("/ai-keys/openai/test", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : undefined;
  const model = typeof req.body?.model === "string" ? req.body.model.trim() : undefined;
  const result = await aiProviderService.testOpenAIKey(apiKey, model);
  if (!result) throw new ValidationError("OpenAI API key is not configured.");
  res.json(result);
}));

// ── Repo / DB / MITRE Maintenance ──

router.post("/maintenance/refresh-sigma", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.smartRefreshSigmaRules();
  res.json(result);
}));

router.post("/maintenance/refresh-splunk", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.smartRefreshRepo("splunk");
  res.json(result);
}));

router.post("/maintenance/refresh-elastic", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.smartRefreshRepo("elastic");
  res.json(result);
}));

router.post("/maintenance/refresh-azure", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.smartRefreshRepo("azure");
  res.json(result);
}));

router.post("/maintenance/refresh-ctid", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.smartRefreshRepo("ctid");
  res.json(result);
}));

router.post("/maintenance/rebuild-detections-index", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await rebuildDetectionsIndex();
  res.json({
    message: `Detection index rebuilt with ${result.indexed} entries.`,
    ...result,
  });
}));

router.post("/maintenance/db-push", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.runDbPush();
  res.json(result);
}));

router.post("/maintenance/db-seed", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.runDbSeed();
  res.json(result);
}));

router.post("/maintenance/refresh-mitre", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const result = await adminService.syncMitreData("manual");
  res.json(result);
}));

export default router;
