#!/usr/bin/env python3
# FIXED_VERSION_MARKER
"""
MITRE ATT&CK v18+ Data Extractor
Extracts Tactics, Assets, Data Components, Detection Strategies, Analytics, and Techniques from STIX.
"""

import json
import os
import re
import sys
from typing import Any, Dict, List, Optional, Set, Tuple

import requests

# Default: Enterprise ATT&CK v18+ from attack-stix-data repo (STIX 2.1 format with full defensive model).
# This matches the URL used by server/mitre-stix/knowledge-graph.ts for consistency.
# Pin via MITRE_STIX_URL env var if needed.
STIX_URL = os.environ.get(
    "MITRE_STIX_URL",
    "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json",
)

# Domain filter: enterprise-attack | ics-attack | mobile-attack
MITRE_DOMAIN = os.environ.get("MITRE_DOMAIN", "enterprise-attack")

OUTPUT_PATH = os.environ.get("MITRE_TS_OUT", "client/src/lib/mitreData.ts")
SEED_SCRIPT_PATH = os.environ.get("MITRE_SEED_SCRIPT", "scripts/seed_data.ts")


def _is_active(obj: Dict[str, Any]) -> bool:
    return not obj.get("revoked", False) and not obj.get("x_mitre_deprecated", False)


def _in_domain(obj: Dict[str, Any], domain: str) -> bool:
    domains = obj.get("x_mitre_domains", [])
    return isinstance(domains, list) and domain in domains


def _get_attack_external_id(obj: Dict[str, Any], prefix: Optional[str] = None) -> Optional[str]:
    """
    Return the ATT&CK external_id from external_references where source_name == 'mitre-attack'.
    Optionally require it to start with a given prefix like 'T', 'DC', 'DET', 'AN'.
    """
    refs = obj.get("external_references", [])
    if not isinstance(refs, list):
        return None
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        if ref.get("source_name") != "mitre-attack":
            continue
        ext_id = ref.get("external_id")
        if not isinstance(ext_id, str):
            continue
        if prefix and not ext_id.startswith(prefix):
            continue
        return ext_id
    return None


def _stix_objects(bundle: Any) -> List[Dict[str, Any]]:
    """
    CTI bundles are usually {"type":"bundle","objects":[...]}.
    Some sources may provide a raw list of objects.
    """
    if isinstance(bundle, dict) and isinstance(bundle.get("objects"), list):
        return bundle["objects"]
    if isinstance(bundle, list):
        return [o for o in bundle if isinstance(o, dict)]
    raise ValueError("Unrecognised STIX JSON structure (expected bundle with 'objects' or a list).")


def _read_required_exports_from_seed(seed_path: str) -> Set[str]:
    """
    Parse `import { a, b, c } from '../client/src/lib/mitreData'` and return imported names.
    This lets us auto-stub exports like `ctidProducts` so ESM import doesn't crash.
    Handles multiline imports.
    """
    try:
        with open(seed_path, "r", encoding="utf-8") as f:
            txt = f.read()
    except OSError:
        return set()

    # Match multiline imports using DOTALL flag (. matches newlines)
    # Pattern: import { ... } from '...mitreData...'
    m = re.search(
        r"import\s*\{\s*([^}]+)\s*\}\s*from\s*['\"][^'\"]*mitreData[^'\"]*['\"]",
        txt,
        re.DOTALL  # Allow . to match newlines for multiline imports
    )
    if not m:
        return set()

    names_raw = m.group(1)
    names: Set[str] = set()

    # Split by comma, handling newlines and whitespace
    for part in names_raw.split(","):
        # Remove newlines and extra whitespace
        part = " ".join(part.split()).strip()
        if not part:
            continue
        # Handle "foo as bar" aliasing
        part = part.split(" as ")[0].strip()
        if part:
            names.add(part)

    return names


