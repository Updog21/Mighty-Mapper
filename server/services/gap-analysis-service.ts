import { sql } from "drizzle-orm";
import { db } from "../db";
import { normalizePlatformList } from "../../shared/platforms";

export interface CoveragePathRow {
  techniqueId: string;
  techniqueName: string;
  originProductId: string;
  path: string[];
}

export interface GapRow {
  techniqueId: string;
  techniqueName: string;
  tactics: string[];
}

export async function getCoveragePaths(
  mitreDatasetVersion = "18.1",
  localDatasetVersion = "current",
  limit = 200
): Promise<CoveragePathRow[]> {
  const result = await db.execute(sql`
    WITH RECURSIVE traversal AS (
      SELECT
        e.source_id AS origin_product_id,
        e.target_id AS node_id,
        ARRAY[e.source_id, e.target_id]::text[] AS path,
        1 AS depth
      FROM edges e
      JOIN nodes pn ON pn.id = e.source_id
      WHERE e.dataset = 'local'
        AND e.dataset_version = ${localDatasetVersion}
        AND e.type = 'provides'
        AND pn.type = 'x-mitre-mapper-product'
        AND pn.dataset = 'local'
        AND pn.dataset_version = ${localDatasetVersion}

      UNION ALL

      SELECT
        t.origin_product_id,
        nxt.next_id AS node_id,
        t.path || nxt.next_id,
        t.depth + 1
      FROM traversal t
      JOIN edges e ON (
        (e.type = 'looks_for' AND e.target_id = t.node_id) OR
        (e.type = 'uses' AND e.target_id = t.node_id) OR
        (e.type = 'detects' AND e.source_id = t.node_id)
      )
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN e.type = 'looks_for' THEN e.source_id
          WHEN e.type = 'uses' THEN e.source_id
          WHEN e.type = 'detects' THEN e.target_id
          ELSE NULL
        END AS next_id
      ) nxt
      WHERE e.dataset = 'mitre_attack'
        AND e.dataset_version = ${mitreDatasetVersion}
        AND nxt.next_id IS NOT NULL
        AND t.depth < 10
        AND NOT (nxt.next_id = ANY(t.path))
    )
    SELECT
      COALESCE(n.attributes->>'externalId', n.id) AS technique_id,
      n.name AS technique_name,
      traversal.origin_product_id AS origin_product_id,
      traversal.path AS path
    FROM traversal
    JOIN nodes n ON n.id = traversal.node_id
    WHERE n.type = 'technique'
      AND n.dataset = 'mitre_attack'
      AND n.dataset_version = ${mitreDatasetVersion}
    ORDER BY technique_id
    LIMIT ${limit};
  `);

  return result.rows.map(row => ({
    techniqueId: String(row.technique_id),
    techniqueName: String(row.technique_name),
    originProductId: String(row.origin_product_id),
    path: (row.path as string[]) || [],
  }));
}

