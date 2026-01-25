# Fix for "Unknown" Tactics in Vendor Products Pages

## Problem Summary

Vendor Products pages were displaying "Unknown" tactics for MITRE techniques, which should never happen because all techniques should be mapped to at least one tactic.

### Root Cause Analysis

The issue resulted from a **multi-layer failure chain**:

1. **STIX Data Gap** (`server/mitre-stix/knowledge-graph.ts:425`)
   - Some techniques in the MITRE STIX bundle lack `kill_chain_phases`
   - When extracted, these techniques end up with empty tactic arrays

2. **Incomplete Hydration** (`server/mitre-stix/knowledge-graph.ts:618-649`)
   - `hydrateTechniqueTactics()` only used kill_chain_phases as source
   - No fallback recovery for techniques with missing phase data
   - Subtechniques would inherit from parents, but orphaned techniques remained empty

3. **Database Persistence** (`server/mitre-stix/knowledge-graph.ts:234`)
   - Empty tactics arrays were written to the `nodes` table without validation
   - No warning was logged when this occurred

4. **Coverage Service Limitation** (`server/services/coverage-service.ts:31, 79`)
   - Query: `COALESCE(n.attributes->'tactics', '[]'::jsonb) AS tactics`
   - Returns empty array when database is incomplete
   - No fallback to knowledge graph for recovery

5. **Frontend Cascade** (`client/src/components/ProductView.tsx:643`)
   - `resolveTacticName()` returned "Unknown" as last resort
   - Static fallback data insufficient (only 11 techniques in mitreData.ts)

---

## Solution Implemented

### Tier 1: Enhanced Knowledge Graph Hydration

**File**: `server/mitre-stix/knowledge-graph.ts`

**Changes**:
- Added a **3-pass hydration system** in `hydrateTechniqueTactics()`:
  1. **PASS 1**: Extract tactics from kill_chain_phases (primary source)
  2. **PASS 2**: Inherit from parent techniques for subtechniques (recovery for missing data)
  3. **PASS 3**: Log warning for techniques still missing tactics after all recovery attempts

**Code**:
```typescript
private hydrateTechniqueTactics(): void {
  const resolved = new Map<string, string[]>();
  const missingTactics: string[] = []; // Track techniques with missing tactics

  // PASS 1: Extract tactics from kill_chain_phases
  this.techniqueByStixId.forEach((tech, stixId) => {
    const phases = this.techniquePhaseMap.get(stixId) || [];
    const tacticNames = phases.map(phase => {
      const tactic = this.tacticMap.get(phase.toLowerCase());
      return tactic ? tactic.name : this.formatTacticName(phase);
    }).filter(Boolean);

    const unique = Array.from(new Set(tacticNames));
    if (unique.length > 0) {
      tech.tactics = unique;
      const byId = this.techniqueMap.get(tech.id);
      if (byId) byId.tactics = unique;
      resolved.set(stixId, unique);
    } else {
      missingTactics.push(`${tech.id} (${tech.name})`);
    }
  });

  // PASS 2: Inherit tactics from parent technique (for subtechniques)
  this.techniqueByStixId.forEach((tech, stixId) => {
    if (tech.tactics.length > 0) return;
    const parentStixId = this.subtechniqueParents.get(stixId);
    if (!parentStixId) return;
    const parentTactics = resolved.get(parentStixId) || this.techniqueByStixId.get(parentStixId)?.tactics || [];
    if (parentTactics.length === 0) return;
    tech.tactics = parentTactics;
    const byId = this.techniqueMap.get(tech.id);
    if (byId) byId.tactics = parentTactics;
    missingTactics.splice(missingTactics.indexOf(`${tech.id} (${tech.name})`), 1);
  });

  // PASS 3: Log warning for techniques with missing tactics after all recovery attempts
  if (missingTactics.length > 0) {
    console.warn(
      `[MITRE Knowledge Graph] ${missingTactics.length} techniques missing tactics after hydration:\n${missingTactics.join('\n')}`,
      '\nThese techniques may have missing kill_chain_phases in the STIX bundle.'
    );
  }
}
```

**Benefits**:
- Identifies exactly which techniques lack tactic data
- Attempts to recover missing data through inheritance
- Provides diagnostic logging for debugging

