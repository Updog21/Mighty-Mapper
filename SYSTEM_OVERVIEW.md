# MITRE Project: System Overview

## 1. Core Application Purpose

**The MITRE Project** is a security product mapping and detection coverage platform that bridges security tools with the MITRE ATT&CK framework.

**What It Does:**
- Maps security products (EDR, SIEM, firewalls, etc.) to MITRE ATT&CK detection strategies
- Automatically discovers what attack techniques your security stack can detect
- Identifies coverage gaps in your security posture
- Helps security teams understand what telemetry they need to detect specific attacks

**Data Sources:**
- 5 community detection rule repositories (CTID, Sigma, Splunk, Elastic, Azure)
- MITRE ATT&CK official STIX v18 framework (baseline via `mitre_stix` adapter, always runs)
- User-provided guided wizard answers
- Product stream configurations

---

## 2. High-Level Workflow

### From Product Creation to Coverage Analysis

```
1. USER CREATES PRODUCT
   ├─ Enter vendor, name, platforms (Windows/Linux/Cloud/etc)
   └─ Optionally answer guided questions or define streams

2. AUTO-MAPPER RUNS (6 adapters in parallel)
   ├─ CTID Adapter: Search official vendor mappings
   ├─ Sigma Adapter: Scan community YAML rules
   ├─ Splunk Adapter: Parse detection YAMLs
   ├─ Elastic Adapter: Extract TOML rules
   ├─ Azure Adapter: Read KQL analytics
   └─ MITRE STIX Adapter: Always runs as a baseline layer

3. KNOWLEDGE GRAPH ENRICHMENT
   ├─ Query MITRE ATT&CK for each discovered technique
   ├─ Add log sources, channels, mutable elements
   └─ Enrich with platform context

4. COVERAGE CALCULATION
   ├─ Recursive graph traversal
   ├─ For each technique: Can product detect it?
   │  (Product → Data Component → Analytic → Strategy → Technique)
   └─ Track which rules/adapters found coverage

5. RESULTS DISPLAYED
   ├─ Coverage summary (techniques by tactic)
   ├─ Detection strategies (how techniques are detected)
   ├─ Analytics (specific detection rules)
   ├─ Data components needed
   └─ Coverage gaps (techniques not detected)
```

---

## 2.1 Auto-Mapper + Wizard Decision Flow (Summary)

1. Capture vendor/product + selected MITRE platforms.
2. Run community adapters and `mitre_stix` in parallel.
3. Preserve technique IDs from matched community rules (no overwrite).
4. If no community matches or user opts in, use the platform-filtered DC wizard (manual or Gemini auto-select).
5. From selected DCs + platform, infer techniques → strategies → analytics → log sources.
6. Optional Gemini research fills vendor log name/channel/fields.
7. Save vendor product page with streams + evidence for reuse.

---

## 3. The Adapter System: 6 Data Sources

Each adapter searches a specific community source for detection rules matching the product, then normalizes and enriches the results.

### Adapter 1: CTID (Highest Priority)
**Source:** Center for Threat-Informed Defense official mappings
**Data:** JSON files with product-to-technique mappings
**Location:** `data/ctid-mappings-explorer/src/data/security-stack/*.json`

**What it does:**
- Finds JSON files matching product name/vendor
- Extracts structured capability mappings (e.g., "Product can detect T1055")
- Provides confidence scores: Minimal, Partial, Significant
- Enriches with STIX data (data components, log sources, mutable elements)

**Example:**
```json
{
  "capability_id": "CAP-001",
  "capability_description": "Process Memory Access Detection",
  "attack_object_id": "T1055",
  "attack_object_name": "Process Injection",
  "data_components": ["Process Memory Access"]
}
```

---

### Adapter 2: Sigma
**Source:** SigmaHQ community detection rules (largest repository)
**Data:** YAML-based, OS-agnostic detection query language
**Location:** `data/sigma/rules/**/*.yml` (scans 4 directories)

**How it extracts techniques:**
- **Tier 1 (90% of rules):** Direct extraction from `attack.tXXXX` tags
- **Tier 2 (10% fallback):** Infers technique from logsource category + tactic combination

