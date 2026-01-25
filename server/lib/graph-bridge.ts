import { db } from "../db";
import { nodes, edges, type Product } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { generateLocalStixId } from "./stix-id-generator";

const LOCAL_DATASET = "local";
const LOCAL_VERSION = "current";
const MITRE_DATASET = "mitre_attack";

type DbExecutor = typeof db;

export async function upsertProductNode(product: Product, executor: DbExecutor = db): Promise<string> {
  const stixId = generateLocalStixId("product", String(product.id));
  await executor
    .insert(nodes)
    .values({
      id: stixId,
      type: "x-mitre-mapper-product",
      name: product.productName,
      dataset: LOCAL_DATASET,
      datasetVersion: LOCAL_VERSION,
      localId: product.id,
      attributes: {
        productId: product.productId,
        vendor: product.vendor,
        deployment: product.deployment,
        description: product.description,
        platforms: product.platforms,
        source: product.source,
      },
    })
    .onConflictDoNothing();

  return stixId;
}

export async function syncProductProvidesEdges(product: Product, executor: DbExecutor = db): Promise<void> {
  const stixId = generateLocalStixId("product", String(product.id));
  const dataComponentIds = product.dataComponentIds || [];
  if (dataComponentIds.length === 0) {
    await executor.delete(edges).where(and(
      eq(edges.sourceId, stixId),
      eq(edges.dataset, LOCAL_DATASET)
    ));
    return;
  }

  const externalIds = dataComponentIds.filter(id => !id.startsWith("x-mitre-"));
  const externalIdList = externalIds.length > 0
    ? sql.join(externalIds.map(id => sql`${id}`), sql`, `)
    : null;

  const dcRows = externalIdList
    ? await executor
        .select({
          stixId: nodes.id,
          externalId: sql<string>`${nodes.attributes} ->> 'externalId'`,
        })
        .from(nodes)
        .where(and(
          eq(nodes.dataset, MITRE_DATASET),
          eq(nodes.type, "data_component"),
          sql`${nodes.attributes} ->> 'externalId' = ANY(ARRAY[${externalIdList}]::text[])`
        ))
    : [];

  const stixByExternal = new Map<string, string>();
  dcRows.forEach(row => {
    if (row.externalId) {
      stixByExternal.set(row.externalId, row.stixId);
    }
  });

  const targetIds = dataComponentIds
    .map(id => {
      if (id.startsWith("x-mitre-")) return id;
      return stixByExternal.get(id) || null;
    })
    .filter((id): id is string => Boolean(id));

  await executor.delete(edges).where(and(
    eq(edges.sourceId, stixId),
    eq(edges.dataset, LOCAL_DATASET)
  ));

  if (targetIds.length === 0) return;

  await executor.insert(edges).values(
    targetIds.map(targetId => ({
      sourceId: stixId,
      targetId,
      type: "provides",
      dataset: LOCAL_DATASET,
      datasetVersion: LOCAL_VERSION,
    }))
  );
}

export async function deleteProductGraph(product: Product, executor: DbExecutor = db): Promise<void> {
  const stixId = generateLocalStixId("product", String(product.id));
  await executor.delete(edges).where(eq(edges.sourceId, stixId));
  await executor.delete(nodes).where(eq(nodes.id, stixId));
}
