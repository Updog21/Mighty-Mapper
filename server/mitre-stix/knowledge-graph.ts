import { db } from '../db';
import { mitreAssets, detectionStrategies, analytics, dataComponents as dataComponentsTable, nodes, edges } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { fetchWithTimeout } from '../utils/fetch';
import { normalizePlatformList, platformMatchesAny } from '../../shared/platforms';

interface CarAnalytic {
  name: string;
  shortName: string;
  fields: string[];
  attack: Array<{
    tactics: string[];
    technique: string;
    coverage: string;
  }>;
}

interface CarData {
  analytics: CarAnalytic[];
}

interface StixObject {
  id: string;
  type: string;
  name?: string;
  description?: string;
  x_mitre_shortname?: string;
  external_references?: Array<{
    source_name: string;
    external_id?: string;
    url?: string;
  }>;
  x_mitre_platforms?: string[];
  x_mitre_data_sources?: string[];
  x_mitre_detection?: string;
  x_mitre_data_component_refs?: string[];
  x_mitre_detection_strategy_refs?: string[];
  x_mitre_data_source_ref?: string;
  x_mitre_domains?: string[];
  revoked?: boolean;
  x_mitre_deprecated?: boolean;
  x_mitre_analytic_refs?: string[];
  x_mitre_log_source_references?: Array<{
    x_mitre_data_component_ref: string;
    name: string;
    channel?: string;
  }>;
  x_mitre_mutable_elements?: Array<{
    field: string;
    description: string;
  }>;
  kill_chain_phases?: Array<{ phase_name: string }>;
}

interface StixRelationship {
  id: string;
  type: 'relationship';
  relationship_type: string;
  source_ref: string;
  target_ref: string;
  description?: string;
}

interface StixBundle {
  type: 'bundle';
  objects: (StixObject | StixRelationship)[];
}

interface TechniqueInfo {
  id: string;
  stixId: string;
  name: string;
  description: string;
  platforms: string[];
  tactics: string[];
  dataSources: string[];
  detection: string;
}

interface StrategyInfo {
  id: string;
  stixId: string;
  name: string;
  description: string;
  techniques: string[];
}

interface LogSourceReference {
  dataComponentRef: string;
  name: string;
  channel?: string;
}

interface MutableElement {
  field: string;
  description: string;
}

interface AnalyticInfo {
  id: string;
  stixId: string;
  name: string;
  description: string;
  strategyRefs: string[];
  dataComponentRefs: string[];
  platforms: string[];
  logSourceReferences: LogSourceReference[];
  mutableElements: MutableElement[];
}

interface DataComponentInfo {
  id: string;
  stixId: string;
  name: string;
  description: string;
  dataSourceId: string;
  dataSourceName: string;
  platforms?: string[];
  domains: string[];
  revoked: boolean;
  deprecated: boolean;
}

interface DetectsProvenance {
  provenance: 'stix_relationship' | 'derived_from_technique_metadata';
  stixRelationshipId?: string;
  derivedFrom?: string;
  derivedMethod?: string;
}

interface LogRequirement {
  strategyId: string;
  strategyName: string;
  analyticId: string;
  analyticName: string;
  dataComponentId: string;
  dataComponentName: string;
  dataSourceName: string;
}

export class MitreKnowledgeGraph {
  private stixUrl = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
  private carUrl = 'https://raw.githubusercontent.com/mitre-attack/car/master/docs/data/analytics.json';
  
  private techniqueMap: Map<string, TechniqueInfo> = new Map();
  private strategyMap: Map<string, StrategyInfo> = new Map();
  private analyticMap: Map<string, AnalyticInfo> = new Map();
  private dataComponentMap: Map<string, DataComponentInfo> = new Map();
  private dataSourceMap: Map<string, { id: string; name: string; platforms: string[] }> = new Map();
  private techniqueByStixId: Map<string, TechniqueInfo> = new Map();
  private dataComponentDetects: Map<string, Set<string>> = new Map();
  private dataComponentDetectsProvenance: Map<string, Map<string, DetectsProvenance>> = new Map();
  private strategyDetectsProvenance: Map<string, Map<string, DetectsProvenance>> = new Map();
  private hasStixDetectsRelationships = false;
  private tacticMap: Map<string, { id: string; name: string }> = new Map();
  private subtechniqueParents: Map<string, string> = new Map();
  private techniquePhaseMap: Map<string, string[]> = new Map();
  
  private techniqueToStrategies: Map<string, string[]> = new Map();
  private strategyToAnalytics: Map<string, string[]> = new Map();
  private analyticToStrategies: Map<string, string[]> = new Map(); // Reverse lookup for Tier 2 inference
  private analyticToDataComponents: Map<string, string[]> = new Map();
  private dataComponentToAnalytics: Map<string, string[]> = new Map(); // Reverse lookup for Tier 2 inference

  private techniqueToCarAnalytics: Map<string, CarAnalytic[]> = new Map();