**Features:**
- Batch processing (50 at a time) to prevent hangs
- AI validation (Google Gemini) for first 5 matches
- Extracts log sources from rule metadata
- Maps detection keywords to data components

**Example extraction:**
```yaml
title: Process Injection via Rundll32
logsource:
  product: windows
  service: sysmon
  event_id: 8
detection:
  ...
tags:
  - attack.defense_evasion
  - attack.t1055  # ← Extracted as technique
```

---

### Adapter 3: Splunk
**Source:** Splunk Security Content repository
**Data:** YAML analytic rules
**Location:** `data/splunk-security-content/detections/**/*.yml`

**What it does:**
- Parses `mitre_attack_id` and `data_source` fields
- Extracts SPL (Splunk Query Language) code
- If no technique ID: infers from data_source + tactic
- Maps security domains to platforms
- Captures search field names as mutable elements

---

### Adapter 4: Elastic
**Source:** Elastic detection-rules repository
**Data:** TOML-based detection rules
**Location:** `data/elastic-detection-rules/rules/**/*.toml`

**What it does:**
- Parses complex TOML structure with `rule.threat.technique` blocks
- Extracts technique IDs, sub-techniques, and tactics
- Captures `investigation.fields` as mutable elements
- Maps integration names to data sources
- Provides platform filtering

---

### Adapter 5: Azure
**Source:** Azure Sentinel community detections
**Data:** KQL (Kusto Query Language) analytics in YAML
**Location:** `data/azure-sentinel/Solutions/**/Analytic Rules/**/*.yml`

**What it does:**
- Extracts `relevantTechniques` from rule metadata
- Parses `connectorIds` for telemetry type (Office 365, Azure AD, etc)
- Infers techniques from `dataTypes` + tactics if IDs not explicit
- Captures column names as mutable elements

---

### Adapter 6: MITRE STIX (Baseline)
**Source:** MITRE ATT&CK official STIX data
**Role:** Always runs as a baseline layer (does not override community rule techniques)

**What it does:**
- Uses platform filters to suggest relevant data components
- Provides baseline detection expectations
- Helps identify which techniques *should* be detectable

---

### Adapter Execution Flow

```
runAutoMapper(productName, vendor, platform)
  │
  ├─ Resolve search terms
  │  ├─ Query ProductService for aliases
  │  ├─ Expand terms (spaces→hyphens, spaces→underscores)
  │  └─ Result: ["Windows Defender", "windows-defender", "windows_defender"]
  │
  ├─ Run adapters in parallel (concurrency limit: 2)
  │  ├─ CTID: findMappingFiles() → fetch → normalize
  │  ├─ Sigma: findRemoteRules() → parse YAML → extract techniques
  │  ├─ Splunk: findDetections() → parse YAML → extract fields
  │  ├─ Elastic: findRules() → parse TOML → extract techniques
  │  ├─ Azure: findAnalytics() → parse YAML → extract techniques
  │  └─ MITRE STIX: fetch STIX → suggest baseline DCs/analytics
  │
  ├─ Stream Resolution (NEW!)
  │  ├─ For each rawSource (data source from adapter)
  │  ├─ Try to match to configured product.streams
  │  ├─ If matched: use stream's mapped data components
  │  └─ If not matched: infer from Knowledge Graph
  │     (Only infer techniques when the rule has none)
  │
  ├─ AI Validation (Sigma/Splunk only, first 5 rules)
  │  ├─ Call Google Gemini API
  │  └─ Verify extracted technique is actually relevant
  │
  ├─ Combine all results
  │  ├─ Deduplicate techniques
  │  ├─ Track source provenance (CTID, Sigma, etc)
  │  └─ Group by platform
  │
  └─ Write SSM Capabilities
     ├─ One entry per technique per platform
     ├─ Store as ATT&CK Navigator JSON layer
     └─ Format: { "technique": "T1055", "tactic": "defense-evasion", "score": 50, "sources": [...] }
```

---

## 4. Guided Questions System: Telemetry-Driven Mapping

### Purpose
For **abstract products** (e.g., "Windows Server", "Okta", "AWS") where no pre-built rules exist, the wizard asks about telemetry capabilities to infer data component coverage.

### How It Works

**Step 1: Question Definition**
```typescript
{
  id: "win-process-creation",
  text: "Does it record process creation events?",
  dcNames: ["Process Creation", "Process Termination"],
  advanced: false
}
```

