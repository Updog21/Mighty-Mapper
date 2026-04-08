import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth";
import { asyncHandler } from "../middleware/async-handler";
import { NotFoundError, ValidationError, ForbiddenError } from "../errors";
import { mitreKnowledgeGraph } from "../mitre-stix";
import { slugifyPlatform } from "../auto-mapper/utils";
import { db } from "../db";
import { and, eq, inArray } from "drizzle-orm";
import { products, productStreams, ssmCapabilities, ssmMappings } from "@shared/schema";
import { normalizePlatformList, platformMatchesAny } from "../../shared/platforms";

const router = Router();

router.post("/coverage", requireAuth, requireRole("admin", "user"), asyncHandler(async (req, res) => {
  await mitreKnowledgeGraph.ensureInitialized();
  const { productId, platforms, streams } = req.body || {};
  if (!productId || typeof productId !== "string") throw new ValidationError("productId is required");

    const product = await db
      .select({ id: products.id, platforms: products.platforms, createdBy: products.createdBy })
      .from(products)
      .where(eq(products.productId, productId))
      .limit(1);
    const productRow = product[0];
    if (!productRow) throw new NotFoundError("Product not found");

    // Ownership check: non-admin users can only run wizard on their own products
    if (req.user!.role !== "admin" && productRow.createdBy !== req.user!.id) {
      throw new ForbiddenError("You do not have permission to modify this resource");
    }

    const platformList = Array.isArray(platforms) && platforms.length > 0
      ? platforms
      : (productRow.platforms || []);
    const normalizedPlatforms = normalizePlatformList(
      platformList.map((platform: unknown) => (typeof platform === "string" ? platform.trim() : ""))
    );
    if (normalizedPlatforms.length === 0) throw new ValidationError("At least one platform is required");

    const streamRows = Array.isArray(streams) && streams.length > 0
      ? streams
      : await db.select().from(productStreams).where(eq(productStreams.productId, productRow.id));

    const dataComponentHints = new Set<string>();
    const streamNames = new Set<string>();
    const questionIds = new Set<string>();
    const missingNames = new Set<string>();

    for (const stream of streamRows as Array<Record<string, unknown>>) {
      if (stream && typeof stream.name === "string" && stream.name.trim()) {
        streamNames.add(stream.name.trim());
      }

      const mapped = Array.isArray((stream as { mappedDataComponents?: unknown }).mappedDataComponents)
        ? (stream as { mappedDataComponents?: unknown[] }).mappedDataComponents
        : [];
      (mapped || []).forEach((item) => {
        if (typeof item === "string" && item.trim()) {
          dataComponentHints.add(item.trim());
        }
      });

      const metadata = stream && typeof (stream as { metadata?: unknown }).metadata === "object"
        ? (stream as { metadata?: Record<string, unknown> }).metadata
        : null;
      const metaQuestionIds = metadata && Array.isArray(metadata.question_ids) ? metadata.question_ids : [];
      metaQuestionIds.forEach((item: unknown) => {
        if (typeof item === "string" && item.trim()) {
          questionIds.add(item.trim());
        }
      });
      const metaMissing = metadata && Array.isArray(metadata.missing_dc_names) ? metadata.missing_dc_names : [];
      metaMissing.forEach((item: unknown) => {
        if (typeof item === "string" && item.trim()) {
          missingNames.add(item.trim());
        }
      });
    }

    if (dataComponentHints.size === 0) throw new ValidationError("No data components selected");

    const resolvedComponents = mitreKnowledgeGraph.resolveDataComponentsFromHints(
      Array.from(dataComponentHints)
    );
    const dataSources = new Set<string>();
    resolvedComponents.forEach(dc => {
      if (dc.dataSourceName) {
        dataSources.add(dc.dataSourceName);
      }
    });

    const normalizeDcKey = (value: string): string =>
      value
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    const extractDcNameVariants = (value: string): string[] => {
      const trimmed = value.trim();
      if (!trimmed) return [];
      const variants = new Set<string>([trimmed]);
      if (trimmed.includes(":")) {
        const right = trimmed.split(":").slice(1).join(":").trim();
        if (right) variants.add(right);
      }
      return Array.from(variants);
    };

    const selectedDcByKey = new Map<string, string>();
    resolvedComponents.forEach((dc) => {
      const nameKey = normalizeDcKey(dc.name);
      if (nameKey && !selectedDcByKey.has(nameKey)) {
        selectedDcByKey.set(nameKey, dc.name);
      }
      const idKey = normalizeDcKey(dc.id);
      if (idKey && !selectedDcByKey.has(idKey)) {
        selectedDcByKey.set(idKey, dc.name);
      }
    });

    type TechniqueAssessmentStatus = "confirmed" | "candidate";
    type TechniqueScoreCategory = "Significant" | "Partial" | "Minimal";
    interface TechniqueAssessment {
      techniqueId: string;
      techniqueName: string;
      status: TechniqueAssessmentStatus;
      scoreCategory: TechniqueScoreCategory;
      scoreValue: string;
      mappedDataComponents: string[];
      requiredDataComponents: string[];
      matchedRequiredDataComponents: string[];
      requirementCoverageRatio: number;
    }

    const techniqueById = new Map<string, {
      technique: { id: string; name: string; platforms: string[] };
      dataComponents: Set<string>;
    }>();
    resolvedComponents.forEach((dc) => {
      const inferred = mitreKnowledgeGraph.getTechniquesByDataComponentName(dc.name);
      inferred.forEach((tech) => {
        if (!techniqueById.has(tech.id)) {
          techniqueById.set(tech.id, {
            technique: {
              id: tech.id,
              name: tech.name,
              platforms: tech.platforms || [],
            },
            dataComponents: new Set(),
          });
        }
        techniqueById.get(tech.id)?.dataComponents.add(dc.name);
      });
    });

    const assessTechnique = (
      techniqueId: string,
      techniqueName: string,
      mappedDataComponents: Set<string>
    ): TechniqueAssessment => {
      const mappedList = Array.from(mappedDataComponents).sort((a, b) => a.localeCompare(b));
      const requirements = mitreKnowledgeGraph.getLogRequirements(techniqueId);
      const requiredDcByKey = new Map<string, string>();
      requirements.forEach((requirement) => {
        const rawCandidates = [
          requirement.dataComponentName,
          requirement.dataComponentId,
        ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
        rawCandidates.forEach((candidate) => {
          extractDcNameVariants(candidate).forEach((variant) => {
            const key = normalizeDcKey(variant);
            if (!key || requiredDcByKey.has(key)) return;
            requiredDcByKey.set(key, variant);
          });
        });
      });

      const matchedRequiredDataComponents: string[] = [];
      requiredDcByKey.forEach((label, key) => {
        const selected = selectedDcByKey.get(key);
        if (selected) {
          matchedRequiredDataComponents.push(selected || label);
        }
      });

      const requiredDataComponents = Array.from(new Set(Array.from(requiredDcByKey.values()))).sort((a, b) => a.localeCompare(b));
      const requiredCount = requiredDataComponents.length;
      const dedupedMatched = Array.from(new Set(matchedRequiredDataComponents));
      const matchedCount = dedupedMatched.length;
      const requirementCoverageRatio = requiredCount > 0 ? matchedCount / requiredCount : 0;

      let status: TechniqueAssessmentStatus = "candidate";
      let scoreCategory: TechniqueScoreCategory = "Minimal";

      if (requiredCount > 0 && (requirementCoverageRatio >= 0.6 || (matchedCount >= 3 && requirementCoverageRatio >= 0.25))) {
        status = "confirmed";
        scoreCategory = requirementCoverageRatio >= 0.85 || (matchedCount >= 5 && requirementCoverageRatio >= 0.5) ? "Significant" : "Partial";
      }

      const scoreValue = requiredCount > 0
        ? `Guided telemetry ${matchedCount}/${requiredCount} required DCs`
        : `Guided telemetry ${mappedList.length} mapped DC${mappedList.length === 1 ? "" : "s"}`;

      return {
        techniqueId,
        techniqueName,
        status,
        scoreCategory,
        scoreValue,
        mappedDataComponents: mappedList,
        requiredDataComponents,
        matchedRequiredDataComponents: dedupedMatched.sort((a, b) => a.localeCompare(b)),
        requirementCoverageRatio: Number(requirementCoverageRatio.toFixed(3)),
      };
    };

    const techniqueAssessments = new Map<string, TechniqueAssessment>();
    techniqueById.forEach(({ technique, dataComponents }) => {
      techniqueAssessments.set(
        technique.id,
        assessTechnique(technique.id, technique.name || technique.id, dataComponents)
      );
    });

    const techniquesByPlatform = new Map<string, Array<{
      id: string;
      name: string;
      dataComponents: Set<string>;
      assessment: TechniqueAssessment;
    }>>();
    normalizedPlatforms.forEach((platform) => {
      techniquesByPlatform.set(platform, []);
    });

    const matchedTechniqueIds = new Set<string>();
    techniqueById.forEach(({ technique, dataComponents }) => {
      const assessment = techniqueAssessments.get(technique.id)
        || assessTechnique(technique.id, technique.name || technique.id, dataComponents);
      normalizedPlatforms.forEach((platform) => {
        if (!platformMatchesAny(technique.platforms, [platform])) return;
        matchedTechniqueIds.add(technique.id);
        techniquesByPlatform.get(platform)?.push({
          id: technique.id,
          name: technique.name,
          dataComponents,
          assessment,
        });
      });
    });

    const WIZARD_GUIDED_SOURCE = "wizard_questions";
    const existingCaps = await db
      .select({ id: ssmCapabilities.id })
      .from(ssmCapabilities)
      .where(and(
        eq(ssmCapabilities.productId, productId),
        eq(ssmCapabilities.source, WIZARD_GUIDED_SOURCE)
      ));

    if (existingCaps.length > 0) {
      const capIds = existingCaps.map(cap => cap.id);
      await db.delete(ssmMappings).where(inArray(ssmMappings.capabilityId, capIds));
      await db.delete(ssmCapabilities).where(inArray(ssmCapabilities.id, capIds));
    }

    let mappingsCreated = 0;
    for (const platform of normalizedPlatforms) {
      const techniquesForPlatform = techniquesByPlatform.get(platform) || [];
      if (techniquesForPlatform.length === 0) continue;

      const [capability] = await db.insert(ssmCapabilities).values({
        productId,
        capabilityGroupId: `${WIZARD_GUIDED_SOURCE}_${slugifyPlatform(platform)}_${productId}`,
        name: `Guided Telemetry Coverage (${platform})`,
        description: `Telemetry coverage derived from guided questions.`,
        platform,
        source: WIZARD_GUIDED_SOURCE,
      }).returning();

      const mappings = techniquesForPlatform.map((tech) => ({
        capabilityId: capability.id,
        techniqueId: tech.id,
        techniqueName: tech.name || tech.id,
        mappingType: "Detect",
        scoreCategory: tech.assessment.scoreCategory,
        scoreValue: tech.assessment.scoreValue,
        comments: "Guided questions",
        metadata: {
          coverage_type: "wizard_guided",
          mapped_data_components: Array.from(tech.dataComponents),
          question_ids: Array.from(questionIds),
          stream_names: Array.from(streamNames),
          technique_status: tech.assessment.status,
          required_data_components: tech.assessment.requiredDataComponents,
          matched_required_data_components: tech.assessment.matchedRequiredDataComponents,
          requirement_coverage_ratio: tech.assessment.requirementCoverageRatio,
        },
      }));

      if (mappings.length > 0) {
        await db.insert(ssmMappings).values(mappings);
        mappingsCreated += mappings.length;
      }
    }

    const matchedAssessments = Array.from(matchedTechniqueIds)
      .map((techniqueId) => techniqueAssessments.get(techniqueId))
      .filter((assessment): assessment is TechniqueAssessment => Boolean(assessment))
      .sort((a, b) => a.techniqueId.localeCompare(b.techniqueId));

    const statusCounts = matchedAssessments.reduce(
      (acc, assessment) => {
        acc[assessment.status] += 1;
        return acc;
      },
      { confirmed: 0, candidate: 0 }
    );

    res.json({
      techniques: matchedTechniqueIds.size,
      techniqueIds: Array.from(matchedTechniqueIds),
      confirmedTechniques: statusCounts.confirmed,
      candidateTechniques: statusCounts.candidate,
      statusCounts,
      techniqueStates: matchedAssessments,
      dataComponents: resolvedComponents.length,
      sources: Array.from(dataSources),
      platforms: normalizedPlatforms,
      streams: streamNames.size,
      mappingsCreated,
      missingDataComponents: Array.from(missingNames),
    });
}));

export default router;
