# Technique Filter Research Contract

This file defines the source contract for the vendor product page scenario filter (Asset DNA model).

## Primary Runtime Data

- MITRE ATT&CK STIX dataset: https://github.com/mitre-attack/attack-stix-data
- MITRE ATT&CK Data Sources: https://github.com/mitre-attack/attack-datasources
- MITRE ATT&CK reference pages: https://attack.mitre.org/
- ATT&CK Navigator: https://mitre-attack.github.io/attack-navigator/

## Research Sources For Scoring and Defaults

- ASD Event Logging Best Practices (PDF): https://www.cyber.gov.au/sites/default/files/2024-08/best-practices-for-event-logging-and-threat-detection.pdf
- ASD Essential Eight Blueprint: https://blueprint.asd.gov.au/security-and-governance/essential-eight/
- ASD Essential Eight ATT&CK mapping article: https://www.linkedin.com/pulse/mapping-asd-essential-8-mitre-attck-framework-richard-gold
- ASD edge mitigation guidance: https://www.cyber.gov.au/business-government/protecting-devices-systems/hardening-systems-applications/network-hardening/securing-edge-devices/mitigation-strategies-for-edge-devices-practitioner-guidance
- NSA/CISA ATT&CK defenses: https://www.nsa.gov/Press-Room/Press-Releases-Statements/Press-Release-View/Article/2716870/nsa-cisa-release-cybersecurity-technical-report-mitre-attck-defenses
- CISA RVA ATT&CK summary: https://industrialcyber.co/cisa/cisa-report-detects-risk-and-vulnerability-assessments-plotted-to-mitre-attck-framework/
- SpecterOps prioritization: https://posts.specterops.io/prioritization-of-the-detection-engineering-backlog-dcb18a896981
- Kaspersky prioritization: https://securelist.com/detection-engineering-backlog-prioritization/113099/
- DeTT&CT wiki home: https://github.com/rabobank-cdc/DeTTECT/wiki/Home/a1e11cf95179ac2aa87f7f9f14677a2756bfdbb1
- DeTT&CT visibility scoring: https://github.com/rabobank-cdc/DeTTECT/wiki/Visibility-scoring
- Red Canary techniques report: https://redcanary.com/threat-detection-report/techniques/
- KillChainGraph (arXiv): https://arxiv.org/abs/2502.10825
- MCDM weighting (Nature): https://www.nature.com/articles/s41598-025-12948-x
- ATT&CK data-driven (PMC): https://pmc.ncbi.nlm.nih.gov/articles/PMC12311202/
- Severity weighting (ScienceDirect): https://www.sciencedirect.com/science/article/abs/pii/S2214212624002588
- Endpoint weighting (arXiv PDF): https://arxiv.org/pdf/2401.15878.pdf
- Cloud prioritization (Qualys): https://docs.qualys.com/en/vmdr/latest/mitre_attack/mitre_attack_matrix_in_prioritization.htm
- Platform-first workflow (Anvilogic): https://www.anvilogic.com/learn/detection-engineering-with-mitre-attack
- Cyber Kill Chain definitions (Lockheed PDF): https://www.lockheedmartin.com/content/dam/lockheed-martin/rms/documents/cyber/Gaining_the_Advantage_Cyber_Kill_Chain.pdf

## Rule to Source Mapping

| Rule | Primary Sources |
|---|---|
| Platform filter | ATT&CK STIX platforms |
| Data Component matching semantics | ATT&CK Data Sources repo |
| Tactic and technique naming | ATT&CK reference pages |
| Heatmap export compatibility | ATT&CK Navigator |
| Log fidelity defaults | ASD Event Logging Best Practices |
| AU preset defaults | ASD Essential Eight Blueprint + mapping article |
| Edge profile defaults | ASD edge mitigation guidance |
| Gov control gap boost table | NSA/CISA ATT&CK defenses |
| Real-world prevalence tie-break | CISA RVA summary |
| Prioritization tiers | SpecterOps |
| Visibility weighting | DeTT&CT + Kaspersky |
| Annual prevalence calibration | Red Canary |
| Kill chain phase weighting | KillChainGraph + Lockheed PDF |
| Multi-criteria normalization | Nature + PMC |
| Severity fallback multiplier | ScienceDirect |
| Endpoint preset | arXiv endpoint paper |
| Cloud preset | Qualys VMDR ATT&CK guide |
| UX flow order | Anvilogic platform-first guidance |

## Notes

- Picus RVA duplicate source removed.
- SentinelOne and Varonis kill-chain explainers are not primary sources.
- External sources guide constants/defaults; runtime filtering relies on in-app ATT&CK + mapping data.
