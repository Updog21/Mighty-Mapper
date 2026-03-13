import { z } from "zod";
import { PLATFORM_VALUES } from "../platforms";

// The Rubric Enums (Strictly enforced)
export const SsmCategoryEnum = z.enum(["Protect", "Detect", "Respond", "Observe"]);
export const SsmScoreValueEnum = z.enum(["Minimal", "Partial", "Significant"]);
export const SsmPlatformEnum = z.enum(PLATFORM_VALUES);
export const SsmCoverageKindEnum = z.enum(["detect", "visibility", "candidate"]);
export const SsmEvidenceTierEnum = z.enum(["strong", "medium", "weak"]);
export const SsmValidationStatusEnum = z.enum(["pending", "valid", "invalid", "uncertain"]);

// 1. The Mapping (Child)
export const SsmMappingSchema = z.object({
  id: z.number().optional(), // Optional for input, present for output
  techniqueId: z.string(),
  techniqueName: z.string(),
  mappingType: SsmCategoryEnum,
  coverageKind: SsmCoverageKindEnum.default("detect"),
  evidenceTier: SsmEvidenceTierEnum.default("medium"),
  mappingMethod: z.string().optional().nullable(),
  validationStatus: SsmValidationStatusEnum.optional().nullable(),
  aiConfidence: z.number().int().optional().nullable(),
  scoreCategory: SsmScoreValueEnum,
  scoreValue: z.string().optional(),
  comments: z.string().optional(),
  metadata: z.record(z.any()).optional().nullable(),
});

// 2. The Capability (Parent)
export const SsmCapabilitySchema = z.object({
  id: z.number().optional(),
  capabilityGroupId: z.string(),
  name: z.string(),
  description: z.string().optional().nullable(),
  platform: z.string(), // Use string to allow flexibility or use SsmPlatformEnum
  source: z.string().optional(),
  mappings: z.array(SsmMappingSchema), // Nested Mappings
});

// 3. The API Response (Array of Capabilities)
export const SsmResponseSchema = z.array(SsmCapabilitySchema);

export type SsmCapability = z.infer<typeof SsmCapabilitySchema>;
export type SsmMapping = z.infer<typeof SsmMappingSchema>;

export const ProductStreamSchema = z.object({
  id: z.number().optional(),
  productId: z.number(),
  name: z.string().min(1),
  streamType: z.enum(["log", "alert", "metric"]).default("log"),
  config: z.object({
    transport: z.string().optional(),
    format: z.string().optional(),
    sampleEvents: z.array(z.any()).optional(),
  }).optional(),
  mappedDataComponents: z.array(z.string()).optional(),
  isConfigured: z.boolean().default(false),
});

export type ProductStream = z.infer<typeof ProductStreamSchema>;