**Step 2: User Answers Questions**
- User checks "Yes, we have Sysmon process creation events"
- System maps "Process Creation" data component to product

**Step 3: Technique Inference**
- Query Knowledge Graph: "Which techniques need Process Creation?"
- Return: [T1055, T1127, T1134, T1566, T1566.002, ...] (47 techniques)
- Create SSM capability: Platform=Windows, Techniques=47, Source=Wizard, Score=Minimal

**Step 4: Stream Configuration**
- User defines streams: "Sysmon Events", "Security Event Log", "EDR Telemetry"
- Each stream maps to data components it provides
- System calculates coverage from stream DC mappings

### Question Sets by Platform

**Windows:**
- Process execution & metadata (Process Creation, Process Termination)
- File operations (File Creation, File Modification)
- Network connections (Network Connection Creation)
- Registry operations (Registry Key Creation, Registry Value Modification)
- Authentication (User Account Authentication, Password Reset)

**Linux:**
- Process execution (Process Creation, Process Termination)
- File operations (File Creation, File Modification)
- Network connections (Network Connection Creation)
- Package/sudo operations (Package/Module Load)

**Cloud (Azure/AWS/GCP):**
- Identity & access (User Account Authentication, Privilege Escalation)
- Resource operations (Application Resource Creation, API Activity)
- Network operations (Network Connection Creation)
- Data access (File Metadata Modification, Data Staged)

---

## 5. Mapper Methodology: 6-Step Process

The auto-mapper implements a rigorous methodology for discovering and validating coverage.

### Step 1: Product Discovery
**Goal:** Identify the product and resolve search aliases

```
Input: vendor="Microsoft", product="Defender"
├─ Query CTID mappings
├─ Query product aliases table
├─ Expand search terms:
│  ├─ "Microsoft Defender" (original)
│  ├─ "Microsoft-Defender" (spaces to hyphens)
│  └─ "Microsoft_Defender" (spaces to underscores)
└─ Scope adapters: Which should search?
```

### Step 2: Community Rule Matching
**Goal:** Find detection rules from 5 community adapters, while `mitre_stix` runs as baseline

Each adapter:
1. Searches its repository
2. Filters by product name/vendor match
3. Filters by platform relevance
4. Returns candidate rules

**Concurrency:** 2 adapters run in parallel (limit prevents API throttling)

### Step 3: Technique Extraction
**Goal:** Pull out attack technique IDs from rules (never overwrite explicit IDs)

**Methods (in priority order):**
1. **Direct:** Extract T-codes from tags/metadata
   ```
   tags: ["attack.t1055", "attack.t1134"]
   → Extracted: [T1055, T1134]
   ```

2. **Inference (only when no technique IDs):** Map data sources → data components → techniques
   ```
   data_source: "Windows Event Logs (Process Creation)"
   → "Process Creation" data component
   → Knowledge Graph query: "Which techniques use Process Creation?"
   → [T1055, T1127, T1566, ...]
   ```

3. **Tactic filtering:** Narrow results using associated tactic
   ```
   tactic: "defense_evasion"
   → Keep only techniques matching tactic
   ```

### Step 4: STIX Enrichment
**Goal:** Add MITRE's official context to extracted techniques

For each technique ID:
1. Query MITRE Knowledge Graph
2. Extract:
   - Tactic(s)
   - Detection strategies
   - Analytics (detection logic)
   - Required data components
   - Log sources (with channels)
   - Mutable elements (detectable evasion)
   - Platforms

### Step 5: Stream Resolution
**Goal:** Match data sources to configured product streams

```
For each detected data source:
├─ Try to match to product.streams
│  Example: "Process Creation" → "Sysmon Stream"
├─ If matched:
│  └─ Use stream's mapped data components
├─ If not matched:
│  └─ Use Knowledge Graph inference
└─ Mark as "verified" or "heuristic"
```

### Step 6: SSM Persistence
**Goal:** Store results in ATT&CK Navigator format

Write to `ssm_capabilities` table:
```typescript
{
  platform: "Windows",
  technique_id: "T1055",
  tactic: "defense-evasion",
  score_category: "Partial",        // From CTID or inferred
  score: 50,
  sources: ["CTID", "Sigma"],       // Which adapters found it
  analytics_count: 12,               // How many rules
  data_components: ["Process Memory Access"]
}
```

