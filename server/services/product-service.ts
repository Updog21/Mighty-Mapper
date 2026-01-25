/**
 * ProductService - Phase 2: Intelligence & Persistence
 *
 * Responsibilities:
 * 1. Alias Resolution: Convert user input (e.g., "m365") to canonical names
 * 2. Search Term Building: Generate comprehensive search terms for adapters
 * 3. Fuzzy Matching: Find products even with partial/variant names
 * 4. CRUD Operations: Wrap storage for product/alias management
 *
 * Updated: Uses FK-based productAliases (productId -> products.id)
 */

import { db } from '../db';
import {
  products,
  productAliases,
  productMappings,
  productStreams,
  ssmCapabilities,
  ssmMappings,
  type Product,
  type InsertProduct,
  type ProductAlias,
  type InsertProductAlias
} from '@shared/schema';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { runAutoMapper } from '../auto-mapper/service';
import { deleteProductGraph, syncProductProvidesEdges, upsertProductNode } from '../lib/graph-bridge';
import { normalizePlatformList } from '../../shared/platforms';

export interface ResolvedSearchTerms {
  canonicalName: string;
  vendor: string;
  aliases: string[];
  allTerms: string[];  // Combined list for adapter consumption
}

// Extended alias type with product info for API responses
export interface AliasWithProduct extends ProductAlias {
  productName: string;
  vendor: string;
}

export class ProductService {
  /**
   * Resolve a search query to canonical product info + all aliases
   * This is the main entry point for the SigmaAdapter
   */
  async resolveSearchTerms(query: string): Promise<ResolvedSearchTerms | null> {
    const normalizedQuery = query.toLowerCase().trim();

    // 1. Try direct product match first
    const product = await this.findProductByName(normalizedQuery);
    if (product) {
      const aliases = await this.getAliasesForProduct(product.id);
      return this.buildSearchTerms(product, aliases);
    }

    // 2. Try alias lookup
    const aliasMatch = await this.findProductByAlias(normalizedQuery);
    if (aliasMatch) {
      const aliases = await this.getAliasesForProduct(aliasMatch.id);
      return this.buildSearchTerms(aliasMatch, aliases);
    }

    // 3. Try fuzzy match as last resort
    const fuzzyMatch = await this.fuzzyFindProduct(normalizedQuery);
    if (fuzzyMatch) {
      const aliases = await this.getAliasesForProduct(fuzzyMatch.id);
      return this.buildSearchTerms(fuzzyMatch, aliases);
    }

    return null;
  }

  /**
   * Resolve a search query to a single product record (alias-aware)
   */
  async resolveProduct(query: string): Promise<Product | null> {
    const normalizedQuery = query.toLowerCase().trim();

    const product = await this.findProductByName(normalizedQuery);
    if (product) return product;

    const aliasMatch = await this.findProductByAlias(normalizedQuery);
    if (aliasMatch) return aliasMatch;

    const fuzzyMatch = await this.fuzzyFindProduct(normalizedQuery);
    if (fuzzyMatch) return fuzzyMatch;

    return null;
  }

  /**
   * Build comprehensive search terms from product + aliases
   */
  private buildSearchTerms(product: Product, aliases: string[]): ResolvedSearchTerms {
    const terms = new Set<string>();

    // Only use vendor + product and explicit aliases
    const name = product.productName.trim();
    const vendor = product.vendor.trim();
    if (vendor && name) {
      terms.add(`${vendor} ${name}`.toLowerCase());
    }

    // Add all aliases
    aliases.forEach(alias => {
      const normalized = alias.trim();
      if (normalized) {
        terms.add(normalized.toLowerCase());
      }
    });

    return {
      canonicalName: product.productName,
      vendor: product.vendor,
      aliases,
      allTerms: Array.from(terms).filter(t => t.length > 0)
    };
  }

  /**
   * Find product by exact or partial name match
   */
  private async findProductByName(query: string): Promise<Product | null> {
    const results = await db.select().from(products).where(
      or(
        sql`LOWER(${products.productName}) = ${query}`,
        sql`LOWER(${products.vendor} || ' ' || ${products.productName}) = ${query}`
      )
    ).limit(1);

    return results[0] || null;
  }

