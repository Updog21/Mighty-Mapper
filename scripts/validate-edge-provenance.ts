import { sql } from "drizzle-orm";
import { db } from "../server/db";

type CountRow = {
  total: number;
  tagged: number;
  wrong: number;
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return 0;
};

const loadCounts = async (edgeType: string): Promise<CountRow> => {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE attributes->>'provenance' = 'stix_ref_field')::int AS tagged,
      COUNT(*) FILTER (WHERE attributes->>'provenance' = 'stix_relationship')::int AS wrong
    FROM edges
    WHERE type = ${edgeType}
  `);
  const row = result.rows[0] as CountRow | undefined;
  return {
    total: toNumber(row?.total),
    tagged: toNumber(row?.tagged),
    wrong: toNumber(row?.wrong),
  };
};

const loadDetectsInvalid = async (): Promise<number> => {
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int AS invalid
    FROM edges
    WHERE type = 'detects'
      AND attributes ? 'provenance'
      AND (attributes->>'provenance') NOT IN (
        'stix_relationship',
        'derived_from_technique_metadata'
      )
  `);
  const row = result.rows[0] as { invalid?: number | string } | undefined;
  return toNumber(row?.invalid);
};

const fail = (message: string): never => {
  console.error(`[edge-provenance] ${message}`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  const uses = await loadCounts("uses");
  const looksFor = await loadCounts("looks_for");
  const detectsInvalid = await loadDetectsInvalid();

  if (uses.total === 0) {
    fail("No 'uses' edges found. Run graph ingestion before validation.");
  }
  if (looksFor.total === 0) {
    fail("No 'looks_for' edges found. Run graph ingestion before validation.");
  }

  if (uses.tagged !== uses.total) {
    fail(`'uses' edges missing provenance. tagged=${uses.tagged} total=${uses.total}`);
  }
  if (looksFor.tagged !== looksFor.total) {
    fail(`'looks_for' edges missing provenance. tagged=${looksFor.tagged} total=${looksFor.total}`);
  }

  if (uses.wrong > 0) {
    fail(`'uses' edges incorrectly tagged as stix_relationship. count=${uses.wrong}`);
  }
  if (looksFor.wrong > 0) {
    fail(`'looks_for' edges incorrectly tagged as stix_relationship. count=${looksFor.wrong}`);
  }

  if (detectsInvalid > 0) {
    fail(`'detects' edges have invalid provenance values. count=${detectsInvalid}`);
  }

  console.log("[edge-provenance] OK");
};

main().catch((error) => {
  console.error("[edge-provenance] Unhandled error", error);
  process.exit(1);
});
