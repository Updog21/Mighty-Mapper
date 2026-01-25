import { ResourceAdapter, NormalizedMapping, AnalyticMapping, DataComponentMapping } from '../types';
import { fetchWithTimeout } from '../../utils/fetch';

const MITRE_STIX_URL = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';

interface STIXObject {
  id: string;
  type: string;
  name?: string;
  description?: string;
  external_references?: Array<{
    source_name: string;
    external_id?: string;
    url?: string;
  }>;
  x_mitre_platforms?: string[];
  x_mitre_data_source_ref?: string;
  x_mitre_detection?: string;
}

export class MitreStixAdapter implements ResourceAdapter {
  name: 'mitre_stix' = 'mitre_stix';
  private stixCache: STIXObject[] | null = null;

  isApplicable(_productType: string, _platforms: string[]): boolean {
    return true;
  }

  async fetchMappings(productName: string, vendor: string): Promise<NormalizedMapping | null> {
    const stixData = await this.getStixData();
    if (!stixData) return null;

    const relatedObjects = this.findRelatedObjects(stixData, productName, vendor);
    
    if (relatedObjects.length === 0) {
      return null;
    }

    return this.normalizeMappings(productName, relatedObjects);
  }

  private async getStixData(): Promise<STIXObject[] | null> {
    if (this.stixCache) return this.stixCache;

    try {
      const response = await fetchWithTimeout(MITRE_STIX_URL);
      if (!response.ok) return null;

      const data = await response.json();
      this.stixCache = data.objects || [];
      return this.stixCache;
    } catch {
      return null;
    }
  }

  private findRelatedObjects(stixData: STIXObject[], productName: string, vendor: string): STIXObject[] {
    const searchTerms = [
      productName.toLowerCase(),
      vendor.toLowerCase(),
      ...productName.toLowerCase().split(/\s+/),
    ];

    const assetMappings: Record<string, string[]> = {
      'firewall': ['network', 'firewall', 'perimeter'],
      'switch': ['network', 'switch', 'infrastructure'],
      'router': ['network', 'router', 'infrastructure'],
      'server': ['server', 'host', 'endpoint'],
      'workstation': ['workstation', 'desktop', 'endpoint'],
      'database': ['database', 'sql', 'data'],
      'web server': ['web', 'http', 'iis', 'apache', 'nginx'],
      'mail server': ['email', 'mail', 'exchange', 'smtp'],
      'domain controller': ['active directory', 'ldap', 'domain', 'authentication'],
      'vpn': ['vpn', 'remote access', 'tunnel'],
    };

    const relatedTerms = new Set<string>(searchTerms);
    for (const [asset, terms] of Object.entries(assetMappings)) {
      if (searchTerms.some(t => terms.includes(t) || asset.includes(t))) {
        terms.forEach(term => relatedTerms.add(term));
      }
    }

    const dataComponents = stixData.filter(obj => 
      obj.type === 'x-mitre-data-component' &&
      obj.name &&
      Array.from(relatedTerms).some(term => 
        obj.name!.toLowerCase().includes(term) ||
        obj.description?.toLowerCase().includes(term)
      )
    );

    const dataSources = stixData.filter(obj => 
      obj.type === 'x-mitre-data-source' &&
      obj.name &&
      Array.from(relatedTerms).some(term => 
        obj.name!.toLowerCase().includes(term) ||
        obj.description?.toLowerCase().includes(term)
      )
    );

    const assets = stixData.filter(obj => 
      obj.type === 'x-mitre-asset' &&
      obj.name &&
      Array.from(relatedTerms).some(term => 
        obj.name!.toLowerCase().includes(term) ||
        obj.description?.toLowerCase().includes(term)
      )
    );

    return [...dataComponents, ...dataSources, ...assets];
  }

  private normalizeMappings(productId: string, objects: STIXObject[]): NormalizedMapping {
    const analytics: AnalyticMapping[] = [];
    const dataComponents: DataComponentMapping[] = [];

    for (const obj of objects) {
      if (obj.type === 'x-mitre-data-component') {
        const externalId = obj.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id;
        
        dataComponents.push({
          id: externalId || obj.id,
          name: obj.name || 'Unknown',
          dataSource: obj.x_mitre_data_source_ref,
        });

        analytics.push({
          id: `MITRE-${externalId || obj.id}`,
          name: `Monitor ${obj.name}`,
          description: obj.description,
          source: 'mitre_stix',
        });
      } else if (obj.type === 'x-mitre-data-source') {
        dataComponents.push({
          id: obj.id,
          name: obj.name || 'Unknown',
          dataSource: 'MITRE Data Source',
        });
      } else if (obj.type === 'x-mitre-asset') {
        const externalId = obj.external_references?.find(r => r.source_name === 'mitre-attack')?.external_id;
        
        analytics.push({
          id: `MITRE-ASSET-${externalId || obj.id}`,
          name: `Asset: ${obj.name}`,
          description: obj.description,
          source: 'mitre_stix',
        });
      }
    }

    return {
      productId,
      source: 'mitre_stix',
      confidence: 0,
      detectionStrategies: [],
      analytics,
      dataComponents: Array.from(new Map(dataComponents.map(dc => [dc.id, dc])).values()),
      rawData: objects,
    };
  }
}