---

## 6. Data Flow: Adapters → Graph → Products → Coverage

### Complete Data Architecture

```
┌─────────────────────────────────────────────────────┐
│              EXTERNAL SOURCES                       │
├─────────────────────────────────────────────────────┤
│  • MITRE ATT&CK STIX (enterprise-attack.json)       │
│  • CAR Analytics (analytics.json)                   │
│  • CTID Mappings (security-stack/*.json)            │
│  • Sigma Rules (rules/**/*.yml)                     │
│  • Splunk Detections (detections/**/*.yml)          │
│  • Elastic Rules (rules/**/*.toml)                  │
│  • Azure Sentinel (Solutions/**/Analytic Rules/*.yml)
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
        ┌─────────────────────┐
        │   AUTO-MAPPER       │
        │   (5 Adapters)      │
        └──────────┬──────────┘
                   │
                   ▼
    ┌──────────────────────────────────────┐
    │     NORMALIZED MAPPINGS              │
    │  (Techniques, Analytics, DCs)        │
    └──────────────────┬───────────────────┘
                       │
                       ▼
    ┌──────────────────────────────────────────────┐
    │     KNOWLEDGE GRAPH (PostgreSQL)             │
    ├──────────────────────────────────────────────┤
    │ NODES:                                       │
    │  • Techniques (attack-pattern)               │
    │  • Detection Strategies                      │
    │  • Analytics (detection rules)               │
    │  • Data Components                           │
    │  • Data Sources                              │
    │  • Products (added by users)                 │
    │                                              │
    │ EDGES:                                       │
    │  • detects: Strategy → Technique             │
    │  • uses: Strategy → Analytic                 │
    │  • looks_for: Analytic → Data Component      │
    │  • provides: Product → Data Component        │
    └──────────────────┬───────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────┐
        │  COVERAGE ENGINE         │
        │ (Recursive SQL Queries)  │
        ├──────────────────────────┤
        │ For each technique:      │
        │ Can product detect it?   │
        │                          │
        │ Traversal:               │
        │ Product → DC → Analytic  │
        │ → Strategy → Technique   │
        └──────────────┬───────────┘
                       │
                       ▼
    ┌──────────────────────────────────────┐
    │    FRONTEND (React UI)               │
    ├──────────────────────────────────────┤
    │  ProductView                         │
    │  ├─ Coverage summary by tactic       │
    │  ├─ Detected vs undetected stats     │
    │  └─ Navigator heatmap                │
    │                                      │
    │  Detection Strategies                │
    │  ├─ How each technique is detected   │
    │  └─ Which products can detect it     │
    │                                      │
    │  Analytics Detail                    │
    │  ├─ Specific detection rules         │
    │  ├─ Rule sources (Sigma, Splunk)     │
    │  └─ Implementation (KQL, SPL, YAML)  │
    │                                      │
    │  Coverage Gaps                       │
    │  ├─ Undetected techniques            │
    │  └─ Recommendations                  │
    └──────────────────────────────────────┘
```

**Edge provenance (current ingest)**  
- `detects` edges are created for Strategy → Technique and Data Component → Technique.  
- Strategy → Technique `detects` edges include `edges.attributes.provenance` (STIX relationship when present).  
- Data Component → Technique `detects` edges are **derived** unless ingested from STIX `relationship` objects (feature-detected); derived edges carry `edges.attributes.provenance`.  
- `uses` and `looks_for` edges are created from STIX `_ref/_refs` fields (not STIX `relationship` objects), so their provenance is "stix_ref_field."  
- Some ATT&CK bundles may include explicit relationship objects; ingestion feature-detects those and prefers them when present, otherwise derives edges from STIX reference fields/metadata.

### Storage Layers

**1. Relational Tables** (Product & Mapping Data)
- `products` - Product metadata, platforms, stream configs
- `product_streams` - Configured log sources
- `ssm_capabilities` - ATT&CK Navigator layers
- `ssm_mappings` - Individual technique capability entries

**2. Graph Tables** (MITRE Context)
- `nodes` - STIX objects (techniques, strategies, analytics, DCs)
  - Indexed: (dataset, type, external_id)
  - Indexed: (attributes->'externalId')
