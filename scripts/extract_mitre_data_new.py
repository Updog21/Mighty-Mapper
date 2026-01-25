#!/usr/bin/env python3
# FIXED_VERSION_MARKER
"""
MITRE ATT&CK v18 Data Extractor
Extracts Assets, Data Components, Detection Strategies, and Analytics from STIX data
"""

import json
import sys
import requests
import tempfile
import os
from mitreattack.stix20 import MitreAttackData

STIX_URL = "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json"

def extract_mitre_data():
    """Extract all MITRE v18 objects and output as JSON"""
    print("[PY_DEBUG] Starting data extraction...", file=sys.stderr)
    tmp_filepath = None
    try:
        # Create a temporary file to store the STIX data
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp_file:
            tmp_filepath = tmp_file.name
            print(f"[*] Downloading STIX data from {STIX_URL}", file=sys.stderr)
            response = requests.get(STIX_URL, timeout=120)
            response.raise_for_status()
            
            # Write the content to the temporary file
            tmp_file.write(response.text)
        
        print("[*] Loading MITRE ATT&CK v18 STIX Data from temp file...", file=sys.stderr)
        # Now pass the file path to the constructor
        mitre_data = MitreAttackData(tmp_filepath)
        print("[✓] Data loaded successfully", file=sys.stderr)

    except Exception as e:
        print(f"[✗] Error loading MITRE data: {e}", file=sys.stderr)
        return None
    finally:
        # Clean up the temporary file
        if tmp_filepath and os.path.exists(tmp_filepath):
            os.remove(tmp_filepath)
    
    result = {
        "assets": [],
        "dataComponents": [],
        "detectionStrategies": [],
        "techniques": [],
        "tactics": [],
    }

    # Extract Tactics (Kill Chain Phases)
    print("[*] Extracting Tactics...", file=sys.stderr)
    tactics = mitre_data.get_tactics(remove_revoked_deprecated=True)
    for tactic in tactics:
        result["tactics"].append({
            "id": tactic.x_mitre_shortname,
            "name": tactic.name,
            "description": tactic.description,
        })
    print(f"[✓] Extracted {len(result['tactics'])} tactics", file=sys.stderr)

    # Extract Assets
    print("[*] Extracting Assets...", file=sys.stderr)
    assets = mitre_data.get_assets(remove_revoked_deprecated=True)
    for asset in assets:
        result["assets"].append({
            "id": asset.id,
            "name": asset.name,
            "description": asset.description,
            "domain": "ICS" if "ics-attack" in asset.x_mitre_domains else "Enterprise",
        })
    print(f"[✓] Extracted {len(result['assets'])} assets", file=sys.stderr)

    # Extract Data Sources and Components
    print("[*] Extracting Data Sources and Components...", file=sys.stderr)
    data_sources = mitre_data.get_data_sources(remove_revoked_deprecated=True)
    for ds in data_sources:
        components = mitre_data.get_data_components_by_data_source(ds.id)
        for dc in components:
            result["dataComponents"].append({
                "id": dc.id,
                "name": dc.name,
                "description": dc.description,
                "dataSource": ds.name,
            })
    print(f"[✓] Extracted {len(result['dataComponents'])} data components", file=sys.stderr)

    # Extract Techniques, their relationships and build Strategies/Analytics
    print("[*] Extracting Techniques and Relationships...", file=sys.stderr)
    techniques = mitre_data.get_techniques(remove_revoked_deprecated=True, include_subtechniques=True)
    
    technique_to_datacomponent = {}

    all_relationships = mitre_data.get_relationships(remove_revoked_deprecated=True)
    for rel in all_relationships:
        if rel.relationship_type == 'detects':
            if rel.source_ref.startswith('x-mitre-data-component--') and rel.target_ref.startswith('attack-pattern--'):
                if rel.target_ref not in technique_to_datacomponent:
                    technique_to_datacomponent[rel.target_ref] = []
                
                technique_to_datacomponent[rel.target_ref].append({
                    "component_id": rel.source_ref,
                    "relationship_desc": rel.description
                })

    for tech in techniques:
        tech_id = tech.external_references[0].external_id
        
        # Get tactics
        tech_tactics = []
        if tech.kill_chain_phases:
            for phase in tech.kill_chain_phases:
                if phase.kill_chain_name == "mitre-attack" or phase.kill_chain_name == "mitre-ics-attack":
                    tech_tactics.append(phase.phase_name)

        # Build Detection Strategy and Analytics from relationships
        analytics = []
        data_component_refs = []
        if tech.id in technique_to_datacomponent:
            detection_relations = technique_to_datacomponent[tech.id]
            for i, rel in enumerate(detection_relations):
                analytic_id = f"AN-{tech_id}-{i+1}"
                try:
                    component_name = mitre_data.get_object_by_stix_id(rel['component_id']).name
                except Exception:
                    component_name = "Unknown Component"

                analytics.append({
                    "id": analytic_id,
                    "name": f"Detect {tech_id} with {component_name}",
                    "description": rel['relationship_desc'],
                    "dataComponents": [rel['component_id']],
                    "pseudocode": f"# This analytic is derived from the relationship between {tech_id} and a data component.",
                })
                data_component_refs.append(rel['component_id'])

        if analytics:
            strategy_id = f"DS-{tech_id}"
            result["detectionStrategies"].append({
                "id": strategy_id,
                "name": f"Detection Strategy for {tech_id}",
                "description": f"Analytic approaches to detect instances of the {tech.name} technique.",
                "techniques": [tech_id],
                "analytics": analytics,
                "dataComponentRefs": list(set(data_component_refs))
            })

        result["techniques"].append({
            "id": tech_id,
            "name": tech.name,
            "description": tech.description,
            "tactics": tech_tactics,
            "detectionStrategyIds": [f"DS-{tech_id}"] if analytics else [],
            "platforms": tech.x_mitre_platforms,
            "isSubtechnique": tech.x_mitre_is_subtechnique
        })

    print(f"[✓] Extracted {len(result['techniques'])} techniques", file=sys.stderr)
    print(f"[✓] Generated {len(result['detectionStrategies'])} detection strategies", file=sys.stderr)
    
    # Calculate total number of analytics
    total_analytics = sum(len(s['analytics']) for s in result['detectionStrategies'])
    print(f"[✓] Generated {total_analytics} analytics in total", file=sys.stderr)

    return result