  /**
   * Find product via alias table (using FK join)
   */
  private async findProductByAlias(query: string): Promise<Product | null> {
    // Join alias table with products via productId FK
    const result = await db
      .select({
        id: products.id,
        productId: products.productId,
        vendor: products.vendor,
        productName: products.productName,
        deployment: products.deployment,
        description: products.description,
        platforms: products.platforms,
        productType: products.productType,
        capabilityTags: products.capabilityTags,
        dataComponentIds: products.dataComponentIds,
        mitreAssetIds: products.mitreAssetIds,
        source: products.source,
        logoPath: products.logoPath,
        hybridSelectorType: products.hybridSelectorType,
        hybridSelectorValues: products.hybridSelectorValues,
        createdAt: products.createdAt,
      })
      .from(productAliases)
      .innerJoin(products, eq(productAliases.productId, products.id))
      .where(sql`LOWER(${productAliases.alias}) = ${query}`)
      .limit(1);

    return result[0] || null;
  }

  /**
   * Fuzzy search with LIKE patterns
   */
  private async fuzzyFindProduct(query: string): Promise<Product | null> {
    const searchPattern = `%${query}%`;

    const results = await db.select().from(products).where(
      or(
        sql`LOWER(${products.productName}) LIKE ${searchPattern}`,
        sql`LOWER(${products.vendor}) LIKE ${searchPattern}`
      )
    ).limit(1);

    return results[0] || null;
  }

  /**
   * Get all aliases for a product by product.id (integer PK)
   */
  private async getAliasesForProduct(productDbId: number): Promise<string[]> {
    const results = await db.select().from(productAliases).where(
      eq(productAliases.productId, productDbId)
    );

    return results.map(r => r.alias);
  }

  // ============ CRUD Operations ============

  /**
   * Get all products from database
   */
  async getAllProducts(): Promise<Product[]> {
    return await db.select().from(products).orderBy(products.productName);
  }

  /**
   * Get products by source type
   */
  async getProductsBySource(source: string): Promise<Product[]> {
    return await db.select().from(products).where(eq(products.source, source));
  }

  /**
   * Get a single product by productId (text field)
   */
  async getProductById(productId: string): Promise<Product | null> {
    const result = await db.select().from(products).where(
      eq(products.productId, productId)
    ).limit(1);
    return result[0] || null;
  }

  /**
   * Get a single product by database id (integer PK)
   */
  async getProductByDbId(id: number): Promise<Product | null> {
    const result = await db.select().from(products).where(
      eq(products.id, id)
    ).limit(1);
    return result[0] || null;
  }

  /**
   * Create a new product and automatically trigger mapping
   */
  async createProduct(
    product: InsertProduct,
    options?: { autoMap?: boolean }
  ): Promise<Product> {
    const normalizedProduct = {
      ...product,
      platforms: Array.isArray(product.platforms)
        ? normalizePlatformList(product.platforms)
        : [],
      hybridSelectorValues: Array.isArray(product.hybridSelectorValues)
        ? normalizePlatformList(product.hybridSelectorValues)
        : product.hybridSelectorValues,
    };

    const createdProduct = await db.transaction(async (tx) => {
      const result = await tx.insert(products).values(normalizedProduct).returning();
      const nextProduct = result[0];
      await upsertProductNode(nextProduct, tx);
      await syncProductProvidesEdges(nextProduct, tx);
      return nextProduct;
    });

    if (options?.autoMap !== false) {
      // Trigger auto-mapper in background
      console.log(`[ProductService] Triggering Auto-Mapper for ${createdProduct.productName}...`);
      runAutoMapper(createdProduct.productId)
        .then(() => console.log(`[AutoMapper] Completed for ${createdProduct.productName}`))
        .catch(err => console.error(`[AutoMapper] Failed for ${createdProduct.productName}:`, err));
    }

    return createdProduct;
  }

  /**
   * Update a product
   */
  async updateProduct(productId: string, updates: Partial<InsertProduct>): Promise<Product | null> {
    const normalizedUpdates: Partial<InsertProduct> = { ...updates };
    if (Array.isArray(updates.platforms)) {
      normalizedUpdates.platforms = normalizePlatformList(updates.platforms);
    }
    if (Array.isArray(updates.hybridSelectorValues)) {
      normalizedUpdates.hybridSelectorValues = normalizePlatformList(updates.hybridSelectorValues);
    }

    const updatedProduct = await db.transaction(async (tx) => {
      const result = await tx.update(products)
        .set(normalizedUpdates)
        .where(eq(products.productId, productId))
        .returning();
      if (!result[0]) return null;
      await upsertProductNode(result[0], tx);
      await syncProductProvidesEdges(result[0], tx);
      return result[0];
    });
    return updatedProduct || null;
  }

