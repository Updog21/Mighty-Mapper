export interface MitreTechnique {
  id: string;
  name: string;
  tactic: string;
  description: string;
  usedByThreatGroups: string[];
  coveredByProducts: string[];
}

export interface ThreatGroup {
  id: string;
  name: string;
  aliases: string[];
  description: string;
  techniques: string[];
}

export interface SecurityProduct {
  id: string;
  name: string;
  vendor: string;
  category: string;
  techniques: string[];
}

export const tactics = [
  { id: 'TA0043', name: 'Reconnaissance', shortName: 'Recon' },
  { id: 'TA0042', name: 'Resource Development', shortName: 'Resource' },
  { id: 'TA0001', name: 'Initial Access', shortName: 'Initial' },
  { id: 'TA0002', name: 'Execution', shortName: 'Exec' },
  { id: 'TA0003', name: 'Persistence', shortName: 'Persist' },
  { id: 'TA0004', name: 'Privilege Escalation', shortName: 'PrivEsc' },
  { id: 'TA0005', name: 'Defense Evasion', shortName: 'Evasion' },
  { id: 'TA0006', name: 'Credential Access', shortName: 'Creds' },
  { id: 'TA0007', name: 'Discovery', shortName: 'Discover' },
  { id: 'TA0008', name: 'Lateral Movement', shortName: 'Lateral' },
  { id: 'TA0009', name: 'Collection', shortName: 'Collect' },
  { id: 'TA0011', name: 'Command and Control', shortName: 'C2' },
  { id: 'TA0010', name: 'Exfiltration', shortName: 'Exfil' },
  { id: 'TA0040', name: 'Impact', shortName: 'Impact' },
];