def extract_mitre_data() -> Dict[str, Any]:
    print(f"[PY_DEBUG] Downloading STIX from {STIX_URL}", file=sys.stderr)
    resp = requests.get(STIX_URL, timeout=180)
    resp.raise_for_status()
    bundle = resp.json()

    objs = _stix_objects(bundle)
    by_id: Dict[str, Dict[str, Any]] = {}
    for o in objs:
        oid = o.get("id")
        if isinstance(oid, str):
            by_id[oid] = o

    # ---- Collect core objects (filtered to domain + active where applicable) ----
    tactics: List[Dict[str, Any]] = []
    assets: List[Dict[str, Any]] = []
    data_components: List[Dict[str, Any]] = []
    techniques: List[Dict[str, Any]] = []
    detection_strategies: List[Dict[str, Any]] = []

    # Maps
    technique_stix_to_tid: Dict[str, str] = {}
    tid_to_tech_index: Dict[str, int] = {}
    dc_stix_ids: Set[str] = set()

    analytics_by_stix: Dict[str, Dict[str, Any]] = {}
    ds_by_stix: Dict[str, Dict[str, Any]] = {}

    # ---- First pass: extract objects by type ----
    for o in objs:
        otype = o.get("type")
        if not isinstance(otype, str):
            continue

        # Tactics
        if otype == "x-mitre-tactic" and _is_active(o) and _in_domain(o, MITRE_DOMAIN):
            tactics.append(
                {
                    "id": o.get("x_mitre_shortname") or o.get("id"),
                    "name": o.get("name") or "",
                    "description": o.get("description") or "",
                }
            )

        # Assets (primarily relevant to ICS; enterprise often has 0)
        if otype == "x-mitre-asset" and _is_active(o) and _in_domain(o, MITRE_DOMAIN):
            assets.append(
                {
                    "id": o.get("id"),
                    "name": o.get("name") or "",
                    "description": o.get("description") or "",
                    "domain": MITRE_DOMAIN,
                }
            )

        # Data Components
        if otype == "x-mitre-data-component" and _is_active(o) and _in_domain(o, MITRE_DOMAIN):
            stix_id = o.get("id")
            if isinstance(stix_id, str):
                dc_stix_ids.add(stix_id)

            # Data Sources are deprecated in v18; we surface log source names as a “best available” label.
            log_sources = o.get("x_mitre_log_sources", [])
            src_names: List[str] = []
            if isinstance(log_sources, list):
                for ls in log_sources:
                    if isinstance(ls, dict) and isinstance(ls.get("name"), str):
                        src_names.append(ls["name"])
            data_source_label = ", ".join(sorted(set(src_names)))

            data_components.append(
                {
                    "id": o.get("id"),
                    "name": o.get("name") or "",
                    "description": o.get("description") or "",
                    "dataSource": data_source_label,
                }
            )

        # Techniques (attack-pattern with a mitre-attack external_id Txxxx)
        if otype == "attack-pattern" and _is_active(o) and _in_domain(o, MITRE_DOMAIN):
            tid = _get_attack_external_id(o, prefix="T")
            if not tid:
                continue

            stix_id = o.get("id")
            if isinstance(stix_id, str):
                technique_stix_to_tid[stix_id] = tid

            # Tactics from kill_chain_phases
            tech_tactics: List[str] = []
            kcp = o.get("kill_chain_phases", [])
            if isinstance(kcp, list):
                for phase in kcp:
                    if not isinstance(phase, dict):
                        continue
                    kcn = phase.get("kill_chain_name")
                    pn = phase.get("phase_name")
                    if kcn in ("mitre-attack", "mitre-ics-attack") and isinstance(pn, str):
                        tech_tactics.append(pn)

            platforms = o.get("x_mitre_platforms")
            if not isinstance(platforms, list):
                platforms = []

            is_sub = o.get("x_mitre_is_subtechnique")
            if not isinstance(is_sub, bool):
                is_sub = False

            tid_to_tech_index[tid] = len(techniques)
            techniques.append(
                {
                    "id": tid,
                    "name": o.get("name") or "",
                    "description": o.get("description") or "",
                    "tactics": tech_tactics,
                    "detectionStrategyIds": [],  # filled after we parse DS relationships
                    "platforms": platforms,
                    "isSubtechnique": is_sub,
                }
            )

        # Analytics (new in v18 defensive model)
        if otype == "x-mitre-analytic" and _is_active(o) and _in_domain(o, MITRE_DOMAIN):
            stix_id = o.get("id")
            if isinstance(stix_id, str):
                analytics_by_stix[stix_id] = o

        # Detection Strategies (new in v18 defensive model)
        if otype == "x-mitre-detection-strategy" and _is_active(o) and _in_domain(o, MITRE_DOMAIN):
            stix_id = o.get("id")
            if isinstance(stix_id, str):
                ds_by_stix[stix_id] = o

    print(f"[✓] Extracted {len(tactics)} tactics", file=sys.stderr)
    print(f"[✓] Extracted {len(assets)} assets", file=sys.stderr)
    print(f"[✓] Extracted {len(data_components)} data components", file=sys.stderr)
    print(f"[✓] Extracted {len(techniques)} techniques", file=sys.stderr)

    # ---- Second pass: detects relationships (DetectionStrategy -> Technique) ----
    ds_to_tech_stix: Dict[str, List[str]] = {}
    tech_tid_to_ds_ids: Dict[str, Set[str]] = {}

    for o in objs:
        if o.get("type") != "relationship":
            continue
        if o.get("relationship_type") != "detects":
            continue

        src = o.get("source_ref")
        tgt = o.get("target_ref")
        if not (isinstance(src, str) and isinstance(tgt, str)):
            continue
        if not src.startswith("x-mitre-detection-strategy--"):
            continue
        if not tgt.startswith("attack-pattern--"):
            continue

        ds_obj = ds_by_stix.get(src)
        tech_obj = by_id.get(tgt)

        # Ensure both ends are in-domain (relationships themselves may not have x_mitre_domains)
        if not ds_obj or not tech_obj:
            continue
        if not _in_domain(ds_obj, MITRE_DOMAIN) or not _in_domain(tech_obj, MITRE_DOMAIN):
            continue

        ds_to_tech_stix.setdefault(src, []).append(tgt)

        tid = technique_stix_to_tid.get(tgt)
        ds_id = _get_attack_external_id(ds_obj, prefix="DET") or src
        if tid:
            tech_tid_to_ds_ids.setdefault(tid, set()).add(ds_id)

    # ---- Build DetectionStrategy objects with nested Analytics ----
    total_analytics = 0

    for ds_stix, ds_obj in ds_by_stix.items():
        ds_id = _get_attack_external_id(ds_obj, prefix="DET") or ds_stix

        # Techniques detected by this DS
        tech_ids: List[str] = []
        for tech_stix in ds_to_tech_stix.get(ds_stix, []):
            tid = technique_stix_to_tid.get(tech_stix)
            if tid:
                tech_ids.append(tid)

        # Analytics referenced by this DS
        analytics: List[Dict[str, Any]] = []
        dc_refs: Set[str] = set()

        analytic_refs = ds_obj.get("x_mitre_analytic_refs", [])
        if isinstance(analytic_refs, list):
            for a_stix in analytic_refs:
                if not isinstance(a_stix, str):
                    continue
                a_obj = analytics_by_stix.get(a_stix)
                if not a_obj:
                    continue

                a_id = _get_attack_external_id(a_obj, prefix="AN") or a_stix

                # Data components referenced by the analytic
                dcs: List[str] = []
                lsr = a_obj.get("x_mitre_log_source_references", [])
                if isinstance(lsr, list):
                    for entry in lsr:
                        if not isinstance(entry, dict):
                            continue
                        dc = entry.get("x_mitre_data_component_ref")
                        if isinstance(dc, str) and (dc in dc_stix_ids):
                            dcs.append(dc)

                dcs = sorted(set(dcs))
                for dc in dcs:
                    dc_refs.add(dc)

                analytics.append(
                    {
                        "id": a_id,
                        "name": a_obj.get("name") or "",
                        "description": a_obj.get("description") or "",
                        "pseudocode": "",  # optional; can be populated later if you add a mapping layer
                        "dataComponents": dcs,
                    }
                )

        total_analytics += len(analytics)

        # Only emit DS entries that actually link to something useful
        if tech_ids or analytics:
            detection_strategies.append(
                {
                    "id": ds_id,
                    "name": ds_obj.get("name") or "",
                    "description": ds_obj.get("description") or "",
                    "techniques": sorted(set(tech_ids)),
                    "analytics": analytics,
                    "dataComponentRefs": sorted(dc_refs),
                }
            )

    # ---- Back-fill technique.detectionStrategyIds ----
    for tid, ds_ids in tech_tid_to_ds_ids.items():
        idx = tid_to_tech_index.get(tid)
        if idx is None:
            continue
        techniques[idx]["detectionStrategyIds"] = sorted(ds_ids)

    print(f"[✓] Generated {len(detection_strategies)} detection strategies", file=sys.stderr)
    print(f"[✓] Generated {total_analytics} analytics in total", file=sys.stderr)

    return {
        "assets": assets,
        "dataComponents": data_components,
        "detectionStrategies": detectionStrategies_sort(detection_strategies),
        "techniques": techniques,
        "tactics": tactics,
    }