export async function getCoverageGaps(
  mitreDatasetVersion = "18.1",
  localDatasetVersion = "current",
  productDbId?: number,
  platforms?: string[]
): Promise<GapRow[]> {
  const hasProduct = typeof productDbId === 'number';
  const platformList = normalizePlatformList(platforms || []);

  if (hasProduct) {
    const platformFilter = platformList.length > 0
      ? sql`
        (
          jsonb_array_length(coalesce(n.attributes->'platforms', '[]'::jsonb)) = 0
          OR (n.attributes->'platforms') ?| ${sql`${platformList}::text[]`}
        )
      `
      : sql`true`;

    const result = await db.execute(sql`
      WITH product_node AS (
        SELECT pn.id
        FROM nodes pn
        WHERE pn.dataset = 'local'
          AND pn.dataset_version = ${localDatasetVersion}
          AND pn.type = 'x-mitre-mapper-product'
          AND pn.local_id = ${productDbId}
      ),
      strict_traversal AS (
        SELECT
          e.source_id AS origin_product_id,
          e.target_id AS node_id,
          ARRAY[e.source_id, e.target_id]::text[] AS path,
          1 AS depth
        FROM edges e
        JOIN product_node pn ON pn.id = e.source_id
        WHERE e.dataset = 'local'
          AND e.dataset_version = ${localDatasetVersion}
          AND e.type = 'provides'

        UNION ALL

        SELECT
          t.origin_product_id,
          nxt.next_id AS node_id,
          t.path || nxt.next_id,
          t.depth + 1
        FROM strict_traversal t
        JOIN edges e ON (
          (e.type = 'looks_for' AND e.target_id = t.node_id) OR
          (e.type = 'uses' AND e.target_id = t.node_id) OR
          (e.type = 'detects' AND e.source_id = t.node_id)
        )
        CROSS JOIN LATERAL (
          SELECT CASE
            WHEN e.type = 'looks_for' THEN e.source_id
            WHEN e.type = 'uses' THEN e.source_id
            WHEN e.type = 'detects' THEN e.target_id
            ELSE NULL
          END AS next_id
        ) nxt
        WHERE e.dataset = 'mitre_attack'
          AND e.dataset_version = ${mitreDatasetVersion}
          AND nxt.next_id IS NOT NULL
          AND t.depth < 10
          AND NOT (nxt.next_id = ANY(t.path))
      ),
      strict_covered AS (
        SELECT DISTINCT node_id
        FROM strict_traversal
        JOIN nodes n ON n.id = strict_traversal.node_id
        WHERE n.type = 'technique'
          AND n.dataset = 'mitre_attack'
          AND n.dataset_version = ${mitreDatasetVersion}
      ),
      platform_analytics AS (
        SELECT n.id
        FROM nodes n
        WHERE n.type = 'analytic'
          AND n.dataset = 'mitre_attack'
          AND n.dataset_version = ${mitreDatasetVersion}
          AND ${platformFilter}
      ),
      platform_strategies AS (
        SELECT DISTINCT e.source_id AS strategy_id
        FROM edges e
        JOIN platform_analytics pa ON pa.id = e.target_id
        WHERE e.type = 'uses'
          AND e.dataset = 'mitre_attack'
          AND e.dataset_version = ${mitreDatasetVersion}
      ),
      platform_techniques AS (
        SELECT DISTINCT e.target_id AS technique_id
        FROM edges e
        JOIN platform_strategies ps ON ps.strategy_id = e.source_id
        WHERE e.type = 'detects'
          AND e.dataset = 'mitre_attack'
          AND e.dataset_version = ${mitreDatasetVersion}
      ),
      covered AS (
        SELECT node_id FROM strict_covered
        UNION
        SELECT technique_id FROM platform_techniques
      )
      SELECT
        COALESCE(n.attributes->>'externalId', n.id) AS technique_id,
        n.name AS technique_name,
        COALESCE(n.attributes->'tactics', '[]'::jsonb) AS tactics
      FROM nodes n
      WHERE n.type = 'technique'
        AND n.dataset = 'mitre_attack'
        AND n.dataset_version = ${mitreDatasetVersion}
        AND n.id NOT IN (SELECT node_id FROM covered)
      ORDER BY technique_id;
    `);

    return result.rows.map(row => ({
      techniqueId: String(row.technique_id),
      techniqueName: String(row.technique_name),
      tactics: (() => {
        if (!row.tactics) return [];
        try {
          const parsed = typeof row.tactics === "string" ? JSON.parse(row.tactics) : row.tactics;
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
    }));
  }

  const result = await db.execute(sql`
    WITH RECURSIVE traversal AS (
      SELECT
        e.source_id AS origin_product_id,
        e.target_id AS node_id,
        ARRAY[e.source_id, e.target_id]::text[] AS path,
        1 AS depth
      FROM edges e
      JOIN nodes pn ON pn.id = e.source_id
      WHERE e.dataset = 'local'
        AND e.dataset_version = ${localDatasetVersion}
        AND e.type = 'provides'
        AND pn.type = 'x-mitre-mapper-product'
        AND pn.dataset = 'local'
        AND pn.dataset_version = ${localDatasetVersion}

      UNION ALL

      SELECT
        t.origin_product_id,
        nxt.next_id AS node_id,
        t.path || nxt.next_id,
        t.depth + 1
      FROM traversal t
      JOIN edges e ON (
        (e.type = 'looks_for' AND e.target_id = t.node_id) OR
        (e.type = 'uses' AND e.target_id = t.node_id) OR
        (e.type = 'detects' AND e.source_id = t.node_id)
      )
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN e.type = 'looks_for' THEN e.source_id
          WHEN e.type = 'uses' THEN e.source_id
          WHEN e.type = 'detects' THEN e.target_id
          ELSE NULL
        END AS next_id
      ) nxt
      WHERE e.dataset = 'mitre_attack'
        AND e.dataset_version = ${mitreDatasetVersion}
        AND nxt.next_id IS NOT NULL
        AND t.depth < 10
        AND NOT (nxt.next_id = ANY(t.path))
    ),
    covered AS (
      SELECT DISTINCT node_id
      FROM traversal
      JOIN nodes n ON n.id = traversal.node_id
      WHERE n.type = 'technique'
        AND n.dataset = 'mitre_attack'
        AND n.dataset_version = ${mitreDatasetVersion}
    )
    SELECT
      COALESCE(n.attributes->>'externalId', n.id) AS technique_id,
      n.name AS technique_name,
      COALESCE(n.attributes->'tactics', '[]'::jsonb) AS tactics
    FROM nodes n
    WHERE n.type = 'technique'
      AND n.dataset = 'mitre_attack'
      AND n.dataset_version = ${mitreDatasetVersion}
      AND n.id NOT IN (SELECT node_id FROM covered)
    ORDER BY technique_id;
  `);

  return result.rows.map(row => ({
    techniqueId: String(row.technique_id),
    techniqueName: String(row.technique_name),
    tactics: (() => {
      if (!row.tactics) return [];
      try {
        const parsed = typeof row.tactics === "string" ? JSON.parse(row.tactics) : row.tactics;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
  }));
}