export const techniques: MitreTechnique[] = [
  { id: 'T1595', name: 'Active Scanning', tactic: 'Reconnaissance', description: 'Adversaries may execute active reconnaissance scans.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1592', name: 'Gather Victim Host Information', tactic: 'Reconnaissance', description: 'Adversaries may gather information about the victim host.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  { id: 'T1589', name: 'Gather Victim Identity Information', tactic: 'Reconnaissance', description: 'Adversaries may gather victim identity information.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['Splunk'] },
  { id: 'T1590', name: 'Gather Victim Network Information', tactic: 'Reconnaissance', description: 'Adversaries may gather network information.', usedByThreatGroups: ['APT28'], coveredByProducts: [] },
  
  { id: 'T1583', name: 'Acquire Infrastructure', tactic: 'Resource Development', description: 'Adversaries may buy or lease infrastructure.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: [] },
  { id: 'T1586', name: 'Compromise Accounts', tactic: 'Resource Development', description: 'Adversaries may compromise accounts.', usedByThreatGroups: ['APT29'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1584', name: 'Compromise Infrastructure', tactic: 'Resource Development', description: 'Adversaries may compromise infrastructure.', usedByThreatGroups: ['Lazarus'], coveredByProducts: [] },
  
  { id: 'T1566', name: 'Phishing', tactic: 'Initial Access', description: 'Adversaries may send phishing messages.', usedByThreatGroups: ['APT29', 'APT28', 'Lazarus'], coveredByProducts: ['CrowdStrike', 'Proofpoint'] },
  { id: 'T1190', name: 'Exploit Public-Facing Application', tactic: 'Initial Access', description: 'Adversaries may exploit vulnerabilities in internet-facing systems.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1133', name: 'External Remote Services', tactic: 'Initial Access', description: 'Adversaries may leverage external remote services.', usedByThreatGroups: ['APT28'], coveredByProducts: [] },
  { id: 'T1078', name: 'Valid Accounts', tactic: 'Initial Access', description: 'Adversaries may use valid accounts.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['CrowdStrike', 'Splunk'] },
  { id: 'T1199', name: 'Trusted Relationship', tactic: 'Initial Access', description: 'Adversaries may breach organizations via trusted third parties.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  
  { id: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', description: 'Adversaries may abuse command interpreters.', usedByThreatGroups: ['APT29', 'APT28', 'Lazarus'], coveredByProducts: ['CrowdStrike', 'Carbon Black'] },
  { id: 'T1053', name: 'Scheduled Task/Job', tactic: 'Execution', description: 'Adversaries may abuse task scheduling.', usedByThreatGroups: ['APT29'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1047', name: 'Windows Management Instrumentation', tactic: 'Execution', description: 'Adversaries may use WMI to execute commands.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['Carbon Black'] },
  { id: 'T1204', name: 'User Execution', tactic: 'Execution', description: 'Adversaries may rely on user execution.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['Proofpoint'] },
  
  { id: 'T1098', name: 'Account Manipulation', tactic: 'Persistence', description: 'Adversaries may manipulate accounts.', usedByThreatGroups: ['APT29'], coveredByProducts: ['CrowdStrike', 'Splunk'] },
  { id: 'T1547', name: 'Boot or Logon Autostart Execution', tactic: 'Persistence', description: 'Adversaries may configure autostart execution.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1136', name: 'Create Account', tactic: 'Persistence', description: 'Adversaries may create accounts.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  { id: 'T1543', name: 'Create or Modify System Process', tactic: 'Persistence', description: 'Adversaries may create or modify system processes.', usedByThreatGroups: ['Lazarus'], coveredByProducts: ['Carbon Black'] },
  
  { id: 'T1548', name: 'Abuse Elevation Control Mechanism', tactic: 'Privilege Escalation', description: 'Adversaries may abuse elevation control.', usedByThreatGroups: ['APT29'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1134', name: 'Access Token Manipulation', tactic: 'Privilege Escalation', description: 'Adversaries may manipulate access tokens.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: [] },
  { id: 'T1068', name: 'Exploitation for Privilege Escalation', tactic: 'Privilege Escalation', description: 'Adversaries may exploit vulnerabilities.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['CrowdStrike'] },
  
  { id: 'T1140', name: 'Deobfuscate/Decode Files or Information', tactic: 'Defense Evasion', description: 'Adversaries may deobfuscate files.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['Carbon Black'] },
  { id: 'T1070', name: 'Indicator Removal', tactic: 'Defense Evasion', description: 'Adversaries may delete or modify artifacts.', usedByThreatGroups: ['APT29'], coveredByProducts: ['Splunk'] },
  { id: 'T1036', name: 'Masquerading', tactic: 'Defense Evasion', description: 'Adversaries may masquerade elements.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1027', name: 'Obfuscated Files or Information', tactic: 'Defense Evasion', description: 'Adversaries may obfuscate content.', usedByThreatGroups: ['APT29', 'APT28', 'Lazarus'], coveredByProducts: [] },
  { id: 'T1055', name: 'Process Injection', tactic: 'Defense Evasion', description: 'Adversaries may inject code into processes.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['CrowdStrike', 'Carbon Black'] },
  
  { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', description: 'Adversaries may use brute force.', usedByThreatGroups: ['APT28'], coveredByProducts: ['Splunk'] },
  { id: 'T1555', name: 'Credentials from Password Stores', tactic: 'Credential Access', description: 'Adversaries may search password stores.', usedByThreatGroups: ['APT29'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1003', name: 'OS Credential Dumping', tactic: 'Credential Access', description: 'Adversaries may dump credentials.', usedByThreatGroups: ['APT29', 'APT28', 'Lazarus'], coveredByProducts: ['CrowdStrike', 'Carbon Black'] },
  { id: 'T1558', name: 'Steal or Forge Kerberos Tickets', tactic: 'Credential Access', description: 'Adversaries may forge Kerberos tickets.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  
  { id: 'T1087', name: 'Account Discovery', tactic: 'Discovery', description: 'Adversaries may discover accounts.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['Splunk'] },
  { id: 'T1083', name: 'File and Directory Discovery', tactic: 'Discovery', description: 'Adversaries may enumerate files.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: [] },
  { id: 'T1057', name: 'Process Discovery', tactic: 'Discovery', description: 'Adversaries may discover running processes.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['Carbon Black'] },
  { id: 'T1018', name: 'Remote System Discovery', tactic: 'Discovery', description: 'Adversaries may discover remote systems.', usedByThreatGroups: ['APT29'], coveredByProducts: ['Splunk'] },
  
  { id: 'T1021', name: 'Remote Services', tactic: 'Lateral Movement', description: 'Adversaries may use remote services.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1080', name: 'Taint Shared Content', tactic: 'Lateral Movement', description: 'Adversaries may taint shared content.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  { id: 'T1550', name: 'Use Alternate Authentication Material', tactic: 'Lateral Movement', description: 'Adversaries may use alternate credentials.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['CrowdStrike'] },
  
  { id: 'T1560', name: 'Archive Collected Data', tactic: 'Collection', description: 'Adversaries may archive data.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: [] },
  { id: 'T1005', name: 'Data from Local System', tactic: 'Collection', description: 'Adversaries may search local sources.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1114', name: 'Email Collection', tactic: 'Collection', description: 'Adversaries may collect emails.', usedByThreatGroups: ['APT29'], coveredByProducts: ['Proofpoint'] },
  
  { id: 'T1071', name: 'Application Layer Protocol', tactic: 'Command and Control', description: 'Adversaries may use app layer protocols.', usedByThreatGroups: ['APT29', 'APT28', 'Lazarus'], coveredByProducts: ['Splunk'] },
  { id: 'T1132', name: 'Data Encoding', tactic: 'Command and Control', description: 'Adversaries may encode data.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  { id: 'T1573', name: 'Encrypted Channel', tactic: 'Command and Control', description: 'Adversaries may encrypt C2 traffic.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: [] },
  { id: 'T1105', name: 'Ingress Tool Transfer', tactic: 'Command and Control', description: 'Adversaries may transfer tools.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: ['CrowdStrike'] },
  
  { id: 'T1041', name: 'Exfiltration Over C2 Channel', tactic: 'Exfiltration', description: 'Adversaries may exfiltrate via C2.', usedByThreatGroups: ['APT29', 'Lazarus'], coveredByProducts: ['Splunk'] },
  { id: 'T1048', name: 'Exfiltration Over Alternative Protocol', tactic: 'Exfiltration', description: 'Adversaries may exfiltrate via alt protocols.', usedByThreatGroups: ['APT29'], coveredByProducts: [] },
  { id: 'T1567', name: 'Exfiltration Over Web Service', tactic: 'Exfiltration', description: 'Adversaries may exfiltrate via web services.', usedByThreatGroups: ['APT29', 'APT28'], coveredByProducts: [] },
  
  { id: 'T1485', name: 'Data Destruction', tactic: 'Impact', description: 'Adversaries may destroy data.', usedByThreatGroups: ['Lazarus'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1486', name: 'Data Encrypted for Impact', tactic: 'Impact', description: 'Adversaries may encrypt data.', usedByThreatGroups: ['Lazarus'], coveredByProducts: ['CrowdStrike'] },
  { id: 'T1489', name: 'Service Stop', tactic: 'Impact', description: 'Adversaries may stop services.', usedByThreatGroups: ['Lazarus'], coveredByProducts: ['Carbon Black'] },
];

export const threatGroups: ThreatGroup[] = [
  {
    id: 'G0016',
    name: 'APT29',
    aliases: ['Cozy Bear', 'The Dukes', 'YTTRIUM', 'Iron Hemlock'],
    description: 'APT29 is a threat group attributed to Russia\'s Foreign Intelligence Service (SVR). They have operated since at least 2008.',
    techniques: techniques.filter(t => t.usedByThreatGroups.includes('APT29')).map(t => t.id),
  },
  {
    id: 'G0007',
    name: 'APT28',
    aliases: ['Fancy Bear', 'Sofacy', 'Sednit', 'STRONTIUM'],
    description: 'APT28 is a threat group attributed to Russia\'s Main Intelligence Directorate (GRU). Active since at least 2004.',
    techniques: techniques.filter(t => t.usedByThreatGroups.includes('APT28')).map(t => t.id),
  },
  {
    id: 'G0032',
    name: 'Lazarus',
    aliases: ['Hidden Cobra', 'Guardians of Peace', 'ZINC'],
    description: 'Lazarus Group is a threat group attributed to North Korea. Active since at least 2009.',
    techniques: techniques.filter(t => t.usedByThreatGroups.includes('Lazarus')).map(t => t.id),
  },
];

export const securityProducts: SecurityProduct[] = [
  {
    id: 'P001',
    name: 'CrowdStrike Falcon',
    vendor: 'CrowdStrike',
    category: 'EDR',
    techniques: techniques.filter(t => t.coveredByProducts.includes('CrowdStrike')).map(t => t.id),
  },
  {
    id: 'P002',
    name: 'Splunk Enterprise Security',
    vendor: 'Splunk',
    category: 'SIEM',
    techniques: techniques.filter(t => t.coveredByProducts.includes('Splunk')).map(t => t.id),
  },
  {
    id: 'P003',
    name: 'Carbon Black',
    vendor: 'VMware',
    category: 'EDR',
    techniques: techniques.filter(t => t.coveredByProducts.includes('Carbon Black')).map(t => t.id),
  },
  {
    id: 'P004',
    name: 'Proofpoint Email Protection',
    vendor: 'Proofpoint',
    category: 'Email Security',
    techniques: techniques.filter(t => t.coveredByProducts.includes('Proofpoint')).map(t => t.id),
  },
];

export function getTechniquesByTactic(tacticName: string): MitreTechnique[] {
  return techniques.filter(t => t.tactic === tacticName);
}

export function getCoverageStats(selectedProducts: string[], selectedThreatGroup: string | null) {
  const coveredTechniques = new Set<string>();
  const threatTechniques = new Set<string>();
  
  selectedProducts.forEach(productId => {
    const product = securityProducts.find(p => p.id === productId);
    if (product) {
      product.techniques.forEach(t => coveredTechniques.add(t));
    }
  });
  
  if (selectedThreatGroup) {
    const group = threatGroups.find(g => g.id === selectedThreatGroup);
    if (group) {
      group.techniques.forEach(t => threatTechniques.add(t));
    }
  }
  
  const gaps = Array.from(threatTechniques).filter(t => !coveredTechniques.has(t));
  const covered = Array.from(threatTechniques).filter(t => coveredTechniques.has(t));
  
  return {
    totalTechniques: techniques.length,
    coveredCount: coveredTechniques.size,
    threatCount: threatTechniques.size,
    gapCount: gaps.length,
    coveredThreatCount: covered.length,
    coveragePercent: threatTechniques.size > 0 
      ? Math.round((covered.length / threatTechniques.size) * 100) 
      : 0,
  };
}