  /**
   * Delete a product (also deletes associated aliases due to FK cascade)
   */
  async deleteProduct(productId: string): Promise<boolean> {
    const deletedProduct = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: products.id, productId: products.productId })
        .from(products)
        .where(eq(products.productId, productId))
        .limit(1);

      if (!existing[0]) return null;

      const productRow = existing[0];

      await tx.delete(productAliases).where(eq(productAliases.productId, productRow.id));
      await tx.delete(productStreams).where(eq(productStreams.productId, productRow.id));
      await tx.delete(productMappings).where(eq(productMappings.productId, productRow.productId));

      const capabilityRows = await tx
        .select({ id: ssmCapabilities.id })
        .from(ssmCapabilities)
        .where(eq(ssmCapabilities.productId, productRow.productId));

      if (capabilityRows.length > 0) {
        await tx.delete(ssmMappings).where(
          inArray(
            ssmMappings.capabilityId,
            capabilityRows.map(row => row.id)
          )
        );
        await tx.delete(ssmCapabilities).where(eq(ssmCapabilities.productId, productRow.productId));
      }

      const result = await tx.delete(products).where(eq(products.productId, productId)).returning();
      if (!result[0]) return null;
      await deleteProductGraph(result[0], tx);
      return result[0];
    });
    return Boolean(deletedProduct);
  }

  // ============ Alias Operations ============

  /**
   * Get all aliases with product info (joined)
   */
  async getAllAliases(): Promise<AliasWithProduct[]> {
    const results = await db
      .select({
        id: productAliases.id,
        productId: productAliases.productId,
        alias: productAliases.alias,
        confidence: productAliases.confidence,
        createdBy: productAliases.createdBy,
        createdAt: productAliases.createdAt,
        productName: products.productName,
        vendor: products.vendor,
      })
      .from(productAliases)
      .innerJoin(products, eq(productAliases.productId, products.id))
      .orderBy(products.productName, productAliases.alias);

    return results;
  }

  /**
   * Add an alias for a product (by productName lookup)
   */
  async addAliasByName(productName: string, alias: string, confidence: number = 100): Promise<ProductAlias | null> {
    // Find the product first
    const product = await db.select().from(products).where(
      sql`LOWER(${products.productName}) = ${productName.toLowerCase()}`
    ).limit(1);

    if (!product[0]) {
      return null;
    }

    const result = await db.insert(productAliases).values({
      productId: product[0].id,
      alias,
      confidence
    }).returning();

    return result[0];
  }

  /**
   * Add an alias for a product (by product database ID)
   */
  async addAlias(productDbId: number, alias: string, confidence: number = 100): Promise<ProductAlias> {
    const result = await db.insert(productAliases).values({
      productId: productDbId,
      alias,
      confidence
    }).returning();
    return result[0];
  }

  /**
   * Bulk add aliases
   */
  async bulkAddAliases(aliases: InsertProductAlias[]): Promise<void> {
    if (aliases.length > 0) {
      await db.insert(productAliases).values(aliases).onConflictDoNothing();
    }
  }

  /**
   * Delete an alias
   */
  async deleteAlias(aliasId: number): Promise<boolean> {
    const result = await db.delete(productAliases).where(eq(productAliases.id, aliasId)).returning();
    return result.length > 0;
  }

  async updateAlias(aliasId: number, alias: string, confidence?: number): Promise<ProductAlias | null> {
    const normalized = alias.trim();
    if (!normalized) return null;

    const result = await db.update(productAliases)
      .set({
        alias: normalized,
        confidence: confidence ?? 100,
      })
      .where(eq(productAliases.id, aliasId))
      .returning();

    return result[0] || null;
  }

  /**
   * Search products with alias resolution
   * Main search function for the frontend
   */
  async searchProducts(query: string): Promise<Product[]> {
    if (!query || query.length < 2) {
      return this.getAllProducts();
    }

    const normalizedQuery = query.toLowerCase().trim();
    const searchPattern = `%${normalizedQuery}%`;

    // 1. Find matching aliases and get their product IDs
    const matchingAliases = await db.select().from(productAliases).where(
      sql`LOWER(${productAliases.alias}) LIKE ${searchPattern}`
    );

    const productIdsFromAliases = matchingAliases.map(a => a.productId);

    // 2. Search products directly + by resolved product IDs from aliases
    let results: Product[];

    if (productIdsFromAliases.length > 0) {
      results = await db.select().from(products).where(
        or(
          sql`LOWER(${products.productName}) LIKE ${searchPattern}`,
          sql`LOWER(${products.vendor}) LIKE ${searchPattern}`,
          sql`${products.id} = ANY(ARRAY[${sql.join(productIdsFromAliases, sql`, `)}]::int[])`
        )
      );
    } else {
      results = await db.select().from(products).where(
        or(
          sql`LOWER(${products.productName}) LIKE ${searchPattern}`,
          sql`LOWER(${products.vendor}) LIKE ${searchPattern}`
        )
      );
    }

    return results;
  }
}

// Export singleton instance
export const productService = new ProductService();