---

### Tier 2: Public API for Fallback Recovery

**File**: `server/mitre-stix/knowledge-graph.ts` (new method)

**Changes**:
- Added public `getTactics(techniqueId: string): string[]` method
- Allows other services to query tactics from knowledge graph
- Returns empty array if technique not found

**Code**:
```typescript
/**
 * Get tactics for a technique from the knowledge graph
 * Useful as a fallback when database has incomplete data
 * @param techniqueId - The technique ID (e.g., "T1234")
 * @returns Array of tactic names, or empty array if not found
 */
getTactics(techniqueId: string): string[] {
  const technique = this.getTechnique(techniqueId);
  return technique?.tactics || [];
}
```

---

### Tier 3: Coverage Service Fallback Mechanism

**File**: `server/services/coverage-service.ts`

**Changes**:
1. Added import: `import { mitreKnowledgeGraph } from "../mitre-stix/knowledge-graph";`
2. Added fallback logic in both query result mappings (product-specific and global coverage):

**Code** (both query result handlers):
```typescript
// Fallback to knowledge graph if database has no tactics
if (tactics.length === 0) {
  const kgTactics = mitreKnowledgeGraph.getTactics(String(row.technique_id));
  if (kgTactics.length > 0) {
    tactics = kgTactics;
  }
}
```

**Flow**:
1. Query database for tactics
2. If database has data, use it
3. If database returns empty array, query knowledge graph
4. If knowledge graph has tactics, use those
5. Only if both are empty will it remain empty (very rare case)

---

## Impact & Benefits

### Before Fix
- Techniques with missing kill_chain_phases → empty tactics → "Unknown" on Products page
- No visibility into which techniques had missing data
- No recovery mechanism for incomplete database state

### After Fix
- **Tier 1**: Hydration process identifies and logs missing tactics with specific technique IDs
- **Tier 2**: Knowledge graph exposes tactics via public API
- **Tier 3**: Coverage service automatically falls back to knowledge graph if database is incomplete
- **Result**: "Unknown" tactics should be virtually eliminated, unless a technique is genuinely missing from the STIX bundle entirely

### Diagnostic Benefits
- Server logs now show exactly which techniques lack tactics
- Can identify if STIX bundle is missing kill_chain_phases for specific techniques
- Enables data quality monitoring and STIX bundle validation

---

## Files Modified

| File | Changes | Lines |
|------|---------|-------|
| `server/mitre-stix/knowledge-graph.ts` | Enhanced hydration + new public method | 618-761 |
| `server/services/coverage-service.ts` | Added import + fallback logic (2 places) | 1-3, 65-71, 120-126 |

---

## Testing Recommendations

1. **Check Server Logs**: Look for `[MITRE Knowledge Graph]` warnings during initialization
   - Should show list of techniques missing tactics (if any)
   - Helps identify STIX bundle quality issues

2. **Verify Products Page**:
   - Check that all techniques now show a tactic (not "Unknown")
   - If "Unknown" appears, check server logs for the specific technique ID

3. **Query Coverage API**:
   ```bash
   curl "http://localhost:5000/api/graph/coverage?productId=<product_id>"
   ```
   - Verify `tactics` array is populated for all techniques
   - Should be non-empty for all entries

4. **Test Fallback**:
   - Manually set a technique's tactics to `[]` in database
   - API should still return tactics from knowledge graph
   - Confirms Tier 3 fallback is working

---

## Future Improvements (Optional)

1. **STIX Bundle Validation**: Add pre-check to validate kill_chain_phases presence
2. **Tactic Inference**: Implement heuristic-based inference from technique names or descriptions
3. **Manual Mappings**: Create override table for techniques requiring manual tactic assignment
4. **Monitoring**: Add metrics to track how often fallback mechanism is triggered
5. **Persistence**: Consider persisting recovered tactics back to database to improve performance

---

## Related Issues Addressed

- **Issue**: Vendor Products pages showing "Unknown" tactics
- **Root Cause**: Multi-layer failure chain from STIX → Hydration → DB → API → Frontend
- **Solution**: 3-tier recovery system with diagnostics
- **Status**: ✅ Implemented
