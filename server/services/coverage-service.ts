import { sql } from "drizzle-orm";
import { db } from "../db";
import { mitreKnowledgeGraph } from "../mitre-stix/knowledge-graph";
import { normalizePlatformList } from "../../shared/platforms";

export interface GlobalCoverageRow {
  techniqueId: string;
  techniqueName: string;
  techniqueDescription: string;
  coverageCount: number;
  tactics: string[];
}

function parseTactics(raw: unknown): string[] {
  const normalizeList = (values: unknown[]): string[] =>
    values
      .map((t) => String(t).trim())
      .filter((t) => t.length > 0);
  if (Array.isArray(raw)) {
    return normalizeList(raw);
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return normalizeList(parsed);
      }
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeCoverageRows(rows: Array<Record<string, unknown>>): GlobalCoverageRow[] {
  const coverageByTechnique = new Map<string, GlobalCoverageRow>();
  let invalidCount = 0;

  for (const row of rows) {
    const rawId = String(row.technique_id || "");
    const normalizedId = mitreKnowledgeGraph.normalizeTechniqueId(rawId);
    if (!normalizedId) {
      invalidCount += 1;
      continue;
    }

    let tactics = parseTactics(row.tactics);
    if (tactics.length === 0) {
      const kgTactics = mitreKnowledgeGraph.getTactics(normalizedId);
      if (kgTactics.length > 0) {
        tactics = kgTactics;
      }
    }

    const tech = mitreKnowledgeGraph.getTechnique(normalizedId);
    const techniqueName = tech?.name || String(row.technique_name || normalizedId);
    const techniqueDescription = tech?.description || String(row.technique_description || "");
    const coverageCount = Number(row.coverage_count ?? row.coverageCount ?? 0);

    const existing = coverageByTechnique.get(normalizedId);
    if (existing) {
      existing.coverageCount += coverageCount;
      if (existing.tactics.length === 0 && tactics.length > 0) {
        existing.tactics = tactics;
      }
      if (!existing.techniqueDescription && techniqueDescription) {
        existing.techniqueDescription = techniqueDescription;
      }
      if (!existing.techniqueName && techniqueName) {
        existing.techniqueName = techniqueName;
      }
      continue;
    }

    coverageByTechnique.set(normalizedId, {
      techniqueId: normalizedId,
      techniqueName,
      techniqueDescription,
      coverageCount,
      tactics,
    });
  }

  if (invalidCount > 0) {
    console.warn(`[Coverage] Skipped ${invalidCount} mappings with invalid technique IDs.`);
  }

  const normalized = Array.from(coverageByTechnique.values());
  normalized.forEach((row) => {
    if (row.tactics.length === 0) {
      const kgTactics = mitreKnowledgeGraph.getTactics(row.techniqueId);
      if (kgTactics.length > 0) {
        row.tactics = kgTactics;
      }
    }
  });

  return normalized.sort((a, b) => a.techniqueId.localeCompare(b.techniqueId));
}

export async function getGlobalCoverage(
  mitreDatasetVersion = "18.1",
  localDatasetVersion = "current",
  productId?: string,
  platforms?: string[],
  scope: 'detection' | 'visibility' = 'detection'
): Promise<GlobalCoverageRow[]> {
  await mitreKnowledgeGraph.ensureInitialized();
  const hasProduct = typeof productId === 'string' && productId.length > 0;
  const platformList = normalizePlatformList(platforms || []).map((platform) => platform.toLowerCase());
  const scoreCategories = scope === 'visibility'
    ? ['Minimal', 'Partial', 'Significant']
    : ['Partial', 'Significant'];

  if (hasProduct) {
    const result = await db.execute(sql`
      SELECT
        sm.technique_id AS technique_id,
        COALESCE(n.name, sm.technique_name) AS technique_name,
        COALESCE(n.attributes->>'description', '') AS technique_description,
        COALESCE(n.attributes->'tactics', '[]'::jsonb) AS tactics,
        1::int AS coverage_count
      FROM ssm_mappings sm
      JOIN ssm_capabilities sc ON sc.id = sm.capability_id
      LEFT JOIN nodes n ON n.dataset = 'mitre_attack'
        AND n.dataset_version = ${mitreDatasetVersion}
        AND n.type = 'technique'
        AND n.attributes->>'externalId' = sm.technique_id
      WHERE sc.product_id = ${productId}
        AND sm.score_category = ANY(${sql`${scoreCategories}::text[]`})
        ${platformList.length > 0
          ? sql`AND lower(sc.platform) = ANY(${sql`${platformList}::text[]`})`
          : sql``}
      GROUP BY sm.technique_id, technique_name
      ORDER BY technique_id;
    `);

    return normalizeCoverageRows(result.rows as Array<Record<string, unknown>>);
  }

  const result = await db.execute(sql`
    SELECT
      sm.technique_id AS technique_id,
      COALESCE(n.name, sm.technique_name) AS technique_name,
      COALESCE(n.attributes->>'description', '') AS technique_description,
      COALESCE(n.attributes->'tactics', '[]'::jsonb) AS tactics,
      COUNT(DISTINCT sc.product_id)::int AS coverage_count
    FROM ssm_mappings sm
    JOIN ssm_capabilities sc ON sc.id = sm.capability_id
    LEFT JOIN nodes n ON n.dataset = 'mitre_attack'
      AND n.dataset_version = ${mitreDatasetVersion}
      AND n.type = 'technique'
      AND n.attributes->>'externalId' = sm.technique_id
    WHERE sm.score_category = ANY(${sql`${scoreCategories}::text[]`})
      ${platformList.length > 0
        ? sql`AND lower(sc.platform) = ANY(${sql`${platformList}::text[]`})`
        : sql``}
    GROUP BY sm.technique_id, technique_name
    ORDER BY technique_id;
  `);

  return normalizeCoverageRows(result.rows as Array<Record<string, unknown>>);
}
