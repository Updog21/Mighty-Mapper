# Architecture Overview (As-Built)

This document describes the current system architecture, data flows, and key logic so a new engineer can rebuild the system end-to-end.

## 1) System Topology

- **Frontend:** React + Vite UI in `client/`.
- **Backend:** Node/Express API in `server/`.
- **Database:** PostgreSQL with relational tables plus MITRE graph tables.
- **External sources:** MITRE ATT&CK STIX v18, Sigma, Splunk security_content, Elastic detection-rules, CTID mappings.

## 2) Core Modules

### Frontend (`client/`)
- **Pages:** `Dashboard`, `Products`, `ProductView`, `AdminTasks`, `Documentation`.
- **ProductView:** Shows coverage summary, detection strategies, analytics, and community coverage.
- **AdminTasks:** Maintenance actions (repo syncs, MITRE sync status).

### Backend (`server/`)
- **Routes:** `server/routes.ts` exposes product APIs, auto-mapper APIs, graph coverage APIs, and maintenance endpoints.
- **Services:** `server/services/` handles product CRUD, admin/maintenance, and graph operations.
- **MITRE Graph:** `server/mitre-stix/knowledge-graph.ts` ingests and persists the MITRE v18 graph.
- **Auto‑Mapper:** `server/auto-mapper/` houses adapters for Sigma, Splunk, Elastic, CTID.

## 3) Data Model

### Relational Tables
- **products:** local products with platforms and `dataComponentIds`.
- **aliases:** product synonyms for matching.
- **settings:** sync timestamps (e.g., `last_mitre_sync`).

### Graph Tables
- **nodes**
  - `id`: STIX IDs (MITRE) or custom STIX IDs (local products).
  - `type`: `attack-pattern`, `x-mitre-analytic`, `x-mitre-detection-strategy`, `x-mitre-data-component`, `x-mitre-data-source`, `x-mitre-mapper-product`.
  - `dataset`: `mitre_attack` or `local`.
  - `dataset_version`: `18.1` or `current`.
  - `local_id`: product integer ID for debugging.
- **edges**
  - `type`: `detects`, `uses`, `looks_for`, `provides`.
  - `source_id`, `target_id`.
  - `dataset`, `dataset_version`.
  - Unique guard: `(dataset, source_id, target_id, type)`.

## 4) MITRE v18 Knowledge Graph Ingestion

**Source:** MITRE STIX v18 bundle (ATT&CK enterprise).  
**Location:** `server/mitre-stix/knowledge-graph.ts`.

Ingestion steps:
1. Download STIX bundle and CAR analytics.
2. Build in-memory indexes (techniques, strategies, analytics, data components, data sources).
3. Persist graph:
   - Nodes for each object type.
   - Edges:
     - `detects`: Strategy → Technique
     - `uses`: Strategy → Analytic
     - `looks_for`: Analytic → Data Component

The ingestion clears and re-inserts `mitre_attack` dataset for version `18.1` to avoid stale data.

## 5) Local Product Bridge (Graph Overlay)

**Goal:** Connect local products to the MITRE graph so coverage is computed by traversal.

### Product Node IDs
- Deterministic UUIDv5 IDs, custom STIX object type:
  - `x-mitre-mapper-product--<uuidv5(product_id)>`

### Bridge Edges
- `provides`: Product → Data Component
- Created by:
  - Service hooks on product create/update/delete.
  - Backfill script for existing products.

## 6) Coverage Engine (Recursive Zig‑Zag)

Coverage is computed with a recursive CTE:
1. Start at Product → Data Component (`provides`).
2. Traverse backwards to Analytics (`looks_for`).
3. Traverse backwards to Strategies (`uses`).
4. Traverse forward to Techniques (`detects`).

Endpoints:
- `GET /api/graph/coverage`
- `GET /api/graph/coverage/paths`
- `GET /api/graph/gaps`

## 7) Auto‑Mapper Adapters

### Sigma
- Reads local repo `./data/sigma`.
- Extracts technique IDs from tags or infers from logsource/tactic.
- Uses MITRE graph for enrichment.

### Splunk
- Prefers local repo `./data/splunk-security-content`.
- Parses YAML detections (`detections/**/*.yml`).
- Extracts `mitre_attack_id`, `data_source`, `how_to_implement`.

### Elastic
- Prefers local repo `./data/elastic-detection-rules`.
- Parses TOML rules (`rules/**/*.toml`).
- Extracts ATT&CK technique IDs.

### CTID
- Prefers local repo `./data/ctid-mappings-explorer/src/data`.
- Maps products to techniques via CTID mappings.

Each adapter returns normalized mappings containing detection strategies, analytics, data components, and raw rule data.

## 8) Admin & Maintenance

### Repo Sync
Manual endpoints:
- `POST /api/admin/maintenance/refresh-sigma`
- `POST /api/admin/maintenance/refresh-splunk`
- `POST /api/admin/maintenance/refresh-elastic`
- `POST /api/admin/maintenance/refresh-ctid`

Nightly repo sync at **02:15 AM**.

### MITRE Sync
- `POST /api/admin/maintenance/refresh-mitre`
- Nightly MITRE sync at **02:00 AM**.

## 9) Deployment Automation

**Docker build** clones all rule repos:
- Sigma
- Splunk
- Elastic
- CTID mappings

**Entrypoint** runs on `docker compose up`:
1. `db:push`
2. `db:seed`
3. `backfill-local-graph`
4. MITRE graph init
5. Start server

## 10) End‑to‑End Request Flow

1. User opens a product in the UI.
2. Auto‑mapper runs community adapters.
3. Technique IDs are extracted and mapped to MITRE strategies/analytics.
4. Coverage engine traverses local + MITRE graph for technique coverage.
5. UI displays coverage summary, paths, gaps, and analytics details.