- `edges` - Relationships between nodes
  - Indexed: (source_id, target_id, type)
  - `attributes` JSONB for edge provenance (where applicable)

**3. In-Memory Cache** (Performance)
- Technique → Strategies mapping
- Strategy → Analytics mapping
- Analytics → Data Components mapping
- Data Component → Techniques (reverse lookup; derived convenience)

---

## 7. Key Concepts: MITRE ATT&CK Terminology

### The Framework Hierarchy

```
TACTIC (Why did the attacker do this?)
  └─ TECHNIQUE (What specific behavior did they use?)
      └─ SUB-TECHNIQUE (How did they carry out that behavior?)

DETECTION (How do we find the behavior?)
  └─ DETECTION STRATEGY (What's our conceptual approach?)
      └─ ANALYTIC (What specific logic detects it?)
          └─ DATA COMPONENT (What evidence do we need?)
              └─ DATA SOURCE (Where does that evidence come from?)
                  └─ LOG SOURCE / CHANNEL (Which specific log stream?)
```

### Core Definitions

**Technique** (e.g., T1055 - Process Injection)
- A specific adversary behavior or capability
- How an attacker carries out a tactic
- Example behaviors: Modifying registry, Injecting code, Exfiltrating data

**Tactic** (e.g., Defense Evasion)
- The adversary's goal or objective
- Why they perform the technique
- 14 tactics: Reconnaissance, Resource Development, Initial Access, Execution, Persistence, Privilege Escalation, Defense Evasion, Credential Access, Discovery, Lateral Movement, Collection, Command & Control, Exfiltration, Impact

**Detection Strategy** (e.g., "Monitor for suspicious process injection attempts")
- A conceptual approach to detecting a technique
- Describes what type of detection would work
- Not tied to a specific tool or technology

**Analytic** (e.g., "Find processes with suspicious memory allocation patterns")
- A specific detection rule or logic
- Pseudocode describing detection logic
- Platform-specific (Windows, Linux, macOS, Cloud)
- Includes: detection query, expected fields, false positive considerations

**Data Component** (e.g., "Process Memory Access")
- A specific type of telemetry or evidence
- What you're looking at to detect behavior
- Examples: Process Creation, File Modification, Network Connection, Registry Key Creation
- Belongs to a Data Source

**Data Source** (e.g., "Process" data source)
- A system or sensor that emits telemetry
- Groups related data components
- Examples: Process, File, Network, Windows Event Logs, Sysmon

**Log Source / Channel** (e.g., "Sysmon Event ID 1")
- The specific log stream that provides a data component
- Where in logs to look
- Examples:
  - "Sysmon Event ID 1" → Process Creation
  - "Windows Security 4688" → Process Creation
  - "AWS CloudTrail" → API Activity

**Mutable Elements** (e.g., "CommandLine", "ParentImage")
- Fields in telemetry that attackers commonly manipulate
- Fields that might contain obfuscation/evasion
- Need special handling in detection rules
- Examples: CommandLine, ParentImage, TargetFilename, RegistryPath

### Application-Specific Concepts

**Product**
- A security tool (EDR, SIEM, firewall, IDS, cloud service)
- Example: "Microsoft Defender", "Splunk Enterprise Security"
- Has: vendor name, platforms, configured streams

**Product Stream**
- A configured log source for a product
- Maps to data components it provides
- Example: "Windows Security Event Log" stream → [Process Creation, User Account Authentication]

**Coverage**
- Set of techniques a product can detect
- Calculated via graph traversal:
  - Find all data components product provides
  - Find all analytics that use those components
  - Find all techniques those analytics detect
  - Result: Product can detect those techniques

**Confidence Score**
- How confident are we that a product can detect a technique?
- From CTID: Minimal, Partial, Significant
- From adapters: Inferred from rule count and sources
- From wizard: Minimal (user just answered questions)

**Coverage Gap**
- A technique with no detection path from the product
- Filtered by platform relevance
- Identified through graph traversal
- Useful for security posture assessment

**SSM Capability**
- A grouping of technique mappings for ATT&CK Navigator visualization
- JSON layer format with color coding
- Tracks source provenance (CTID vs Sigma vs Wizard)