def convert_to_ts(data):
    """Converts the extracted data to a TypeScript file."""
    print("[PY_DEBUG] Converting data to TypeScript format...", file=sys.stderr)
    print(f"[PY_DEBUG] Data keys available for conversion: {list(data.keys())}", file=sys.stderr)

    ts_out = """
// This file is auto-generated by scripts/extract_mitre_data.py
// Do not edit this file manually.
"""

    # Add interfaces (copied from existing mitreData.ts for compatibility)
    ts_out += """
export interface MitreAsset {
  id: string;
  name: string;
  domain: string;
  description: string;
}

export interface DataComponentRef {
  id: string;
  name: string;
  description: string;
  dataSource: string;
}

export interface AnalyticItem {
  id: string;
  name: string;
  description: string;
  pseudocode?: string;
  dataComponents: string[];
}

export interface DetectionStrategy {
  id: string;
  name: string;
  description: string;
  techniques: string[];
  analytics: AnalyticItem[];
  dataComponentRefs: string[];
}

export interface Technique {
  id: string;
  name: string;
  description: string;
  tactics: string[];
  detectionStrategyIds: string[];
  platforms: string[];
  isSubtechnique: boolean;
}

export interface Tactic {
    id: string;
    name: string;
    description: string;
}
"""

    # Add data
    ts_out += f"export const mitreAssets: MitreAsset[] = {json.dumps(data.get('assets', []), indent=2)};\n\n"
    ts_out += f"export const dataComponents: DataComponentRef[] = {json.dumps(data.get('dataComponents', []), indent=2)};\n\n"
    ts_out += f"export const detectionStrategies: DetectionStrategy[] = {json.dumps(data.get('detectionStrategies', []), indent=2)};\n\n"
    ts_out += f"export const techniques: Technique[] = {json.dumps(data.get('techniques', []), indent=2)};\n\n"
    ts_out += f"export const tactics: Tactic[] = {json.dumps(data.get('tactics', []), indent=2)};\n\n"
    
    print("[✓] TypeScript conversion complete", file=sys.stderr)
    return ts_out

if __name__ == "__main__":
    print("[PY_DEBUG] Script execution started.", file=sys.stderr)
    extracted_data = extract_mitre_data()
    
    if extracted_data:
        print("[PY_DEBUG] Data extraction successful, proceeding to file write.", file=sys.stderr)
        ts_code = convert_to_ts(extracted_data)
        
        output_path = "client/src/lib/mitreData.ts"
        try:
            with open(output_path, "w") as f:
                f.write(ts_code)
            print(f"[✓] Successfully wrote updated data to {output_path}", file=sys.stderr)
        except IOError as e:
            print(f"[✗] Error writing to file {output_path}: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print("[✗] Data extraction failed. Script will exit with error.", file=sys.stderr)
        sys.exit(1)
    
    print("[PY_DEBUG] Script execution finished successfully.", file=sys.stderr)