def detectionStrategies_sort(ds_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Prefer stable order by DETxxxx when present
    def keyfn(x: Dict[str, Any]) -> Tuple[int, str]:
        sid = x.get("id", "")
        if isinstance(sid, str) and sid.startswith("DET") and sid[3:].isdigit():
            return (0, sid)
        return (1, str(sid))
    return sorted(ds_list, key=keyfn)


def convert_to_ts(data: Dict[str, Any], extra_export_stubs: Set[str]) -> str:
    ts_out = """\
// This file is auto-generated by scripts/extract_mitre_data.py
// Do not edit this file manually.

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

export const mitreAssets: MitreAsset[] = """
    ts_out += json.dumps(data.get("assets", []), indent=2) + ";\n\n"

    ts_out += "export const dataComponents: DataComponentRef[] = "
    ts_out += json.dumps(data.get("dataComponents", []), indent=2) + ";\n\n"

    ts_out += "export const detectionStrategies: DetectionStrategy[] = "
    ts_out += json.dumps(data.get("detectionStrategies", []), indent=2) + ";\n\n"

    ts_out += "export const techniques: Technique[] = "
    ts_out += json.dumps(data.get("techniques", []), indent=2) + ";\n\n"

    ts_out += "export const tactics: Tactic[] = "
    ts_out += json.dumps(data.get("tactics", []), indent=2) + ";\n\n"

    # Stub missing exports required by the seed script (prevents ESM named-export failures)
    for name in sorted(extra_export_stubs):
        if name in {"mitreAssets", "dataComponents", "detectionStrategies", "techniques", "tactics"}:
            continue
        ts_out += f"export const {name}: any[] = [];\n"

    return ts_out


def main() -> None:
    print("[PY_DEBUG] Script execution started.", file=sys.stderr)

    data = extract_mitre_data()

    required = _read_required_exports_from_seed(SEED_SCRIPT_PATH)
    present = {"mitreAssets", "dataComponents", "detectionStrategies", "techniques", "tactics"}
    missing = required - present

    ts_code = convert_to_ts(data, missing)

    out_dir = os.path.dirname(OUTPUT_PATH)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        f.write(ts_code)

    print(f"[✓] Wrote updated data to {OUTPUT_PATH}", file=sys.stderr)
    if missing:
        print(f"[!] Stubbed missing TS exports for seed compatibility: {sorted(missing)}", file=sys.stderr)
    print("[PY_DEBUG] Script execution finished successfully.", file=sys.stderr)


if __name__ == "__main__":
    main()
