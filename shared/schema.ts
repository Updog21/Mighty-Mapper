import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, timestamp, jsonb, integer, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const productTypeEnum = ['cloud', 'network', 'endpoint', 'siem', 'identity', 'database', 'web', 'abstract'] as const;
export type ProductType = typeof productTypeEnum[number];
export const mappingStatusEnum = ['matched', 'partial', 'ai_pending', 'not_found'] as const;
export type MappingStatus = typeof mappingStatusEnum[number];
export const resourceTypeEnum = ['ctid', 'sigma', 'elastic', 'splunk', 'azure', 'mitre_stix'] as const;
export type ResourceType = typeof resourceTypeEnum[number];
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const hybridSelectorTypeEnum = ['platform'] as const;
export type HybridSelectorType = typeof hybridSelectorTypeEnum[number];
export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  productId: text("product_id").notNull().unique(),
  vendor: text("vendor").notNull(),
  productName: text("product_name").notNull(),
  deployment: text("deployment"),
  description: text("description").notNull(),
  platforms: text("platforms").array().notNull(),
  productType: text("product_type"),
  capabilityTags: text("capability_tags").array(),
  dataComponentIds: text("data_component_ids").array().notNull(),
  mitreAssetIds: text("mitre_asset_ids").array(),
  source: text("source").notNull(),
  logoPath: text("logo_path"),  // Path to product logo image
  hybridSelectorType: text("hybrid_selector_type"),
  hybridSelectorValues: text("hybrid_selector_values").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const dataComponents = pgTable("data_components", {
  id: serial("id").primaryKey(),
  componentId: text("component_id").notNull().unique(),
  name: text("name").notNull(),
  dataSourceId: text("data_source_id"),
  dataSourceName: text("data_source_name"),
  description: text("description").notNull(),
  domains: text("domains").array().notNull().default(sql`'{}'::text[]`),
  revoked: boolean("revoked").notNull().default(false),
  deprecated: boolean("deprecated").notNull().default(false),
  dataCollectionMeasures: text("data_collection_measures").array().notNull().default(sql`'{}'::text[]`),
  logSources: jsonb("log_sources").notNull().default('[]'),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const detectionStrategies = pgTable("detection_strategies", {
  id: serial("id").primaryKey(),
  strategyId: text("strategy_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const validationStatusEnum = ['pending', 'valid', 'invalid', 'uncertain'] as const;
export type ValidationStatus = typeof validationStatusEnum[number];

export const analytics = pgTable("analytics", {
  id: serial("id").primaryKey(),
  analyticId: text("analytic_id").notNull().unique(),
  strategyId: text("strategy_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  pseudocode: text("pseudocode"),
  dataComponentIds: text("data_component_ids").array().default(sql`'{}'::text[]`),
  logSources: jsonb("log_sources").default('[]'),
  mutableElements: jsonb("mutable_elements").default('[]'),
  validationStatus: text("validation_status").default('pending'),
  aiConfidence: integer("ai_confidence").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const mitreAssets = pgTable("mitre_assets", {
  id: serial("id").primaryKey(),
  assetId: text("asset_id").notNull().unique(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const tactics = pgTable("tactics", {
  id: serial("id").primaryKey(),
  tacticId: text("tactic_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const techniques = pgTable("techniques", {
  id: serial("id").primaryKey(),
  techniqueId: text("technique_id").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isSubtechnique: boolean("is_subtechnique").notNull(),
  tactics: text("tactics").array().notNull().default(sql`'{}'::text[]`),
  platforms: text("platforms").array().notNull().default(sql`'{}'::text[]`),
  detectionStrategyIds: text("detection_strategy_ids").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export const resourceCache = pgTable("resource_cache", {
  id: serial("id").primaryKey(),
  resourceType: text("resource_type").notNull(),
  resourceKey: text("resource_key").notNull(),
  payload: jsonb("payload").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
export const productMappings = pgTable("product_mappings", {
  id: serial("id").primaryKey(),
  productId: text("product_id").notNull(),
  resourceType: text("resource_type").notNull(),
  status: text("status").notNull(),
  confidence: integer("confidence"),
  detectionStrategyIds: text("detection_strategy_ids").array().default(sql`'{}'::text[]`),
  analyticIds: text("analytic_ids").array().default(sql`'{}'::text[]`),
  dataComponentIds: text("data_component_ids").array().default(sql`'{}'::text[]`),
  rawMapping: jsonb("raw_mapping"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const ssmCapabilities = pgTable("ssm_capabilities", {
  id: serial("id").primaryKey(),
  productId: text("product_id").notNull(),
  capabilityGroupId: text("capability_group_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  platform: text("platform").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ssmMappings = pgTable("ssm_mappings", {
  id: serial("id").primaryKey(),
  capabilityId: integer("capability_id")
    .notNull()
    .references(() => ssmCapabilities.id),
  techniqueId: text("technique_id").notNull(),
  techniqueName: text("technique_name").notNull(),
  mappingType: text("mapping_type").notNull(),
  scoreCategory: text("score_category").notNull(),
  scoreValue: text("score_value").notNull(),
  comments: text("comments"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const nodes = pgTable("nodes", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  dataset: text("dataset").notNull(),
  datasetVersion: text("dataset_version"),
  localId: integer("local_id"),
  attributes: jsonb("attributes"),
}, (table) => ({
  datasetLocalIdIdx: index("nodes_dataset_local_id_idx").on(table.dataset, table.localId),
}));

export const edges = pgTable("edges", {
  sourceId: text("source_id").notNull().references(() => nodes.id),
  targetId: text("target_id").notNull().references(() => nodes.id),
  type: text("type").notNull(),
  dataset: text("dataset").notNull(),
  datasetVersion: text("dataset_version"),
  attributes: jsonb("attributes"),
}, (table) => ({
  sourceIdx: index("edges_source_id_idx").on(table.sourceId),
  targetIdx: index("edges_target_id_idx").on(table.targetId),
  datasetSourceIdx: index("edges_dataset_source_idx").on(table.dataset, table.sourceId),
  datasetTargetIdx: index("edges_dataset_target_idx").on(table.dataset, table.targetId),
  datasetTypeIdx: index("edges_dataset_type_idx").on(table.dataset, table.type),
  uniqueRelationshipIdx: uniqueIndex("edges_unique_relationship_idx").on(table.dataset, table.sourceId, table.targetId, table.type),
}));

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertSettingsSchema = createInsertSchema(settings).omit({
  id: true,
  updatedAt: true,
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export const insertDataComponentSchema = createInsertSchema(dataComponents).omit({
  id: true,
  createdAt: true,
});

export const insertDetectionStrategySchema = createInsertSchema(detectionStrategies).omit({
  id: true,
  createdAt: true,
});

export const insertAnalyticSchema = createInsertSchema(analytics).omit({
  id: true,
  createdAt: true,
});

export const insertMitreAssetSchema = createInsertSchema(mitreAssets).omit({
  id: true,
  createdAt: true,
});

export const insertTacticSchema = createInsertSchema(tactics).omit({
  id: true,
  createdAt: true,
});

export const insertTechniqueSchema = createInsertSchema(techniques).omit({
  id: true,
  createdAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;

export type InsertDataComponent = z.infer<typeof insertDataComponentSchema>;
export type DataComponent = typeof dataComponents.$inferSelect;

export type InsertDetectionStrategy = z.infer<typeof insertDetectionStrategySchema>;
export type DetectionStrategy = typeof detectionStrategies.$inferSelect;

export type InsertAnalytic = z.infer<typeof insertAnalyticSchema>;
export type Analytic = typeof analytics.$inferSelect;

export type InsertMitreAsset = z.infer<typeof insertMitreAssetSchema>;
export type MitreAsset = typeof mitreAssets.$inferSelect;

export type InsertTactic = z.infer<typeof insertTacticSchema>;
export type Tactic = typeof tactics.$inferSelect;

export type InsertTechnique = z.infer<typeof insertTechniqueSchema>;
export type Technique = typeof techniques.$inferSelect;

export const insertResourceCacheSchema = createInsertSchema(resourceCache).omit({
  id: true,
  fetchedAt: true,
});

export const insertProductMappingSchema = createInsertSchema(productMappings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNodeSchema = createInsertSchema(nodes);

export const insertEdgeSchema = createInsertSchema(edges);

// Product Aliases table for search term normalization
// Allows "m365" to map to "Microsoft 365", "O365" to "Office 365", etc.
// Uses Foreign Key to products.id for referential integrity
export const productAliases = pgTable("product_aliases", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id), // FK to products.id
  alias: text("alias").notNull().unique(), // e.g., "m365", "O365", "Office365"
  confidence: integer("confidence").default(100), // How sure are we of this alias?
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const productStreams = pgTable("product_streams", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").notNull().references(() => products.id),
  name: text("name").notNull(),
  streamType: text("stream_type").notNull().default("log"),
  config: jsonb("config"),
  metadata: jsonb("metadata"),
  mappedDataComponents: jsonb("mapped_data_components"),
  isConfigured: boolean("is_configured").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertProductAliasSchema = createInsertSchema(productAliases).omit({
  id: true,
  createdAt: true,
});

export const insertProductStreamSchema = createInsertSchema(productStreams).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertResourceCache = z.infer<typeof insertResourceCacheSchema>;
export type ResourceCache = typeof resourceCache.$inferSelect;

export type InsertProductMapping = z.infer<typeof insertProductMappingSchema>;
export type ProductMapping = typeof productMappings.$inferSelect;

export type InsertNode = z.infer<typeof insertNodeSchema>;
export type Node = typeof nodes.$inferSelect;

export type InsertEdge = z.infer<typeof insertEdgeSchema>;
export type Edge = typeof edges.$inferSelect;

export type InsertProductAlias = z.infer<typeof insertProductAliasSchema>;
export type ProductAlias = typeof productAliases.$inferSelect;

export type InsertProductStream = z.infer<typeof insertProductStreamSchema>;
export type ProductStream = typeof productStreams.$inferSelect;

export interface ProductStreamEnrichmentLogSource {
  name: string;
  channel?: string | string[];
  required_fields?: string[];
  missing_fields?: string[];
  evidence?: string;
  notes?: string;
  source_url?: string;
  verified_by_ai?: boolean;
}

export interface ProductStreamEnrichmentResult {
  data_component_id: string;
  data_component_name?: string;
  target_fields?: string[];
  log_sources: ProductStreamEnrichmentLogSource[];
}

export interface ProductStreamMutableElementValue {
  analytic_id: string;
  field: string;
  value: string;
  source_url?: string;
  note?: string;
  updated_at?: string;
}

export interface ProductStreamMetadata {
  fields?: string[];
  mutable_element_values?: ProductStreamMutableElementValue[];
  mutableElementValues?: ProductStreamMutableElementValue[];
  ai_enrichment?: {
    confirmed?: boolean;
    confirmed_at?: string;
    model?: string;
    note?: string;
    results?: ProductStreamEnrichmentResult[];
    platform_suggestions?: Array<{
      platform: string;
      reason?: string;
      evidence?: string;
      source_url?: string;
    }>;
  };
}

export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;
