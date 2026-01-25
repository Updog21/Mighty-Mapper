import { db } from "../db";
import { products } from "@shared/schema";
import { syncProductProvidesEdges, upsertProductNode } from "../lib/graph-bridge";

async function run(): Promise<void> {
  let nodeCount = 0;
  let edgeCount = 0;

  await db.transaction(async (tx) => {
    const allProducts = await tx.select().from(products);

    for (const product of allProducts) {
      await upsertProductNode(product, tx);
      nodeCount += 1;
      await syncProductProvidesEdges(product, tx);
      edgeCount += (product.dataComponentIds || []).length;
    }
  });

  console.log(`[Backfill] Processed ${nodeCount} product nodes.`);
  console.log(`[Backfill] Attempted ${edgeCount} provides edges from data components.`);
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[Backfill] Failed:", error);
    process.exit(1);
  });
