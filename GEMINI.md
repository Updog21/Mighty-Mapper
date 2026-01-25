# OpenTidal (MITRE Project) - Gemini Context

## Project Overview
**OpenTidal** is a specialized security engineering platform designed to map security product capabilities to the MITRE ATT&CK framework. It acts as a bridge between detection rules (from Sigma, Splunk, Elastic, etc.) and the MITRE Knowledge Base to visualize detection coverage and identify gaps.

**Core Functionality:**
*   **Auto-Mapping:** Automatically discovers techniques detected by a product by scanning community rule repositories (SigmaHQ, CTID, Splunk Security Content, Elastic, Azure).
*   **Knowledge Graph:** Maintains a local graph database (PostgreSQL) of MITRE ATT&CK nodes (Techniques, Tactics, Data Components) and their relationships.
*   **Coverage Analysis:** Calculates "detection coverage" by traversing the graph: `Product -> Data Component -> Analytic -> Strategy -> Technique`.
*   **Wizard-Driven Mapping:** Helps users map "abstract" products (like generic EDRs) by answering questions about telemetry capabilities.

## Technical Architecture

### Stack
*   **Frontend:** React 18 (Vite), TypeScript, TailwindCSS, Shadcn/UI.
*   **Backend:** Node.js (Express), TypeScript.
*   **Database:** PostgreSQL (Application data + Graph nodes/edges).
*   **Infrastructure:** Docker Compose, BunkerWeb (WAF/Reverse Proxy).
*   **AI Integration:** Google Gemini (used for validating mapped rules).

### Key Directories
*   `server/` - Backend API and Logic.
    *   `server/auto-mapper/` - The core logic for scanning external repositories and mapping rules to techniques.
    *   `server/mitre-stix/` - Handling of STIX v18 data ingestion and graph construction.
    *   `server/services/` - Business logic (Products, Detections, Coverage).
*   `client/` - React Frontend.
    *   `client/src/components/` - UI Components (Visualization of mappings).
    *   `client/src/pages/` - Main application views.
*   `data/` (Not shown but implied) - Stores cloned repositories for Sigma, CTID, etc.
*   `scripts/` - Utilities for data seeding (`extract_mitre_data.py`) and maintenance.

## Development Workflow

### Prerequisites
*   Node.js & npm
*   Python 3 (for data extraction scripts)
*   Docker & Docker Compose

### Common Commands
*   **Start Development Server:** `npm run dev` (Runs backend on port 5000 + Vite dev server)
*   **Build Project:** `npm run build`
*   **Database Setup:** `npm run db:push` (Drizzle), `npm run db:seed`
*   **Run via Docker:** `docker-compose up -d`

## Key Concepts
*   **Adapter:** A module in `server/auto-mapper/adapters/` responsible for parsing a specific rule format (e.g., `sigma.ts`, `splunk.ts`).
*   **SSM (Security Stack Mapping):** The data model used to store the relationship between a Product and a Technique.
*   **Stream:** A configured log source for a product (e.g., "Sysmon") that provides specific Data Components.

## Current State & Notes
*   The project uses a **hybrid selector strategy** for mapping (combining rule-based scanning with telemetry-based inference).
*   It relies on **local clones** of rule repositories (Sigma, etc.) to perform scanning.
*   Authentication is handled via Passport/Session (or externally via BunkerWeb in prod).
