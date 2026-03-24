# Required Changes — Mighty-Mapper Auto-Mapping & Scenario Filter

All findings from a comprehensive codebase review. Items marked DONE were applied and verified with clean TypeScript compilation.

---

## Critical — Auto-Mapper Pipeline

### 1. Gap Analysis Over-Count
**File:** `server/services/gap-analysis-service.ts` — `getCoverageGaps()` (line 183)
**Bug:** The `covered` CTE unions `strict_covered` with `platform_techniques`, marking techniques as covered even when the product doesn't provide the required telemetry.
**Fix:** Split into two CTEs: `covered` (product-scoped, only techniques reachable through the product's own DC/analytic/strategy graph) and `platform_relevant` (universe scope for denominator). The coverage percentage should be `covered / platform_relevant`, not the current inflated value.

### 2. CTID SSM Platform Duplication
**File:** `server/auto-mapper/service.ts` — `writeCtidSSM()` (line 678)
**Bug:** Writes every CTID mapping for every platform without filtering. A Windows-only rule gets written as coverage for Linux/macOS too.
**Fix:** Add the same `isRuleRelevantToPlatform()` check that `writeCommunitySSM()` uses (line 479).

### 3. Confidence Floor Too High
**File:** `server/auto-mapper/service.ts` — `calculatePublishedConfidence()` (line 200)
**Bug:** Base score of 35 means a single weak analytic with no validation scores ~54%. This overstates confidence for thin evidence.
**Fix:** Change to dynamic base: `15 + avgEvidence * 20`. A single weak analytic then scores ~28%; strong evidence still reaches high confidence.

### 4. Unvalidated Analytics Weighted Too High
**File:** `server/auto-mapper/service.ts` — `validationWeight()` (line 185)
**Bug:** Default weight for unvalidated analytics is 0.9 — nearly as trusted as validated ones.
**Fix:** Lower to 0.7. This meaningfully distinguishes validated from unvalidated in the confidence formula.

### 5. Validation Error Permanently Invalidates Rules
**File:** `server/services/validation-service.ts` — error handler (line 85)
**Bug:** On Gemini API errors, returns `isValid: false, confidence: 0`. A transient timeout permanently marks the rule invalid.
**Fix:** Return `isValid: true, confidence: 30` with reasoning `"AI Validation inconclusive due to error"`. This treats errors as uncertain, not invalid.

### 6. AI Validation Batch Limit Too Small
**File:** `server/auto-mapper/service.ts` — `validateAnalytics()` (line 847)
**Bug:** Only validates 5 analytics per run. Products with 50+ rules leave most unvalidated.
**Fix:** Increase to 20. Consider prioritizing inferred rules over explicit ones.

---

## Critical — Adapter Accuracy

### 7. Sigma `query` Serialized as `[object Object]`
**File:** `server/auto-mapper/adapters/sigma.ts` — `normalizeMappings()`
**Bug:** Sigma's parsed YAML `detection` block is a JS object. When stored as `query`, it becomes `"[object Object]"` in AI validation prompts and metadata.
**Fix:** `JSON.stringify(detection, null, 2)` before storing as `query`.

### 8. Sigma/Splunk `requiresValidation` Inverted
**File:** `server/auto-mapper/adapters/sigma.ts` (line 345), `server/auto-mapper/adapters/splunk.ts` (line 276)
**Bug:** Both set `requiresValidation: true` only when the rule has explicit technique IDs. Inferred rules — which need validation more — are skipped.
**Fix:** Set `requiresValidation: true` for all analytics, or at minimum for inferred ones.

### 9. MitreStix Adapter Produces Zero Technique IDs
**File:** `server/auto-mapper/adapters/mitre-stix.ts` — `normalizeMappings()` (line 114)
**Bug:** Creates analytics with no `techniqueIds`, `coverageKind: 'candidate'`, `evidenceTier: 'weak'`. Never calls the knowledge graph to infer techniques from matched data components.
**Fix:** For each matched `x-mitre-data-component`, call `mitreKnowledgeGraph.getTechniquesByDataComponentName()` to populate `techniqueIds`. Set `coverageKind: 'visibility'` and `mappingMethod: 'stream_data_component_inference'`.

### 10. Azure `ruleMatches` Missing Description
**File:** `server/auto-mapper/adapters/azure.ts` — `ruleMatches()` (line 197)
**Bug:** `haystackParts` includes `fileName`, `name`, `connectorIds`, `dataTypes` but not `description`. Rules whose description mentions the product are missed.
**Fix:** Add `rule.description` to `haystackParts`.

### 11. DC Fan-Out Inflates Coverage
**File:** `server/auto-mapper/adapters/sigma.ts` (Tier 2 inference), also Splunk/Azure
**Bug:** A single data component can map to 50+ techniques. One Sigma rule with `Sysmon` in its log source infers coverage for dozens of techniques at `weak` tier.
**Fix:** When more than 15 techniques are inferred from a single DC, downgrade `evidenceTier` to `'weak'` and `coverageKind` to `'candidate'` (not `'visibility'`).

---

## High — Knowledge Graph & Inference

### 12. Partial-Match Nondeterminism in Knowledge Graph
**File:** `server/mitre-stix/knowledge-graph.ts` — `getTechniquesByTacticAndDataComponent()` (line 1810), `getTechniquesByDataComponentName()` (line 1917)
**Bug:** When no exact DC name match exists, falls back to substring matching. Last Map iteration wins — result is nondeterministic.
**Fix:** Among all substring matches, prefer the shortest matching name (most specific). Break ties alphabetically for reproducibility.

### 13. AI-Returned `techniqueId` Discarded
**File:** `server/services/validation-service.ts` (line 82), `server/auto-mapper/service.ts`
**Bug:** The Gemini validation response includes `techniqueId` but it's captured and never used. An AI-corrected technique ID could improve inferred mappings.
**Fix:** In `validateAnalytics()`, when the AI returns a `techniqueId` and the analytic has no explicit technique IDs, add it to the analytic's `techniqueIds`.

### 14. Low-Confidence Validation Not Marked Uncertain
**File:** `server/auto-mapper/service.ts` — validation result processing
**Bug:** A validation with `confidence: 25` still gets `validationStatus: 'valid'` or `'invalid'`. Low-confidence results should be `'uncertain'`.
**Fix:** Set `validationStatus: 'uncertain'` when `aiConfidence < 40`.

### 15. `combineAllMappings` Only Gets Successful Sources
**File:** `server/auto-mapper/service.ts` — `combineAllMappings()` (line 909)
**Bug:** Confidence calculation only receives `successfulSources` — it doesn't know total attempted sources. A product where 1/6 adapters returned data looks as confident as one where 6/6 did.
**Fix:** Pass `combinedSources` (all attempted) so the confidence formula can penalize thin source coverage.

### 16. `validationStatus: 'valid'` Overwritten by `'invalid'` in Merge
**File:** `server/auto-mapper/service.ts` — `combineAllMappings()`
**Bug:** When merging the same analytic from multiple sources, a later `'invalid'` status overwrites an earlier `'valid'`.
**Fix:** Preserve `'valid'` from either source. Only downgrade to `'invalid'` if no source marked it valid.

---

## High — Scenario Technique Filter (Client)

### 17. Multi-Tactic Techniques Only Check First Tactic
**File:** `client/src/components/ProductView.tsx` — `getScenarioDropReasons()` (line 302), `getScenarioBoostMultiplier()` (line 321)
**Bug:** `resolveTacticName()` (line 1294) returns a single tactic. Techniques with multiple tactics (e.g., T1078 spans Initial Access, Persistence, Privilege Escalation, Defense Evasion) are only evaluated against the first.
**Fix:** Create `resolveAllTactics()` returning `string[]`. In drop/boost logic, check if *any* tactic triggers the condition (for drops: drop only if *all* tactics would drop; for boosts: boost if *any* tactic would boost).

### 18. Sigma/Splunk-Only Products Get All-Zero Scores
**File:** `client/src/components/ProductView.tsx` — `scenarioTechniqueInsights` useMemo (line 2128)
**Bug:** Scoring formula: `rawBase = (0.4 × strategyNorm) + (0.3 × analyticNorm) + (0.3 × dcNorm)`. For products with only Sigma/Splunk data, `ingestStrategies` finds no detection strategies → `strategyNorm = 0`, often making `rawBase = 0` for all techniques.
**Fix:** Add a baseline community-score path: when `strategyCount === 0` but `analyticCount > 0`, use `rawBase = (0.5 × analyticNorm) + (0.5 × dcNorm)`. This ensures community-sourced analytics still produce nonzero scores.

### 19. Empty `allowedSet` Blanks the View
**File:** `client/src/components/ProductView.tsx` — Scenario filter logic
**Bug:** If all 6 scenario booleans are false, `allowedSet` is empty, filtering out every technique. The user sees a blank view with no explanation.
**Fix:** When `allowedSet` is empty, bypass filtering and show all techniques with a notice that no scenario constraints are active.

---

## Medium — Pipeline Robustness

### 20. Wizard `matchedCount >= 3` Without Ratio Guard
**File:** `server/routes.ts` — `assessTechnique()` (line 536)
**Bug:** Threshold is `requirementCoverageRatio >= 0.6 || matchedCount >= 3`. A technique requiring 20 DCs passes with only 3 matched (15%).
**Fix:** Change to `requirementCoverageRatio >= 0.6 || (matchedCount >= 3 && requirementCoverageRatio >= 0.25)`.

### 21. Wizard `assessTechnique` Double-Counts DCs
**File:** `server/routes.ts` — `assessTechnique()` (line 536)
**Bug:** `matchedRequiredDataComponents` can count the same DC twice — once via ID match and once via name match.
**Fix:** Deduplicate via a Set of DC IDs before counting.

### 22. Graph Bridge `onConflictDoNothing`
**File:** `server/lib/graph-bridge.ts` — `upsertProductNode()` (line 12)
**Bug:** Uses `onConflictDoNothing()`. If a product's platforms change, the graph node retains stale data.
**Fix:** Change to `onConflictDoUpdate()` to propagate platform/metadata changes.

### 23. Product Search Terms Too Narrow
**File:** `server/services/product-service.ts` — `buildSearchTerms()` (line 99)
**Bug:** Only adds `"vendor productName"` combined. A search for "CrowdStrike Falcon" won't match rules mentioning just "Falcon" or just "CrowdStrike".
**Fix:** Add product-name-only and vendor-name-only terms. Exclude generic vendors ("Microsoft", "Cisco") from standalone vendor terms to avoid over-matching.

### 24. Cached Mappings Bypass AI Validation
**File:** `server/auto-mapper/service.ts`
**Bug:** When mappings are loaded from cache, analytics that were never validated remain unvalidated.
**Fix:** After loading cached results, run the validation pass on any analytics with `validationStatus === undefined`.

### 25. Validation Only for Sigma/Splunk
**File:** `server/auto-mapper/service.ts` — `validateAnalytics()`
**Bug:** AI validation is only applied to Sigma and Splunk analytics. Elastic and Azure rules are never validated.
**Fix:** Extend validation to all adapter sources.

---

## Medium — Adapter Edge Cases

### 26. Elastic TOML Parser Fragility
**File:** `server/auto-mapper/adapters/elastic.ts`
**Bug:** Uses fragile regex-based TOML parsing. Multi-line strings, escaped quotes, and nested tables can produce incorrect results.
**Fix:** Replace with a TOML parsing library (e.g., `@iarna/toml` or `smol-toml`).

### 27. Splunk Key-Only Source Extraction
**File:** `server/auto-mapper/adapters/splunk.ts` — `extractRawSource()` (line 388)
**Bug:** Extracts `sourcetype=` and `index=` from SPL queries via regex. Misses `source=`, `eventtype=`, and tstats-style references.
**Fix:** Add regex patterns for `source=`, `eventtype=`, and `| tstats ... from datamodel=`.

### 28. CTID Search Scope Limited to `security-stack/`
**File:** `server/auto-mapper/adapters/ctid.ts`
**Bug:** Only searches files under `security-stack/` directory. CTID mappings in other directories are missed.
**Fix:** Expand search scope to include all CTID mapping directories, or make the path configurable.

### 29. Sigma Tag Regex Misses
**File:** `server/auto-mapper/adapters/sigma.ts`
**Bug:** Technique ID extraction relies on `attack.tXXXX` tag format. Some Sigma rules use `attack.technique.tXXXX` or other variants.
**Fix:** Broaden the regex to capture variant tag formats.

### 30. Azure `relevantTechniques` Not Deep-Collected
**File:** `server/auto-mapper/adapters/azure.ts` — `parseYaml()` (line 161)
**Bug:** `relevantTechniques` is read from top-level only. Some Azure rules nest technique IDs inside `tactics` or `metadata` sub-objects.
**Fix:** Use the `collectValues()` helper (already in the file) to deep-collect `relevantTechniques`.

---

## Low — Scenario Filter Edge Cases

### 31. `humanSurface` Drops T1557 Debatably
**File:** `client/src/components/ProductView.tsx` — `HUMAN_SURFACE_DENYLIST`
**Issue:** T1557 (Adversary-in-the-Middle) is in the denylist, but AitM attacks like EvilGinx do require human interaction. This is a judgment call.
**Fix:** Review and potentially remove T1557 from the denylist, or add a comment explaining the rationale.

### 32. `v18Data.usedByGroups` Unused
**File:** `client/src/components/ProductView.tsx`
**Issue:** Threat group data is fetched but never used in scoring. Techniques used by many groups could be weighted higher.
**Fix:** Optional enhancement — factor `usedByGroups.length` into the boost multiplier for high-activity techniques.

### 33. Tactic Diversity Threshold Off-by-One
**File:** `client/src/components/ProductView.tsx` — scoring logic
**Bug:** Tactic diversity bonus uses `>= 3` unique tactics threshold but the check may be off by one depending on how subtechniques inherit parent tactics.
**Fix:** Verify threshold accounts for tactic inheritance; consider `>= 2` for subtechniques.

### 34. `strategyCount` Double-Counts Prolific Techniques
**File:** `client/src/components/ProductView.tsx` — `scenarioTechniqueInsights`
**Bug:** A single detection strategy that covers multiple techniques gets counted once per technique, inflating `strategyCount` for well-covered areas.
**Fix:** Count unique strategy IDs rather than total associations.

### 35. Synthetic `DS-` Prefix on Detection Strategies
**File:** `server/auto-mapper/service.ts` — multiple adapters
**Bug:** Detection strategy IDs are prefixed with `DS-` (e.g., `DS-T1059`). This prefix is not part of any standard and can confuse lookups.
**Fix:** Remove the `DS-` prefix. Verify backward compatibility in `useAutoMapper.ts` (line 191), `combineAllMappings` (line 891), and `resolveMappingStreams` (line 381).

---

## Summary by Area

| Area | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| Auto-Mapper Pipeline | 6 | 4 | 6 | 1 |
| Adapters | 5 | — | 5 | — |
| Knowledge Graph | 2 | — | — | — |
| Scenario Filter | — | 3 | — | 4 |
| **Total** | **13** | **7** | **11** | **5** |