  private dataComponentIdIndex: Map<string, string> = new Map();
  private dataComponentNameIndex: Map<string, Set<string>> = new Map();
  private dataSourceNameIndex: Map<string, Set<string>> = new Map();
  private logSourceNameIndex: Map<string, Set<string>> = new Map();
  
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    
    this.initPromise = this.ingestData();
    await this.initPromise;
  }

  async ingestData(): Promise<void> {
    console.log('[-] Downloading MITRE v18 STIX Data...');
    
    try {
      const [stixResponse, carResponse] = await Promise.all([
        fetchWithTimeout(this.stixUrl),
        fetchWithTimeout(this.carUrl),
      ]);
      
      if (!stixResponse.ok) {
        throw new Error(`Failed to fetch STIX data: ${stixResponse.status}`);
      }
      
      const stixBundle: StixBundle = await stixResponse.json();
      console.log(`[-] Loaded ${stixBundle.objects.length} STIX objects`);
      
      this.buildIndexes(stixBundle);
      
      if (carResponse.ok) {
        const carData: CarData = await carResponse.json();
        this.buildCarIndex(carData);
        console.log(`[-] Loaded ${carData.analytics.length} CAR analytics`);
      } else {
        console.warn('[!] Failed to fetch CAR data, continuing without it');
      }

      await this.persistMitreGraph();
      
      this.initialized = true;
      
      console.log('[+] MITRE Knowledge Graph Ingestion Complete');
      console.log(`    Techniques: ${this.techniqueMap.size}`);
      console.log(`    Detection Strategies: ${this.strategyMap.size}`);
      console.log(`    Analytics: ${this.analyticMap.size}`);
      console.log(`    Data Components: ${this.dataComponentMap.size}`);
      console.log(`    Data Sources: ${this.dataSourceMap.size}`);
      console.log(`    CAR Technique Mappings: ${this.techniqueToCarAnalytics.size}`);
    } catch (error) {
      console.error('[!] Failed to ingest MITRE STIX data:', error);
      throw error;
    }
  }

  private async persistMitreGraph(): Promise<void> {
    const dataset = 'mitre_attack';
    const datasetVersion = '18.1';

    await db.delete(edges).where(and(
      eq(edges.dataset, dataset),
      eq(edges.datasetVersion, datasetVersion)
    ));

    const nodeRows: Array<{
      id: string;
      type: string;
      name: string;
      dataset: string;
      datasetVersion: string;
      localId?: number | null;
      attributes: Record<string, unknown>;
    }> = [];

    this.techniqueMap.forEach((tech) => {
      nodeRows.push({
        id: tech.stixId,
        type: 'technique',
        name: tech.name,
        dataset,
        datasetVersion,
        attributes: {
          externalId: tech.id,
          description: tech.description,
          platforms: tech.platforms,
          tactics: tech.tactics,
          dataSources: tech.dataSources,
          detection: tech.detection,
        },
      });
    });

    this.strategyMap.forEach((strategy) => {
      nodeRows.push({
        id: strategy.stixId,
        type: 'strategy',
        name: strategy.name,
        dataset,
        datasetVersion,
        attributes: {
          externalId: strategy.id,
          description: strategy.description,
        },
      });
    });

    this.analyticMap.forEach((analytic) => {
      nodeRows.push({
        id: analytic.stixId,
        type: 'analytic',
        name: analytic.name,
        dataset,
        datasetVersion,
        attributes: {
          externalId: analytic.id,
          description: analytic.description,
          platforms: analytic.platforms,
        },
      });
    });

    this.dataComponentMap.forEach((dc) => {
      nodeRows.push({
        id: dc.stixId,
        type: 'data_component',
        name: dc.name,
        dataset,
        datasetVersion,
        attributes: {
          externalId: dc.id,
          description: dc.description,
          dataSourceId: dc.dataSourceId,
          dataSourceName: dc.dataSourceName,
          platforms: dc.platforms || [],
          domains: dc.domains,
          revoked: dc.revoked,
          deprecated: dc.deprecated,
        },
      });
    });

    this.dataSourceMap.forEach((ds, stixId) => {
      nodeRows.push({
        id: stixId,
        type: 'data_source',
        name: ds.name,
        dataset,
        datasetVersion,
        attributes: {
          externalId: ds.id,
        },
      });
    });

    const edgeRows: Array<{
      sourceId: string;
      targetId: string;
      type: string;
      dataset: string;
      datasetVersion: string;
      attributes?: Record<string, unknown> | null;
    }> = [];
    const edgeKeys = new Set<string>();

    this.strategyMap.forEach((strategy) => {
      strategy.techniques.forEach((techId) => {
        const tech = this.techniqueMap.get(techId);
        if (!tech) return;
        const key = `${dataset}|detects|${strategy.stixId}|${tech.stixId}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          const provenance = this.strategyDetectsProvenance
            .get(strategy.stixId)
            ?.get(tech.stixId);
          edgeRows.push({
            sourceId: strategy.stixId,
            targetId: tech.stixId,
            type: 'detects',
            dataset,
            datasetVersion,
            attributes: provenance ? { ...provenance } : null,
          });
        }
      });
    });

    this.strategyToAnalytics.forEach((analyticStixIds, strategyStixId) => {
      analyticStixIds.forEach((analyticStixId) => {
        if (!this.analyticMap.has(analyticStixId)) return;
        const key = `${dataset}|uses|${strategyStixId}|${analyticStixId}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edgeRows.push({
            sourceId: strategyStixId,
            targetId: analyticStixId,
            type: 'uses',
            dataset,
            datasetVersion,
            attributes: { provenance: 'stix_ref_field' },
          });
        }
      });
    });

    this.analyticToDataComponents.forEach((dcStixIds, analyticStixId) => {
      dcStixIds.forEach((dcStixId) => {
        if (!this.dataComponentMap.has(dcStixId)) return;
        const key = `${dataset}|looks_for|${analyticStixId}|${dcStixId}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          edgeRows.push({
            sourceId: analyticStixId,
            targetId: dcStixId,
            type: 'looks_for',
            dataset,
            datasetVersion,
            attributes: { provenance: 'stix_ref_field' },
          });
        }
      });
    });

    this.dataComponentDetects.forEach((techStixIds, dcStixId) => {
      techStixIds.forEach((techStixId) => {
        const key = `${dataset}|detects|${dcStixId}|${techStixId}`;
        if (!edgeKeys.has(key)) {
          edgeKeys.add(key);
          const provenance = this.dataComponentDetectsProvenance
            .get(dcStixId)
            ?.get(techStixId);
          edgeRows.push({
            sourceId: dcStixId,
            targetId: techStixId,
            type: 'detects',
            dataset,
            datasetVersion,
            attributes: provenance ? { ...provenance } : null,
          });
        }
      });
    });

    const insertInBatches = async <T>(rows: T[], batchSize: number, insertFn: (values: T[]) => Promise<void>) => {
      for (let i = 0; i < rows.length; i += batchSize) {
        await insertFn(rows.slice(i, i + batchSize));
      }
    };

    await insertInBatches(nodeRows, 1000, async (values) => {
      await db.insert(nodes).values(values).onConflictDoUpdate({
        target: nodes.id,
        set: {
          name: sql`excluded.name`,
          type: sql`excluded.type`,
          dataset: sql`excluded.dataset`,
          datasetVersion: sql`excluded.dataset_version`,
          attributes: sql`excluded.attributes`,
        },
      });
    });

    await insertInBatches(edgeRows, 2000, async (values) => {
      await db.insert(edges).values(values).onConflictDoNothing();
    });
  }
  
  private buildCarIndex(carData: CarData): void {
    for (const analytic of carData.analytics) {
      for (const attack of analytic.attack) {
        const techId = attack.technique.replace('Technique/', '').toUpperCase();
        if (!this.techniqueToCarAnalytics.has(techId)) {
          this.techniqueToCarAnalytics.set(techId, []);
        }
        this.techniqueToCarAnalytics.get(techId)!.push(analytic);
      }
    }
  }

  private buildIndexes(bundle: StixBundle): void {
    const objects = bundle.objects;
    
    for (const obj of objects) {
      if (obj.type === 'relationship') continue;
      
      const stixObj = obj as StixObject;
      const externalId = this.getExternalId(stixObj);
      
      switch (stixObj.type) {
        case 'attack-pattern':
          if (externalId) {
            const phases = (stixObj.kill_chain_phases || [])
              .map(kc => kc.phase_name)
              .filter(Boolean);
            this.techniqueMap.set(externalId, {
              id: externalId,
              stixId: stixObj.id,
              name: stixObj.name || '',
              description: stixObj.description || '',
              platforms: this.readPlatforms(stixObj),
              tactics: [],
              dataSources: stixObj.x_mitre_data_sources || [],
              detection: stixObj.x_mitre_detection || '',
            });
            this.techniqueByStixId.set(stixObj.id, this.techniqueMap.get(externalId)!);
            this.techniquePhaseMap.set(stixObj.id, phases);
          }
          break;
          
        case 'x-mitre-detection-strategy':
          if (externalId) {
            const analyticRefs = stixObj.x_mitre_analytic_refs || [];
            this.strategyMap.set(stixObj.id, {
              id: externalId,
              stixId: stixObj.id,
              name: stixObj.name || '',
              description: stixObj.description || '',
              techniques: [],
            });
            
            for (const analyticRef of analyticRefs) {
              if (!this.strategyToAnalytics.has(stixObj.id)) {
                this.strategyToAnalytics.set(stixObj.id, []);
              }
              this.strategyToAnalytics.get(stixObj.id)!.push(analyticRef);
            }
          }
          break;
          
        case 'x-mitre-analytic':
          if (externalId) {
            const dataComponentRefs: string[] = [];
            const logSourceReferences: LogSourceReference[] = [];
            const mutableElements: MutableElement[] = [];

            if (stixObj.x_mitre_log_source_references) {
              for (const lsr of stixObj.x_mitre_log_source_references) {
                if (lsr.x_mitre_data_component_ref) {
                  dataComponentRefs.push(lsr.x_mitre_data_component_ref);
                  logSourceReferences.push({
                    dataComponentRef: lsr.x_mitre_data_component_ref,
                    name: lsr.name,
                    channel: lsr.channel,
                  });
                }
              }
            }

            if (stixObj.x_mitre_data_component_refs) {
              for (const dcRef of stixObj.x_mitre_data_component_refs) {
                dataComponentRefs.push(dcRef);
              }
            }

            if (stixObj.x_mitre_mutable_elements) {
              for (const me of stixObj.x_mitre_mutable_elements) {
                mutableElements.push({
                  field: me.field,
                  description: me.description,
                });
              }
            }

            this.analyticMap.set(stixObj.id, {
              id: externalId,
              stixId: stixObj.id,
              name: stixObj.name || '',
              description: stixObj.description || '',
              strategyRefs: [],
              dataComponentRefs: Array.from(new Set(dataComponentRefs)),
              platforms: this.readPlatforms(stixObj),
              logSourceReferences,
              mutableElements,
            });
          }
          break;
          
        case 'x-mitre-data-component':
          const dcExternalId = this.getExternalId(stixObj);
          this.dataComponentMap.set(stixObj.id, {
            id: dcExternalId || stixObj.id,
            stixId: stixObj.id,
            name: stixObj.name || '',
            description: stixObj.description || '',
            dataSourceId: stixObj.x_mitre_data_source_ref || '',
            dataSourceName: '',
            platforms: this.readPlatforms(stixObj),
            domains: Array.isArray(stixObj.x_mitre_domains) ? stixObj.x_mitre_domains : [],
            revoked: Boolean(stixObj.revoked),
            deprecated: Boolean(stixObj.x_mitre_deprecated),
          });
          break;
          
        case 'x-mitre-data-source':
          // Always index data sources, even without external ID, because we need the name for linkage
          this.dataSourceMap.set(stixObj.id, {
            id: externalId || stixObj.id,
            name: stixObj.name || '',
            platforms: this.readPlatforms(stixObj),
          });
          break;

        case 'x-mitre-tactic':
          if (stixObj.x_mitre_shortname) {
            this.tacticMap.set(stixObj.x_mitre_shortname.toLowerCase(), {
              id: externalId || stixObj.id,
              name: stixObj.name || stixObj.x_mitre_shortname,
            });
          }
          break;
      }
    }
    
    let linkedCount = 0;
    this.dataComponentMap.forEach((dc, dcId) => {
      const ds = this.dataSourceMap.get(dc.dataSourceId);
      if (ds) {
        dc.dataSourceName = ds.name;
        if (!dc.platforms || dc.platforms.length === 0) {
          dc.platforms = ds.platforms.slice();
        }
        linkedCount++;
      }
    });
    console.log(`[-] Linked ${linkedCount}/${this.dataComponentMap.size} Data Components to Data Sources`);

    this.buildResolverIndexes();

    // Populate analyticToDataComponents and reverse lookup dataComponentToAnalytics
    // This enables O(1) lookups for Tier 2 inference
    this.analyticMap.forEach((analytic, analyticStixId) => {
      const dcRefs = analytic.dataComponentRefs;
      if (dcRefs.length > 0) {
        // Forward map: analytic -> data components
        this.analyticToDataComponents.set(analyticStixId, dcRefs);

        // Reverse map: data component -> analytics (for Tier 2 inference)
        for (const dcRef of dcRefs) {
          if (!this.dataComponentToAnalytics.has(dcRef)) {
            this.dataComponentToAnalytics.set(dcRef, []);
          }
          this.dataComponentToAnalytics.get(dcRef)!.push(analyticStixId);
        }
      }
    });

    // Populate analyticToStrategies (reverse of strategyToAnalytics)
    // Traversal: strategy -> analytics becomes analytics -> strategies
    this.strategyToAnalytics.forEach((analyticStixIds, strategyStixId) => {
      for (const analyticStixId of analyticStixIds) {
        if (!this.analyticToStrategies.has(analyticStixId)) {
          this.analyticToStrategies.set(analyticStixId, []);
        }
        this.analyticToStrategies.get(analyticStixId)!.push(strategyStixId);
      }
    });

    let stixDetectsEdges = 0;
    for (const obj of objects) {
      if (obj.type !== 'relationship') continue;
      
      const rel = obj as StixRelationship;
      
      if (rel.relationship_type === 'subtechnique-of') {
        this.subtechniqueParents.set(rel.source_ref, rel.target_ref);
      }

      if (rel.relationship_type === 'detects') {
        const sourceIsStrategy = rel.source_ref.includes('x-mitre-detection-strategy');
        const targetIsStrategy = rel.target_ref.includes('x-mitre-detection-strategy');
        if (sourceIsStrategy || targetIsStrategy) {
          const strategyRef = sourceIsStrategy ? rel.source_ref : rel.target_ref;
          const techniqueRef = sourceIsStrategy ? rel.target_ref : rel.source_ref;
          const techInfo = this.findTechniqueByStixId(techniqueRef);
          if (techInfo) {
            if (!this.techniqueToStrategies.has(techInfo.id)) {
              this.techniqueToStrategies.set(techInfo.id, []);
            }
            const strategyList = this.techniqueToStrategies.get(techInfo.id)!;
            if (!strategyList.includes(strategyRef)) {
              strategyList.push(strategyRef);
            }

            const strategy = this.strategyMap.get(strategyRef);
            if (strategy && !strategy.techniques.includes(techInfo.id)) {
              strategy.techniques.push(techInfo.id);
            }
            this.setStrategyDetectsProvenance(strategyRef, techInfo.stixId, {
              provenance: 'stix_relationship',
              stixRelationshipId: rel.id,
            });
          }
        }
      }

      if (rel.relationship_type === 'detects') {
        const sourceIsDataComponent = this.dataComponentMap.has(rel.source_ref);
        const targetIsDataComponent = this.dataComponentMap.has(rel.target_ref);
        const sourceIsTechnique = this.techniqueByStixId.has(rel.source_ref);
        const targetIsTechnique = this.techniqueByStixId.has(rel.target_ref);

        if (sourceIsDataComponent && targetIsTechnique) {
          const wasAdded = this.addDetectsEdge(rel.source_ref, rel.target_ref, {
            provenance: 'stix_relationship',
            stixRelationshipId: rel.id,
          });
          if (wasAdded) {
            this.hasStixDetectsRelationships = true;
            stixDetectsEdges += 1;
          }
        } else if (targetIsDataComponent && sourceIsTechnique) {
          const wasAdded = this.addDetectsEdge(rel.target_ref, rel.source_ref, {
            provenance: 'stix_relationship',
            stixRelationshipId: rel.id,
          });
          if (wasAdded) {
            this.hasStixDetectsRelationships = true;
            stixDetectsEdges += 1;
          }
        }
      }
    }

    this.hydrateTechniqueTactics();
    this.repairDetectsEdges();
    if (stixDetectsEdges > 0) {
      console.log(`[Graph Ingest] Ingested ${stixDetectsEdges} STIX data component detects edges`);
    }
  }

  private formatTacticName(value: string): string {
    return value
      .split(/[-_]/g)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private hydrateTechniqueTactics(): void {
    const resolved = new Map<string, string[]>();
    const missingTactics: string[] = []; // Track techniques with missing tactics

    // PASS 1: Extract tactics from kill_chain_phases
    this.techniqueByStixId.forEach((tech, stixId) => {
      const phases = this.techniquePhaseMap.get(stixId) || [];
      const tacticNames = phases
        .map(phase => {
          const tactic = this.tacticMap.get(phase.toLowerCase());
          return tactic ? tactic.name : this.formatTacticName(phase);
        })
        .filter(Boolean);

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
      // Remove from missing since we recovered it
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

  private normalizeName(value: string): string {
    return value.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private normalizeLookupKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeTechniqueIdValue(value: string): string | null {
    const match = value.trim().toUpperCase().match(/T\d{4}(?:\.\d{3})?/);
    return match ? match[0] : null;
  }

  private normalizeTacticName(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    let normalized = trimmed.toLowerCase();
    if (normalized.includes(':')) {
      normalized = normalized.split(':').slice(1).join(':').trim();
    }
    if (normalized.startsWith('attack.')) {
      normalized = normalized.replace(/^attack\./, '');
    }
    normalized = normalized
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!normalized) return null;
    if (/^t\d{4}(?:\.\d{3})?$/.test(normalized)) return null;
    return normalized;
  }

  private normalizeTacticHints(tactics?: string[]): string[] {
    if (!Array.isArray(tactics) || tactics.length === 0) return [];
    const normalized = new Set<string>();
    for (const tactic of tactics) {
      if (typeof tactic !== 'string') continue;
      const value = this.normalizeTacticName(tactic);
      if (value) normalized.add(value);
    }
    return Array.from(normalized);
  }

  private addIndexEntry(index: Map<string, Set<string>>, key: string, stixId: string): void {
    if (!key) return;
    const existing = index.get(key);
    if (existing) {
      existing.add(stixId);
      return;
    }
    index.set(key, new Set([stixId]));
  }

  private buildResolverIndexes(): void {
    this.dataComponentIdIndex.clear();
    this.dataComponentNameIndex.clear();
    this.dataSourceNameIndex.clear();
    this.logSourceNameIndex.clear();

    this.dataComponentMap.forEach((dc, stixId) => {
      if (dc.id) {
        this.dataComponentIdIndex.set(dc.id.toUpperCase(), stixId);
      }
      const nameKey = this.normalizeLookupKey(dc.name);
      if (nameKey) {
        this.addIndexEntry(this.dataComponentNameIndex, nameKey, stixId);
      }
      if (dc.dataSourceName) {
        const sourceKey = this.normalizeLookupKey(dc.dataSourceName);
        if (sourceKey) {
          this.addIndexEntry(this.dataSourceNameIndex, sourceKey, stixId);
        }
      }
    });

    this.analyticMap.forEach((analytic) => {
      for (const ref of analytic.logSourceReferences) {
        if (ref.name) {
          const nameKey = this.normalizeLookupKey(ref.name);
          this.addIndexEntry(this.logSourceNameIndex, nameKey, ref.dataComponentRef);
        }
        if (ref.channel) {
          const channelKey = this.normalizeLookupKey(ref.channel);
          this.addIndexEntry(this.logSourceNameIndex, channelKey, ref.dataComponentRef);
        }
        if (ref.name && ref.channel) {
          const combinedKey = this.normalizeLookupKey(`${ref.name} ${ref.channel}`);
          this.addIndexEntry(this.logSourceNameIndex, combinedKey, ref.dataComponentRef);
        }
      }
    });
  }

  private extractDataComponentName(dataSource: string): string {
    const match = dataSource.split(/:(.+)/);
    const raw = match[1] ? match[1] : dataSource;
    return this.normalizeName(raw);
  }

  private addDetectsEdge(dcStixId: string, techStixId: string, provenance: DetectsProvenance): boolean {
    if (!this.dataComponentDetects.has(dcStixId)) {
      this.dataComponentDetects.set(dcStixId, new Set());
    }
    const targetSet = this.dataComponentDetects.get(dcStixId)!;
    const isNew = !targetSet.has(techStixId);
    if (isNew) {
      targetSet.add(techStixId);
    }

    if (!this.dataComponentDetectsProvenance.has(dcStixId)) {
      this.dataComponentDetectsProvenance.set(dcStixId, new Map());
    }
    const provenanceMap = this.dataComponentDetectsProvenance.get(dcStixId)!;
    const existing = provenanceMap.get(techStixId);

    if (existing?.provenance === 'stix_relationship') {
      return isNew;
    }

    if (provenance.provenance === 'stix_relationship' || !existing) {
      provenanceMap.set(techStixId, provenance);
    }
    return isNew;
  }

  private setStrategyDetectsProvenance(strategyStixId: string, techStixId: string, provenance: DetectsProvenance): void {
    if (!this.strategyDetectsProvenance.has(strategyStixId)) {
      this.strategyDetectsProvenance.set(strategyStixId, new Map());
    }
    const provenanceMap = this.strategyDetectsProvenance.get(strategyStixId)!;
    const existing = provenanceMap.get(techStixId);

    if (existing?.provenance === 'stix_relationship') {
      return;
    }

    if (provenance.provenance === 'stix_relationship' || !existing) {
      provenanceMap.set(techStixId, provenance);
    }
  }

  private repairDetectsEdges(): void {
    if (this.hasStixDetectsRelationships) {
      console.log('[Graph Repair] Skipping derived detects edges because STIX detects relationships were ingested');
      return;
    }

    this.dataComponentDetects.clear();
    this.dataComponentDetectsProvenance.clear();
    const dataComponentIndex = new Map<string, string>();

    this.dataComponentMap.forEach((dc, stixId) => {
      const key = this.normalizeName(dc.name);
      if (!dataComponentIndex.has(key)) {
        dataComponentIndex.set(key, stixId);
      }
    });

    let created = 0;
    let unmatched = 0;

    this.techniqueMap.forEach((tech) => {
      for (const dataSource of tech.dataSources) {
        const normalizedDcName = this.extractDataComponentName(dataSource);
        if (!normalizedDcName) continue;
        const dcStixId = dataComponentIndex.get(normalizedDcName);
        if (!dcStixId) {
          unmatched += 1;
          continue;
        }

        const wasAdded = this.addDetectsEdge(dcStixId, tech.stixId, {
          provenance: 'derived_from_technique_metadata',
          derivedFrom: tech.stixId,
          derivedMethod: 'repairDetectsEdges_v1',
        });
        if (wasAdded) {
          created += 1;
        }
      }
    });

    if (unmatched > 0) {
      console.warn(`[Graph Repair] Unmatched data source entries: ${unmatched}`);
    }
    console.log(`[Graph Repair] Added ${created} data component detects edges`);
  }

  private getExternalId(obj: StixObject): string | null {
    if (!obj.external_references) return null;
    
    for (const ref of obj.external_references) {
      if (ref.source_name === 'mitre-attack' && ref.external_id) {
        return ref.external_id;
      }
    }
    return null;
  }

  private readPlatforms(obj: StixObject): string[] {
    const raw = Array.isArray((obj as any).x_mitre_platforms)
      ? (obj as any).x_mitre_platforms
      : Array.isArray((obj as any)["x-mitre-platforms"])
        ? (obj as any)["x-mitre-platforms"]
        : [];
    return normalizePlatformList(raw);
  }

  private findTechniqueByStixId(stixId: string): TechniqueInfo | null {
    return this.techniqueByStixId.get(stixId) || null;
  }

  getTechnique(techniqueId: string): TechniqueInfo | null {
    const normalized = this.normalizeTechniqueIdValue(techniqueId);
    if (!normalized) return null;
    return this.techniqueMap.get(normalized) || null;
  }

  normalizeTechniqueId(value: string | null | undefined): string | null {
    if (!value) return null;
    return this.normalizeTechniqueIdValue(value);
  }

  /**
   * Get tactics for a technique from the knowledge graph
   * Useful as a fallback when database has incomplete data
   * @param techniqueId - The technique ID (e.g., "T1234")
   * @returns Array of tactic names, or empty array if not found
   */
  getTactics(techniqueId: string): string[] {
    const technique = this.getTechnique(techniqueId);
    if (technique?.tactics && technique.tactics.length > 0) {
      return technique.tactics;
    }
    const normalized = this.normalizeTechniqueIdValue(techniqueId);
    const parentId = normalized ? this.getParentTechniqueId(normalized) : null;
    if (!parentId) return [];
    return this.getTechnique(parentId)?.tactics || [];
  }

  resolveDataComponentsFromHints(hints: string[]): DataComponentInfo[] {
    if (!Array.isArray(hints) || hints.length === 0) return [];
    const matches = new Set<string>();

    const collectMatches = (index: Map<string, Set<string>>, key: string) => {
      const direct = index.get(key);
      if (direct) {
        direct.forEach(id => matches.add(id));
        return;
      }
      for (const [candidateKey, ids] of index) {
        if (candidateKey.includes(key) || key.includes(candidateKey)) {
          ids.forEach(id => matches.add(id));
        }
      }
    };

    for (const hint of hints) {
      if (typeof hint !== 'string') continue;
      const trimmed = hint.trim();
      if (!trimmed) continue;

      const directId = this.dataComponentIdIndex.get(trimmed.toUpperCase());
      if (directId) {
        matches.add(directId);
        continue;
      }
      if (this.dataComponentMap.has(trimmed)) {
        matches.add(trimmed);
        continue;
      }

      const key = this.normalizeLookupKey(trimmed);
      if (!key) continue;
      collectMatches(this.dataComponentNameIndex, key);
      collectMatches(this.logSourceNameIndex, key);
      collectMatches(this.dataSourceNameIndex, key);
    }

    const resolved: DataComponentInfo[] = [];
    matches.forEach((stixId) => {
      const dc = this.dataComponentMap.get(stixId);
      if (dc) resolved.push(dc);
    });
    return resolved;
  }

  getTechniquesBySourceHints(hints: string[], tactics?: string[]): TechniqueInfo[] {
    const dataComponents = this.resolveDataComponentsFromHints(hints);
    if (dataComponents.length === 0) return [];
    const normalizedTactics = this.normalizeTacticHints(tactics);
    const results = new Map<string, TechniqueInfo>();

    if (normalizedTactics.length > 0) {
      for (const dc of dataComponents) {
        for (const tactic of normalizedTactics) {
          const inferred = this.getTechniquesByTacticAndDataComponent(tactic, dc.name);
          inferred.forEach((tech) => results.set(tech.id, tech));
        }
      }
    } else {
      for (const dc of dataComponents) {
        const inferred = this.getTechniquesByDataComponentName(dc.name);
        inferred.forEach((tech) => results.set(tech.id, tech));
      }
    }

    return Array.from(results.values());
  }

  getLogRequirements(techniqueId: string): LogRequirement[] {
    const normalized = techniqueId.toUpperCase();
    const requirements: LogRequirement[] = [];
    
    const strategyStixIds = this.techniqueToStrategies.get(normalized) || [];
    
    if (strategyStixIds.length === 0) {
      const tech = this.techniqueMap.get(normalized);
      if (tech && tech.dataSources.length > 0) {
        for (const ds of tech.dataSources) {
          requirements.push({
            strategyId: 'INFERRED',
            strategyName: `Inferred from ${normalized}`,
            analyticId: 'INFERRED',
            analyticName: 'Data source based detection',
            dataComponentId: ds,
            dataComponentName: ds,
            dataSourceName: ds.split(':')[0] || ds,
          });
        }
      }
      return requirements;
    }
    
    for (const stratStixId of strategyStixIds) {
      const strategy = this.strategyMap.get(stratStixId);
      if (!strategy) continue;
      
      const analyticStixIds = this.strategyToAnalytics.get(stratStixId) || [];
      
      for (const analyticStixId of analyticStixIds) {
        const analytic = this.analyticMap.get(analyticStixId);
        if (!analytic) continue;
        
        for (const dcRef of analytic.dataComponentRefs) {
          const dc = this.dataComponentMap.get(dcRef);
          if (!dc) continue;
          
          requirements.push({
            strategyId: strategy.id,
            strategyName: strategy.name,
            analyticId: analytic.id,
            analyticName: analytic.name,
            dataComponentId: dc.id,
            dataComponentName: dc.name,
            dataSourceName: dc.dataSourceName,
          });
        }
      }
    }
    
    return requirements;
  }

  getStrategiesForTechnique(techniqueId: string): StrategyInfo[] {
    const normalized = techniqueId.toUpperCase();
    const strategyStixIds = this.techniqueToStrategies.get(normalized) || [];
    
    return strategyStixIds
      .map(id => this.strategyMap.get(id))
      .filter((s): s is StrategyInfo => s !== undefined);
  }

  getAnalyticsForStrategy(strategyStixId: string): AnalyticInfo[] {
    const analyticStixIds = this.strategyToAnalytics.get(strategyStixId) || [];
    
    return analyticStixIds
      .map(id => this.analyticMap.get(id))
      .filter((a): a is AnalyticInfo => a !== undefined);
  }

  getDataComponentsForAnalytic(analyticStixId: string): DataComponentInfo[] {
    const analytic = this.analyticMap.get(analyticStixId);
    if (!analytic) return [];
    
    return analytic.dataComponentRefs
      .map(id => this.dataComponentMap.get(id))
      .filter((dc): dc is DataComponentInfo => dc !== undefined);
  }

  private getParentTechniqueId(techniqueId: string): string | null {
    if (techniqueId.includes('.')) {
      return techniqueId.split('.')[0];
    }
    return null;
  }

  private getStrategiesForTechniqueWithFallback(techniqueId: string): string[] {
    const normalized = techniqueId.toUpperCase();
    let strategyStixIds = this.techniqueToStrategies.get(normalized) || [];
    
    if (strategyStixIds.length === 0) {
      const parentId = this.getParentTechniqueId(normalized);
      if (parentId) {
        strategyStixIds = this.techniqueToStrategies.get(parentId) || [];
      }
    }
    
    return strategyStixIds;
  }

  getFullMappingForTechniques(techniqueIds: string[], platforms?: string[]): {
    detectionStrategies: Array<{
      id: string;
      name: string;
      description: string;
      techniques: string[];
      analytics: Array<{
        id: string;
        name: string;
        description: string;
        platforms: string[];
        dataComponents: string[];
        logSources: Array<{
          dataComponentId: string;
          dataComponentName: string;
          name: string;
          channel?: string;
        }>;
        mutableElements: Array<{
          field: string;
          description: string;
        }>;
      }>;
      source: 'stix' | 'stix_parent';
    }>;
    dataComponents: Array<{
      id: string;
      name: string;
      dataSource: string;
    }>;
    carAnalytics: Array<{
      id: string;
      name: string;
      shortName: string;
      techniques: string[];
      fields: string[];
      coverage: string;
    }>;
    techniqueNames: Record<string, string>;
  } {
    if (!Array.isArray(techniqueIds)) {
      throw new TypeError('techniqueIds must be an array');
    }

    const sanitizedIds = techniqueIds
      .filter((id): id is string => typeof id === 'string')
      .map(id => id.trim())
      .filter(id => id.length > 0)
      .map(id => id.toUpperCase());

    if (sanitizedIds.length === 0) {
      return {
        detectionStrategies: [],
        dataComponents: [],
        carAnalytics: [],
        techniqueNames: {},
      };
    }

    const seenDataComponents = new Set<string>();
    const seenCarAnalytics = new Set<string>();
    
    const dataComponents: Array<{
      id: string;
      name: string;
      dataSource: string;
    }> = [];
    
    const carAnalytics: Array<{
      id: string;
      name: string;
      shortName: string;
      techniques: string[];
      fields: string[];
      coverage: string;
    }> = [];
    
    const strategyOutputMap = new Map<string, {
      id: string;
      name: string;
      description: string;
      techniques: Set<string>;
      analytics: Array<{
        id: string;
        name: string;
        description: string;
        platforms: string[];
        dataComponents: string[];
        logSources: Array<{
          dataComponentId: string;
          dataComponentName: string;
          name: string;
          channel?: string;
        }>;
        mutableElements: Array<{
          field: string;
          description: string;
        }>;
      }>;
      source: 'stix' | 'stix_parent';
    }>();
    
    for (const normalized of sanitizedIds) {
      
      const directStrategyStixIds = this.techniqueToStrategies.get(normalized) || [];
      const usedParentFallback = directStrategyStixIds.length === 0;
      const strategyStixIds = this.getStrategiesForTechniqueWithFallback(normalized);
      
      for (const stratStixId of strategyStixIds) {
        if (strategyOutputMap.has(stratStixId)) {
          const existing = strategyOutputMap.get(stratStixId)!;
          existing.techniques.add(normalized);
          if (usedParentFallback && existing.source === 'stix') {
            existing.source = 'stix_parent';
          }
          continue;
        }
        
        const strategy = this.strategyMap.get(stratStixId);
        if (!strategy) continue;
        
        const analyticStixIds = this.strategyToAnalytics.get(stratStixId) || [];
        const analyticsForStrategy: Array<{
          id: string;
          name: string;
          description: string;
          platforms: string[];
          dataComponents: string[];
          logSources: Array<{
            dataComponentId: string;
            dataComponentName: string;
            name: string;
            channel?: string;
          }>;
          mutableElements: Array<{
            field: string;
            description: string;
          }>;
        }> = [];

        for (const analyticStixId of analyticStixIds) {
          const analytic = this.analyticMap.get(analyticStixId);
          if (!analytic) continue;

          const dcIds: string[] = [];
          const logSources: Array<{
            dataComponentId: string;
            dataComponentName: string;
            name: string;
            channel?: string;
          }> = [];

          for (const dcRef of analytic.dataComponentRefs) {
            const dc = this.dataComponentMap.get(dcRef);
            if (dc) {
              dcIds.push(dc.id);
              if (!seenDataComponents.has(dc.id)) {
                seenDataComponents.add(dc.id);
                dataComponents.push({
                  id: dc.id,
                  name: dc.name,
                  dataSource: dc.dataSourceName,
                });
              }
            }
          }

          // Build log sources from the analytic's log source references
          for (const lsr of analytic.logSourceReferences) {
            const dc = this.dataComponentMap.get(lsr.dataComponentRef);
            if (dc) {
              logSources.push({
                dataComponentId: dc.id,
                dataComponentName: dc.name,
                name: lsr.name,
                channel: lsr.channel,
              });
            }
          }

          if (platforms && platforms.length > 0 && analytic.platforms.length > 0) {
            const platformMatch = platformMatchesAny(analytic.platforms, platforms);
            if (!platformMatch) {
              continue;
            }
          }

          analyticsForStrategy.push({
            id: analytic.id,
            name: analytic.name,
            description: analytic.description,
            platforms: analytic.platforms,
            dataComponents: dcIds,
            logSources,
            mutableElements: analytic.mutableElements,
          });
        }
        
        const techniquesSet = new Set(strategy.techniques);
        techniquesSet.add(normalized);
        
        strategyOutputMap.set(stratStixId, {
          id: strategy.id,
          name: strategy.name,
          description: strategy.description,
          techniques: techniquesSet,
          analytics: analyticsForStrategy,
          source: usedParentFallback ? 'stix_parent' : 'stix',
        });
      }
      
      const techCarAnalytics = this.techniqueToCarAnalytics.get(normalized) || [];
      for (const carAnalytic of techCarAnalytics) {
        if (seenCarAnalytics.has(carAnalytic.name)) continue;
        seenCarAnalytics.add(carAnalytic.name);
        
        const techniques = carAnalytic.attack.map(a => a.technique.replace('Technique/', ''));
        const coverage = carAnalytic.attack.find(a => 
          a.technique.replace('Technique/', '').toUpperCase() === normalized
        )?.coverage || 'Unknown';
        
        carAnalytics.push({
          id: carAnalytic.name,
          name: carAnalytic.name,
          shortName: carAnalytic.shortName,
          techniques,
          fields: carAnalytic.fields,
          coverage,
        });
      }
    }
    
    const strategies = Array.from(strategyOutputMap.values()).map(s => ({
      ...s,
      techniques: Array.from(s.techniques),
    }));

    const techniqueNames: Record<string, string> = {};
    for (const techId of sanitizedIds) {
      const tech = this.getTechnique(techId);
      if (tech) {
        techniqueNames[techId.toUpperCase()] = tech.name;
      }
    }
    
    return { detectionStrategies: strategies, dataComponents, carAnalytics, techniqueNames };
  }

  getStats(): { techniques: number; strategies: number; analytics: number; dataComponents: number; dataSources: number } {
    return {
      techniques: this.techniqueMap.size,
      strategies: this.strategyMap.size,
      analytics: this.analyticMap.size,
      dataComponents: this.dataComponentMap.size,
      dataSources: this.dataSourceMap.size,
    };
  }

  getPlatforms(): string[] {
    const platforms = new Set<string>();
    this.techniqueMap.forEach(tech => {
      tech.platforms.forEach(platform => platforms.add(platform));
    });
    this.analyticMap.forEach(analytic => {
      analytic.platforms.forEach(platform => platforms.add(platform));
    });
    return Array.from(platforms).sort((a, b) => a.localeCompare(b));
  }

  getTechniquesByPlatform(platformName: string): TechniqueInfo[] {
    const techniques: TechniqueInfo[] = [];
    this.techniqueMap.forEach((tech) => {
      if (platformMatchesAny(tech.platforms, [platformName])) {
        techniques.push(tech);
      }
    });
    
    return techniques;
  }

  getDataComponentsForPlatformsViaTechniques(platforms: string[]): DataComponentInfo[] {
    const normalizedPlatforms = normalizePlatformList(platforms);
    if (normalizedPlatforms.length === 0) {
      return [];
    }

    const techniqueIds = new Set<string>();
    normalizedPlatforms.forEach((platform) => {
      this.getTechniquesByPlatform(platform).forEach((tech) => techniqueIds.add(tech.id));
    });

    if (techniqueIds.size === 0) {
      return [];
    }

    const seenDataComponents = new Set<string>();
    const dataComponents: DataComponentInfo[] = [];

    techniqueIds.forEach((techniqueId) => {
      const strategyStixIds = this.getStrategiesForTechniqueWithFallback(techniqueId);
      for (const stratStixId of strategyStixIds) {
        const analyticStixIds = this.strategyToAnalytics.get(stratStixId) || [];
        for (const analyticStixId of analyticStixIds) {
          const analytic = this.analyticMap.get(analyticStixId);
          if (!analytic) continue;

          if (analytic.platforms.length > 0 && !platformMatchesAny(analytic.platforms, normalizedPlatforms)) {
            continue;
          }

          for (const dcRef of analytic.dataComponentRefs) {
            const dc = this.dataComponentMap.get(dcRef);
            if (!dc) continue;
            if (seenDataComponents.has(dc.id)) continue;
            seenDataComponents.add(dc.id);
            dataComponents.push(dc);
          }
        }
      }
    });

    return dataComponents;
  }

  getTechniquesByHybridSelector(selectorType: 'platform', selectorValue: string): string[] {
    return this.getTechniquesByPlatform(selectorValue).map(t => t.id);
  }

  /**
   * Tier 2 Inference: Get techniques by tactic and data component
   *
   * This is the core method for inferring techniques when a Sigma rule
   * only has a tactic tag (e.g., attack.execution) but no specific technique ID.
   *
   * Traversal Path:
   * 1. DataComponent (by name) → DataComponent STIX ID
   * 2. DataComponent STIX ID → Analytics (via dataComponentToAnalytics)
   * 3. Analytics → Strategies (via analyticToStrategies)
   * 4. Strategies → Techniques (via techniqueToStrategies reverse lookup)
   * 5. Filter by tactic
   *
   * @param tacticName - The tactic name (e.g., "execution", "persistence")
   * @param dataComponentName - The MITRE data component name (e.g., "Process Creation")
   * @returns Array of techniques that match both the tactic and require the data component
   */
  getTechniquesByTacticAndDataComponent(
    tacticName: string,
    dataComponentName: string
  ): TechniqueInfo[] {
    const results: TechniqueInfo[] = [];
    const seenTechniques = new Set<string>();
    const tacticLower = tacticName.toLowerCase().replace(/-/g, '-');

    // Step 1: Find data component STIX ID by name (case-insensitive)
    const dcNameLower = dataComponentName.toLowerCase();
    let targetDcStixId: string | null = null;

    this.dataComponentMap.forEach((dc, stixId) => {
      if (dc.name.toLowerCase() === dcNameLower) {
        targetDcStixId = stixId;
      }
    });

    if (!targetDcStixId) {
      // Data component not found - try partial match
      this.dataComponentMap.forEach((dc, stixId) => {
        if (dc.name.toLowerCase().includes(dcNameLower) || dcNameLower.includes(dc.name.toLowerCase())) {
          targetDcStixId = stixId;
        }
      });
    }

    if (!targetDcStixId) {
      console.warn(`[Tier 2] Data component not found: ${dataComponentName}`);
      return results;
    }

    // Step 2: Get all analytics that use this data component
    const analyticStixIds = this.dataComponentToAnalytics.get(targetDcStixId) || [];

    if (analyticStixIds.length === 0) {
      console.warn(`[Tier 2] No analytics found for data component: ${dataComponentName}`);
      return results;
    }

    // Step 3: Get all strategies that contain these analytics
    const strategyStixIds = new Set<string>();
    for (const analyticStixId of analyticStixIds) {
      const strategies = this.analyticToStrategies.get(analyticStixId) || [];
      for (const stratId of strategies) {
        strategyStixIds.add(stratId);
      }
    }

    // Step 4: Get all techniques detected by these strategies
    // We need to reverse-lookup techniqueToStrategies
    this.techniqueToStrategies.forEach((stratIds, techId) => {
      for (const stratId of stratIds) {
        if (strategyStixIds.has(stratId)) {
          const tech = this.techniqueMap.get(techId);
          if (tech && !seenTechniques.has(techId)) {
            // Step 5: Filter by tactic
            const tacticMatch = tech.tactics.some(t =>
              t.toLowerCase().replace(/_/g, '-') === tacticLower ||
              t.toLowerCase().replace(/-/g, '-') === tacticLower
            );

            if (tacticMatch) {
              seenTechniques.add(techId);
              results.push(tech);
            }
          }
          break;
        }
      }
    });

    // Fallback: If no results from strategy traversal, try direct data source matching
    if (results.length === 0) {
      const dcInfo = this.dataComponentMap.get(targetDcStixId);
      if (dcInfo) {
        const dsName = dcInfo.dataSourceName || dcInfo.name;

        this.techniqueMap.forEach((tech, techId) => {
          if (seenTechniques.has(techId)) return;

          // Check if technique's data sources contain this component
          const hasDataSource = tech.dataSources.some(ds =>
            ds.toLowerCase().includes(dcNameLower) ||
            ds.toLowerCase().includes(dsName.toLowerCase())
          );

          if (hasDataSource) {
            // Filter by tactic
            const tacticMatch = tech.tactics.some(t =>
              t.toLowerCase().replace(/_/g, '-') === tacticLower ||
              t.toLowerCase().replace(/-/g, '-') === tacticLower
            );

            if (tacticMatch) {
              seenTechniques.add(techId);
              results.push(tech);
            }
          }
        });
      }
    }

    console.log(`[Tier 2] Found ${results.length} techniques for tactic="${tacticName}" + dataComponent="${dataComponentName}"`);
    return results;
  }

  /**
   * Tier 2 Inference (No tactic filter): Get techniques by data component name only.
   */
  getTechniquesByDataComponentName(dataComponentName: string): TechniqueInfo[] {
    const results: TechniqueInfo[] = [];
    const seenTechniques = new Set<string>();
    let targetDcStixId: string | null = null;

    const trimmed = typeof dataComponentName === 'string' ? dataComponentName.trim() : '';
    if (trimmed) {
      const idMatch = this.dataComponentIdIndex.get(trimmed.toUpperCase());
      if (idMatch) {
        targetDcStixId = idMatch;
      } else if (this.dataComponentMap.has(trimmed)) {
        targetDcStixId = trimmed;
      }
    }

    const dcNameLower = this.normalizeName(dataComponentName);
    this.dataComponentMap.forEach((dc, stixId) => {
      if (!targetDcStixId && dc.name.toLowerCase() === dcNameLower) {
        targetDcStixId = stixId;
      }
    });

    if (!targetDcStixId) {
      this.dataComponentMap.forEach((dc, stixId) => {
        if (dc.name.toLowerCase().includes(dcNameLower) || dcNameLower.includes(dc.name.toLowerCase())) {
          targetDcStixId = stixId;
        }
      });
    }

    if (targetDcStixId && this.dataComponentDetects.has(targetDcStixId)) {
      const techStixIds = this.dataComponentDetects.get(targetDcStixId) || new Set<string>();
      techStixIds.forEach((techStixId) => {
        const tech = this.techniqueByStixId.get(techStixId);
        if (tech && !seenTechniques.has(tech.id)) {
          seenTechniques.add(tech.id);
          results.push(tech);
        }
      });
      return results;
    }

    if (targetDcStixId) {
      const analyticStixIds = this.dataComponentToAnalytics.get(targetDcStixId) || [];
      const strategyStixIds = new Set<string>();

      for (const analyticStixId of analyticStixIds) {
        const strategies = this.analyticToStrategies.get(analyticStixId) || [];
        for (const stratId of strategies) {
          strategyStixIds.add(stratId);
        }
      }

      this.techniqueToStrategies.forEach((stratIds, techId) => {
        for (const stratId of stratIds) {
          if (strategyStixIds.has(stratId)) {
            const tech = this.techniqueMap.get(techId);
            if (tech && !seenTechniques.has(techId)) {
              seenTechniques.add(techId);
              results.push(tech);
            }
            break;
          }
        }
      });
    }

    if (results.length === 0) {
      const dcInfo = targetDcStixId ? this.dataComponentMap.get(targetDcStixId) : null;
      const dsName = dcInfo?.dataSourceName || dcInfo?.name;

      this.techniqueMap.forEach((tech, techId) => {
        if (seenTechniques.has(techId)) return;
        const hasDataSource = tech.dataSources.some(ds =>
          ds.toLowerCase().includes(dcNameLower) ||
          (dsName ? ds.toLowerCase().includes(dsName.toLowerCase()) : false)
        );

        if (hasDataSource) {
          seenTechniques.add(techId);
          results.push(tech);
        }
      });
    }

    return results;
  }

  /**
   * Get data component info by name
   */
  getDataComponentByName(name: string): DataComponentInfo | null {
    const nameLower = name.toLowerCase();
    let result: DataComponentInfo | null = null;

    this.dataComponentMap.forEach((dc) => {
      if (dc.name.toLowerCase() === nameLower) {
        result = dc;
      }
    });

    return result;
  }

  /**
   * Get all data components (useful for debugging and map generation)
   */
  getAllDataComponents(): DataComponentInfo[] {
    return Array.from(this.dataComponentMap.values());
  }

  /**
   * Get all techniques by tactic (useful for debugging)
   */
  getTechniquesByTactic(tacticName: string): TechniqueInfo[] {
    const tacticLower = tacticName.toLowerCase().replace(/-/g, '-');
    const results: TechniqueInfo[] = [];

    this.techniqueMap.forEach((tech) => {
      const tacticMatch = tech.tactics.some(t =>
        t.toLowerCase().replace(/_/g, '-') === tacticLower ||
        t.toLowerCase().replace(/-/g, '-') === tacticLower
      );

      if (tacticMatch) {
        results.push(tech);
      }
    });

    return results;
  }
}

export const mitreKnowledgeGraph = new MitreKnowledgeGraph();
