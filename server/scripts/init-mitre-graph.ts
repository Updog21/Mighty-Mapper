import { mitreKnowledgeGraph } from "../mitre-stix";

async function run() {
  await mitreKnowledgeGraph.ensureInitialized();
  console.log("[Init] MITRE knowledge graph initialized.");
}

run().catch((error) => {
  console.error("[Init] Failed to initialize MITRE knowledge graph:", error);
  process.exit(1);
});
