import { Router } from "express";
import { requireAuth, requireRole, requireAdminOrOwner } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { NotFoundError, ValidationError } from "../errors";
import { storage } from "../storage";
import { insertProductSchema, insertProductStreamSchema, products, productAliases, productStreams, ssmCapabilities, ssmMappings } from "@shared/schema";
import { fromZodError } from "zod-validation-error";
import { productService } from "../services";
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { resolveProductOwner } from "./shared-helpers";

const router = Router();

// Search products
router.get("/search", asyncHandler(async (req, res) => {
  const query = req.query.q as string;
  if (!query) throw new ValidationError("Query parameter 'q' is required");
  const results = await storage.searchProducts(query);
  res.json(results);
}));

// Get product by ID
router.get("/:productId", asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const product = await storage.getProductById(productId);
  if (!product) throw new NotFoundError("Product not found");
  res.json(product);
}));

router.get("/:productId/streams", asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const product = await db.select({ id: products.id })
    .from(products)
    .where(eq(products.productId, productId))
    .limit(1);
  const productRow = product[0];
  if (!productRow) throw new NotFoundError("Product not found");

  const streams = await db
    .select()
    .from(productStreams)
    .where(eq(productStreams.productId, productRow.id));

  res.json({ streams });
}));

router.post("/:productId/streams", requireAuth, requireAdminOrOwner(resolveProductOwner), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const payload = req.body;
  if (!payload || !Array.isArray(payload.streams)) {
    throw new ValidationError("Expected streams array");
  }

  const product = await db.select({ id: products.id })
    .from(products)
    .where(eq(products.productId, productId))
    .limit(1);
  const productRow = product[0];
  if (!productRow) throw new NotFoundError("Product not found");

  const seen = new Set<string>();
  const rows = payload.streams
    .map((stream: any) => {
      const name = typeof stream.name === 'string' ? stream.name.trim() : '';
      const streamType = typeof stream.streamType === 'string' ? stream.streamType : 'log';
      const mappedDataComponents = Array.isArray(stream.mappedDataComponents)
        ? stream.mappedDataComponents.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      const metadata = stream && typeof stream.metadata === 'object' && !Array.isArray(stream.metadata)
        ? stream.metadata
        : undefined;
      if (!name) return null;
      const key = name.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      return insertProductStreamSchema.parse({
        productId: productRow.id,
        name,
        streamType,
        mappedDataComponents,
        metadata,
        isConfigured: mappedDataComponents.length > 0,
      });
    })
    .filter(Boolean);

  await db.transaction(async (tx) => {
    await tx.delete(productStreams).where(eq(productStreams.productId, productRow.id));
    if (rows.length > 0) {
      await tx.insert(productStreams).values(rows);
    }
  });

  const streams = await db
    .select()
    .from(productStreams)
    .where(eq(productStreams.productId, productRow.id));

  res.json({ streams });
}));

// Get aliases for a product
router.get("/:productId/aliases", asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const product = await db.select().from(products).where(eq(products.productId, productId)).limit(1);
  if (!product[0]) throw new NotFoundError("Product not found");
  const aliases = await db.select({
    id: productAliases.id,
    alias: productAliases.alias,
    confidence: productAliases.confidence,
    createdAt: productAliases.createdAt,
  }).from(productAliases).where(eq(productAliases.productId, product[0].id));
  res.json(aliases);
}));

// Get SSM capabilities + mappings for a product
router.get("/:productId/ssm", asyncHandler(async (req, res) => {
  const { productId } = req.params;
  if (!productId) throw new ValidationError("Invalid product ID");

  const caps = await db.select().from(ssmCapabilities).where(eq(ssmCapabilities.productId, productId));
  if (caps.length === 0) return res.json([]);

  const capIds = caps.map(cap => cap.id);
  const maps = await db.select().from(ssmMappings).where(inArray(ssmMappings.capabilityId, capIds));

  const result = caps.map(cap => ({
    ...cap,
    mappings: maps
      .filter(map => map.capabilityId === cap.id)
      .map(({ capabilityId: _capabilityId, ...rest }) => rest),
  }));

  res.json(result);
}));

// Update product hybrid selector (platform type only, multi-select)
router.patch("/:productId/hybrid-selector", requireAuth, requireAdminOrOwner(resolveProductOwner), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { hybridSelectorType, hybridSelectorValues } = req.body;

  if (!hybridSelectorType) throw new ValidationError("hybridSelectorType is required");
  if (!Array.isArray(hybridSelectorValues)) throw new ValidationError("hybridSelectorValues must be an array of platform names");
  if (hybridSelectorType !== 'platform') throw new ValidationError("Only 'platform' type is supported");

  const updated = await storage.updateProductHybridSelector(productId, hybridSelectorType, hybridSelectorValues);
  if (!updated) throw new NotFoundError("Product not found");
  res.json(updated);
}));

// Add alias for a product
router.post("/:productId/aliases", requireAuth, requireAdminOrOwner(resolveProductOwner), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { alias, confidence } = req.body;
  if (!alias || typeof alias !== "string") throw new ValidationError("Alias is required");
  const product = await db.select().from(products).where(eq(products.productId, productId)).limit(1);
  if (!product[0]) throw new NotFoundError("Product not found");
  const newAlias = await productService.addAlias(product[0].id, alias, confidence || 100);
  res.status(201).json(newAlias);
}));

// Remove alias for a product
router.delete("/:productId/aliases/:aliasId", requireAuth, requireAdminOrOwner(resolveProductOwner), asyncHandler(async (req, res) => {
  const { productId, aliasId } = req.params;
  const aliasIdNumber = Number(aliasId);
  if (Number.isNaN(aliasIdNumber)) throw new ValidationError("Invalid alias ID");
  const product = await db.select().from(products).where(eq(products.productId, productId)).limit(1);
  if (!product[0]) throw new NotFoundError("Product not found");
  const alias = await db.select().from(productAliases).where(
    and(eq(productAliases.id, aliasIdNumber), eq(productAliases.productId, product[0].id))
  ).limit(1);
  if (!alias[0]) throw new NotFoundError("Alias not found");
  const deleted = await productService.deleteAlias(aliasIdNumber);
  if (!deleted) throw new NotFoundError("Alias not found");
  res.json({ message: "Alias removed" });
}));

// Create product
router.post("/", requireAuth, requireRole("admin", "user"), asyncHandler(async (req, res) => {
  const validation = insertProductSchema.safeParse(req.body);
  if (!validation.success) throw new ValidationError(fromZodError(validation.error).toString());
  const product = await storage.createProduct(validation.data, req.user!.id);
  res.status(201).json(product);
}));

// Bulk create products (admin only)
router.post("/bulk", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { products: productList } = req.body;
  if (!Array.isArray(productList)) throw new ValidationError("Expected array of products");
  await storage.bulkCreateProducts(productList);
  res.status(201).json({ message: "Products created successfully" });
}));

// Delete product (admin or owner)
router.delete("/:productId", requireAuth, requireAdminOrOwner(resolveProductOwner), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const deleted = await productService.deleteProduct(productId);
  if (!deleted) throw new NotFoundError("Product not found");
  res.json({ message: "Product deleted successfully" });
}));

export default router;
