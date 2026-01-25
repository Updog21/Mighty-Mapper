# Repository Guidelines

## Project Structure & Module Organization
- `client/` is the React + Vite frontend. Core UI lives in `client/src/components/` and `client/src/pages/` with Tailwind-based styling.
- `server/` is the Express API. Routes are in `server/routes.ts`, services in `server/services/`, and auto-mapper adapters in `server/auto-mapper/`.
- `server/mitre-stix/` contains MITRE ATT&CK knowledge base utilities and mappings.
- `shared/` holds shared types/utilities used by both client and server.
- `mappings/` stores mapping assets used by the backend.
- `scripts/` and `script/` hold build and data maintenance scripts (MITRE extraction, seeding).

## Build, Test, and Development Commands
- `npm run dev` runs the API server in development mode.
- `npm run dev:client` runs the Vite dev server on port 5000.
- `npm run build` builds server + client via `script/build.ts` and outputs `dist/`.
- `npm run start` runs the production server from `dist/index.cjs`.
- `npm run db:push` applies Drizzle schema changes to the database.
- `npm run db:seed` runs the MITRE extraction + seed pipeline.

## Coding Style & Naming Conventions
- TypeScript everywhere; keep types explicit at API boundaries.
- React components and files follow PascalCase (e.g., `ProductView.tsx`); variables/functions use `camelCase`.
- Tailwind is the primary styling approach; prefer existing utility patterns over new CSS.
- No formatter/linter is enforced here, so keep changes consistent with surrounding code.

## Testing Guidelines
- No dedicated automated test suite is present. If you add tests, document the command and keep them close to the relevant module.

## Commit & Pull Request Guidelines
- Git history does not enforce a strict convention. Use short, descriptive, imperative commit messages.
- PRs should summarize UI changes, include relevant screenshots, and link related issues where possible.
- Call out schema or data pipeline changes explicitly (e.g., Drizzle or MITRE sync updates).

## Security & Configuration Tips
- Environment setup is expected to be local; avoid hardcoding secrets in `server/`.
- If you update MITRE ingestion or mapping logic, ensure the sync scripts and API routes still align.

## Recent Architecture Updates (Changelog)
- Graph model added for MITRE v18 with persisted nodes/edges and dataset versioning; coverage is now computed via recursive traversal.
- Local product bridge uses deterministic STIX-style IDs and `provides` edges with a backfill script to sync existing products.
- New graph endpoints: coverage totals, coverage paths, and gap analysis for UI and debugging.
- Community adapters now support local repo caches (Sigma, Splunk, Elastic, CTID) with GitHub fallbacks.
- Docker build clones rule repositories; container entrypoint runs db push/seed, graph init, and backfill on startup.
- Admin Tasks includes repo sync buttons and nightly repo refresh scheduling.
