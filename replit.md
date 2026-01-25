# OpenTidal - Threat-Informed Defense Platform

## Overview

OpenTidal is a self-hosted, open-source threat-informed defense platform designed as an alternative to Tidal Cyber. The application enables security teams to map security products to MITRE ATT&CK techniques, visualize defensive coverage against specific threat groups, and use AI to infer protection capabilities from product documentation.

The platform follows a modern full-stack architecture with a React frontend, Express backend, and PostgreSQL database, all designed to run in a containerized environment alongside MITRE ATT&CK Workbench.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS v4 with CSS variables for theming (dark mode default)
- **Build Tool**: Vite with custom plugins for Replit integration

The frontend follows a component-based architecture with:
- Pages in `client/src/pages/` (Dashboard, AIMapper, Products, Settings, Threats)
- Reusable components in `client/src/components/`
- Custom hooks in `client/src/hooks/` for data fetching and business logic
- Data layer in `client/src/lib/` including MITRE data, mock data, and API utilities

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript with ESM modules
- **API Design**: RESTful endpoints under `/api/` prefix
- **Database ORM**: Drizzle ORM with PostgreSQL

The backend implements an auto-mapper system that queries ALL community resources in order and combines results:
1. **CTID** (Center for Threat-Informed Defense) - Official vendor mappings
2. **Splunk** - Splunk Security Content detection rules
3. **Sigma** - SigmaHQ community detection rules
4. **Elastic** - Elastic detection rules

All adapters extract MITRE ATT&CK technique IDs, which are then enriched via the MITRE STIX v18 knowledge graph to derive:
- Detection Strategies
- Analytics
- Data Components

### Data Storage
- **Primary Database**: PostgreSQL (configured via DATABASE_URL environment variable)
- **Schema Location**: `shared/schema.ts` using Drizzle ORM
- **Key Entities**: Users, Products, Data Components, Detection Strategies, Analytics, MITRE Assets, Product Mappings, Resource Cache

### Build & Development
- Development: `npm run dev` runs tsx for hot-reloading the server
- Client dev: `npm run dev:client` runs Vite dev server on port 5000
- Production build: `npm run build` uses esbuild for server bundling and Vite for client
- Database migrations: `npm run db:push` with drizzle-kit

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **connect-pg-simple**: Session storage in PostgreSQL

### Third-Party APIs & Data Sources
- **MITRE ATT&CK STIX Data**: Fetched from GitHub (`mitre-attack/attack-stix-data`)
- **CTID Mappings Explorer**: Security product mappings from GitHub
- **Sigma Rules**: Detection rules from SigmaHQ GitHub repository
- **Elastic Detection Rules**: From Elastic GitHub repository
- **Splunk Security Content**: From Splunk GitHub repository

### UI Component Libraries
- **Radix UI**: Headless UI primitives (dialog, dropdown, tabs, etc.)
- **shadcn/ui**: Pre-built component library using Radix primitives
- **Lucide React**: Icon library

### Key NPM Packages
- `@tanstack/react-query`: Server state management
- `drizzle-orm` / `drizzle-zod`: Database ORM and schema validation
- `zod`: Runtime type validation
- `class-variance-authority`: Component variant management
- `date-fns`: Date manipulation
- `wouter`: Client-side routing

### Optional Integrations (Referenced in Codebase)
- **n8n**: Workflow automation for AI processing (webhook-based integration)
- **MITRE ATT&CK Workbench REST API**: Can be deployed via Docker for STIX data management
- **OpenAI / Google Generative AI**: Referenced in build config for AI-powered mapping features