---

## 8. Complete Example: Mapping Windows Defender

### Scenario: User creates "Microsoft Defender"

```
USER INPUT:
  vendor: "Microsoft"
  product: "Defender"
  platforms: ["Windows"]

STEP 1: PRODUCT DISCOVERY
  Search terms: ["Microsoft Defender", "Microsoft-Defender", "Microsoft_Defender", "Defender"]

STEP 2: RULE MATCHING
  CTID Adapter: Finds mapping file for Windows Defender
  Sigma Adapter: Finds 156 Sigma rules for Windows
  Splunk Adapter: Finds 23 Splunk rules for Windows Defender
  Elastic Adapter: Finds 45 Elastic rules for Windows
  Azure Adapter: Not applicable

STEP 3: TECHNIQUE EXTRACTION
  From CTID:     [T1087, T1010, T1217, ..., T1700]     (89 techniques)
  From Sigma:    [T1055, T1566, T1204, ..., T1566.002] (142 techniques)
  From Splunk:   [T1090, T1021, T1134, ..., T1562]     (78 techniques)
  From Elastic:  [T1036, T1556, T1566, ..., T1552]     (65 techniques)
  Combined:      [T1010, T1021, T1036, ..., T1700]     (187 unique techniques)

STEP 4: STIX ENRICHMENT
  For each technique, enrich with:
    - Tactics
    - Detection strategies
    - Required analytics
    - Required data components
    - Log sources (Sysmon Event ID 1, Windows Security 4688, etc)
    - Mutable elements (CommandLine, ParentImage, etc)

STEP 5: STREAM RESOLUTION
  Check if configured streams match:
    Sysmon stream → provides [Process Creation, Process Termination, Network Connection Creation]
    Security Log stream → provides [Process Creation, User Account Authentication]
  Infer techniques from streams

STEP 6: SSM PERSISTENCE
  Write to database:
    {
      product_id: "ms-defender-001",
      platform: "Windows",
      technique_id: "T1055",
      tactic: "defense-evasion",
      score_category: "Partial",
      score: 50,
      sources: ["CTID", "Sigma", "Splunk"],
      analytics_count: 12
    }
  Repeat for all 187 techniques

RESULT DISPLAYED:
  Coverage: 187 out of 230 techniques (81%)
  Gaps: 43 techniques not detected
  Top tactics: Defense Evasion (95%), Execution (88%), Credential Access (82%)
  Data components: [Process Creation, Network Connection, File Modification, ...]
```

---

## 9. Key Technologies

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Frontend** | React 18, TypeScript, TailwindCSS, Shadcn/UI | User interface |
| **Backend** | Node.js, Express, TypeScript | API endpoints, auto-mapper |
| **Database** | PostgreSQL 14+ | Graph storage, products, mappings |
| **Graph** | In-memory Maps (Node.js) | Fast lookups, knowledge graph |
| **External APIs** | Google Gemini | Rule validation |
| **Community Data** | GitHub (CTID, Sigma, Splunk, Elastic, Azure) | Detection rules |

---

## 10. Typical User Journeys

### Journey 1: "What can my security stack detect?"
1. Create products (Defender, Splunk, Elastic)
2. Auto-mapper discovers coverage for each
3. View Products page → see tactics coverage
4. Click technique → see which products detect it
5. Identify gaps → invest in new tools/tuning

### Journey 2: "How do I detect T1055 (Process Injection)?"
1. Search for T1055 on Detections page
2. See detection strategies
3. Click strategy → see available analytics
4. View analytics → see implementation (KQL, SPL, YAML)
5. See which products can detect it

### Journey 3: "I just bought a new EDR, what's coverage?"
1. Create product entry
2. Run auto-mapper
3. See coverage summary
4. Compare to previous tools
5. Identify improvement areas

---

## Summary

The MITRE Project uniquely combines:
- **Automation** (5 adapter framework)
- **Community** (CTID, Sigma, Splunk, Elastic, Azure rules)
- **Standards** (MITRE ATT&CK STIX)
- **Guidance** (Wizard questions)
- **Intelligence** (Knowledge Graph)

To create a **detection engineering intelligence platform** that helps organizations understand and improve their attack detection capabilities.
