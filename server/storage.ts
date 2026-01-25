import { 
  type User, 
  type InsertUser, 
  type Product,
  type InsertProduct,
  type DataComponent,
  type InsertDataComponent,
  type DetectionStrategy,
  type InsertDetectionStrategy,
  type Analytic,
  type InsertAnalytic,
  type MitreAsset,
  type InsertMitreAsset,
  users,
  products,
  dataComponents,
  detectionStrategies,
  analytics,
  mitreAssets
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, like, or, sql } from "drizzle-orm";
import { normalizePlatformList } from "../shared/platforms";

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Product operations
  searchProducts(query: string): Promise<Product[]>;
  getProductById(productId: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  bulkCreateProducts(productList: InsertProduct[]): Promise<void>;
  
  // Data Component operations
  getAllDataComponents(): Promise<DataComponent[]>;
  getDataComponentById(componentId: string): Promise<DataComponent | undefined>;
  createDataComponent(component: InsertDataComponent): Promise<DataComponent>;
  bulkCreateDataComponents(components: InsertDataComponent[]): Promise<void>;
  
  // Detection Strategy operations
  getAllDetectionStrategies(): Promise<DetectionStrategy[]>;
  getDetectionStrategyById(strategyId: string): Promise<DetectionStrategy | undefined>;
  createDetectionStrategy(strategy: InsertDetectionStrategy): Promise<DetectionStrategy>;
  bulkCreateDetectionStrategies(strategies: InsertDetectionStrategy[]): Promise<void>;
  
  // Analytic operations
  getAnalyticsByStrategyId(strategyId: string): Promise<Analytic[]>;
  createAnalytic(analytic: InsertAnalytic): Promise<Analytic>;
  bulkCreateAnalytics(analyticList: InsertAnalytic[]): Promise<void>;
  
  // MITRE Asset operations
  getAllMitreAssets(): Promise<MitreAsset[]>;
  getMitreAssetById(assetId: string): Promise<MitreAsset | undefined>;
  createMitreAsset(asset: InsertMitreAsset): Promise<MitreAsset>;
  bulkCreateMitreAssets(assetList: InsertMitreAsset[]): Promise<void>;
  
  // Hybrid Selector operations
  updateProductHybridSelector(productId: string, selectorType: string, selectorValues: string[]): Promise<Product | undefined>;
}

export class PostgresStorage implements IStorage {
  // User management
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username)).limit(1);
    return result[0];
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const result = await db.insert(users).values(insertUser).returning();
    return result[0];
  }

  // Product operations
  async searchProducts(query: string): Promise<Product[]> {
    const searchTerm = `%${query.toLowerCase()}%`;
    return await db.select().from(products).where(
      or(
        sql`LOWER(${products.productName}) LIKE ${searchTerm}`,
        sql`LOWER(${products.vendor}) LIKE ${searchTerm}`,
        sql`LOWER(array_to_string(${products.platforms}, ' ')) LIKE ${searchTerm}`
      )
    );
  }

  async getProductById(productId: string): Promise<Product | undefined> {
    const result = await db.select().from(products).where(eq(products.productId, productId)).limit(1);
    return result[0];
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const normalizedPlatforms = Array.isArray(product.platforms)
      ? normalizePlatformList(product.platforms)
      : [];
    const result = await db.insert(products).values({
      ...product,
      platforms: normalizedPlatforms,
    }).returning();
    return result[0];
  }

  async bulkCreateProducts(productList: InsertProduct[]): Promise<void> {
    if (productList.length > 0) {
      const normalized = productList.map((product) => ({
        ...product,
        platforms: Array.isArray(product.platforms)
          ? normalizePlatformList(product.platforms)
          : [],
      }));
      await db.insert(products).values(normalized).onConflictDoNothing();
    }
  }

  // Data Component operations
  async getAllDataComponents(): Promise<DataComponent[]> {
    return await db.select().from(dataComponents);
  }

  async getDataComponentById(componentId: string): Promise<DataComponent | undefined> {
    const result = await db.select().from(dataComponents).where(eq(dataComponents.componentId, componentId)).limit(1);
    return result[0];
  }

  async createDataComponent(component: InsertDataComponent): Promise<DataComponent> {
    const result = await db.insert(dataComponents).values(component).returning();
    return result[0];
  }

  async bulkCreateDataComponents(components: InsertDataComponent[]): Promise<void> {
    if (components.length > 0) {
      await db.insert(dataComponents).values(components).onConflictDoNothing();
    }
  }

  // Detection Strategy operations
  async getAllDetectionStrategies(): Promise<DetectionStrategy[]> {
    return await db.select().from(detectionStrategies);
  }

  async getDetectionStrategyById(strategyId: string): Promise<DetectionStrategy | undefined> {
    const result = await db.select().from(detectionStrategies).where(eq(detectionStrategies.strategyId, strategyId)).limit(1);
    return result[0];
  }

  async createDetectionStrategy(strategy: InsertDetectionStrategy): Promise<DetectionStrategy> {
    const result = await db.insert(detectionStrategies).values(strategy).returning();
    return result[0];
  }

  async bulkCreateDetectionStrategies(strategies: InsertDetectionStrategy[]): Promise<void> {
    if (strategies.length > 0) {
      await db.insert(detectionStrategies).values(strategies).onConflictDoNothing();
    }
  }

  // Analytic operations
  async getAnalyticsByStrategyId(strategyId: string): Promise<Analytic[]> {
    return await db.select().from(analytics).where(eq(analytics.strategyId, strategyId));
  }

  async createAnalytic(analytic: InsertAnalytic): Promise<Analytic> {
    const result = await db.insert(analytics).values(analytic).returning();
    return result[0];
  }

  async bulkCreateAnalytics(analyticList: InsertAnalytic[]): Promise<void> {
    if (analyticList.length > 0) {
      await db.insert(analytics).values(analyticList).onConflictDoNothing();
    }
  }

  // MITRE Asset operations
  async getAllMitreAssets(): Promise<MitreAsset[]> {
    return await db.select().from(mitreAssets);
  }

  async getMitreAssetById(assetId: string): Promise<MitreAsset | undefined> {
    const result = await db.select().from(mitreAssets).where(eq(mitreAssets.assetId, assetId)).limit(1);
    return result[0];
  }

  async createMitreAsset(asset: InsertMitreAsset): Promise<MitreAsset> {
    const result = await db.insert(mitreAssets).values(asset).returning();
    return result[0];
  }

  async bulkCreateMitreAssets(assetList: InsertMitreAsset[]): Promise<void> {
    if (assetList.length > 0) {
      await db.insert(mitreAssets).values(assetList).onConflictDoNothing();
    }
  }

  // Hybrid Selector operations
  async updateProductHybridSelector(productId: string, selectorType: string, selectorValues: string[]): Promise<Product | undefined> {
    const normalizedSelectors = Array.isArray(selectorValues)
      ? normalizePlatformList(selectorValues)
      : [];
    const result = await db.update(products)
      .set({ 
        hybridSelectorType: selectorType,
        hybridSelectorValues: normalizedSelectors
      })
      .where(eq(products.productId, productId))
      .returning();
    return result[0];
  }
}

export const storage = new PostgresStorage();
