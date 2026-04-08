import { Router } from "express";
import { requireAuth, requireAdminOrOwner } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { NotFoundError } from "../errors";
import { runAutoMapper, getMappingStatus, getAllProductMappings, RESOURCE_PRIORITY } from "../auto-mapper";
import { resolveProductOwner } from "./shared-helpers";

const router = Router();

// Run auto-mapper for a product (admin or product owner)
router.post("/run/:productId", requireAuth, requireAdminOrOwner(resolveProductOwner), asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const result = await runAutoMapper(productId);
  res.json(result);
}));

// Get mapping status for a product
router.get("/mappings/:productId", asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const mapping = await getMappingStatus(productId);
  if (!mapping) throw new NotFoundError("No mapping found for this product");
  res.json(mapping);
}));

// Get all product mappings
router.get("/mappings", asyncHandler(async (_req, res) => {
  const mappings = await getAllProductMappings();
  res.json(mappings);
}));

// Get resource priority matrix
router.get("/priority", (_req, res) => {
  res.json(RESOURCE_PRIORITY);
});

export default router;
