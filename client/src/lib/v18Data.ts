export interface Asset {
  id: string;
  vendor: string;
  productName: string;
  deployment?: string;
  description: string;
  dataComponents: string[];
  source: 'ctid' | 'custom' | 'ai-pending';
}

export interface LogRequirement {
  channel: string;
  eventCodes: string[];
  requiredFields: string[];
  description: string;
}

export interface DataComponent {
  id: string;
  name: string;
  description: string;
  dataSource: string;
  logRequirements?: LogRequirement[];
}

export interface Analytic {
  id: string;
  name: string;
  description: string;
  requiredDataComponents: string[];
  detectsTechniques: string[];
  source: string;
  detectionStrategyId?: string;
  logRequirements?: LogRequirement[];
  pseudocode?: string;
}

export interface Technique {
  id: string;
  name: string;
  tactic: string;
  description: string;
  usedByGroups: string[];
}

export interface ProductMapping {
  asset: Asset;
  dataComponents: DataComponent[];
  analytics: Analytic[];
  techniques: Technique[];
  valueScore: number;
  gapsFilled: string[];
}

export interface MappingReview {
  techniqueId: string;
  status: 'approved' | 'rejected' | 'pending';
  confidence: number;
  feedback?: string;
}

export const dataComponents: DataComponent[] = [
  { 
    id: 'DC001', 
    name: 'User Account Authentication', 
    description: 'Logs of user authentication attempts including success/failure', 
    dataSource: 'Authentication Logs',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4624', '4625', '4648'],
        requiredFields: ['TargetUserName', 'TargetDomainName', 'LogonType', 'IpAddress', 'WorkstationName'],
        description: 'Windows Security log for logon events'
      }
    ]
  },
  { 
    id: 'DC002', 
    name: 'User Account Creation', 
    description: 'Logs of new user account creation events', 
    dataSource: 'Directory Services',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4720', '4722', '4738'],
        requiredFields: ['TargetUserName', 'SubjectUserName', 'SubjectDomainName', 'PrivilegeList'],
        description: 'Windows Security log for account management'
      }
    ]
  },
  { 
    id: 'DC003', 
    name: 'User Account Modification', 
    description: 'Logs of user account attribute changes', 
    dataSource: 'Directory Services',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4738', '4742', '4781'],
        requiredFields: ['TargetUserName', 'SubjectUserName', 'UserAccountControl', 'SamAccountName'],
        description: 'Windows Security log for account modifications'
      }
    ]
  },
  { 
    id: 'DC004', 
    name: 'Logon Session Creation', 
    description: 'Logs of new logon sessions being established', 
    dataSource: 'Authentication Logs',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4624', '4648', '4672'],
        requiredFields: ['TargetUserName', 'LogonType', 'LogonProcessName', 'AuthenticationPackageName', 'TargetLogonId'],
        description: 'Windows Security log for session creation'
      }
    ]
  },
  { id: 'DC005', name: 'Network Traffic Flow', description: 'Network connection metadata including source/dest IPs', dataSource: 'Network Logs' },
  { id: 'DC006', name: 'Network Connection Creation', description: 'New network connection establishment events', dataSource: 'Network Logs' },
  { 
    id: 'DC007', 
    name: 'Process Creation', 
    description: 'Process execution events including command line arguments', 
    dataSource: 'System Logs',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4688'],
        requiredFields: ['NewProcessName', 'CommandLine', 'ParentProcessName', 'SubjectUserName', 'TokenElevationType'],
        description: 'Windows Security log with command line auditing enabled'
      },
      {
        channel: 'Microsoft-Windows-Sysmon/Operational',
        eventCodes: ['1'],
        requiredFields: ['Image', 'CommandLine', 'ParentImage', 'ParentCommandLine', 'User', 'Hashes', 'OriginalFileName'],
        description: 'Sysmon process creation events'
      }
    ]
  },
  { 
    id: 'DC008', 
    name: 'Script Execution', 
    description: 'PowerShell and script interpreter execution logs', 
    dataSource: 'Script Logs',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-PowerShell/Operational',
        eventCodes: ['4103', '4104'],
        requiredFields: ['ScriptBlockText', 'ScriptBlockId', 'Path', 'MessageNumber', 'MessageTotal'],
        description: 'PowerShell script block logging'
      },
      {
        channel: 'Windows PowerShell',
        eventCodes: ['400', '403', '600', '800'],
        requiredFields: ['HostName', 'HostApplication', 'EngineVersion', 'CommandLine'],
        description: 'PowerShell engine state and pipeline execution'
      }
    ]
  },
  { id: 'DC009', name: 'Cloud Service Access', description: 'Access events to cloud resources and services', dataSource: 'Cloud Audit Logs' },
  { id: 'DC010', name: 'Wireless Network Connection', description: 'WiFi association and connection events', dataSource: 'Wireless Logs' },
  { id: 'DC011', name: 'Device Registration', description: 'Device enrollment and registration events', dataSource: 'Device Management' },
  { 
    id: 'DC012', 
    name: 'Conditional Access Evaluation', 
    description: 'Policy evaluation for access decisions', 
    dataSource: 'Identity Provider',
    logRequirements: [
      {
        channel: 'Azure AD Sign-in Logs',
        eventCodes: ['Sign-in activity'],
        requiredFields: ['conditionalAccessStatus', 'appliedConditionalAccessPolicies', 'deviceDetail', 'location', 'riskState'],
        description: 'Azure AD conditional access evaluation logs'
      }
    ]
  },
  { 
    id: 'DC013', 
    name: 'Token Issuance', 
    description: 'OAuth/SAML token generation events', 
    dataSource: 'Identity Provider',
    logRequirements: [
      {
        channel: 'Azure AD Sign-in Logs',
        eventCodes: ['Token issuance'],
        requiredFields: ['tokenIssuerType', 'resourceDisplayName', 'appDisplayName', 'clientAppUsed', 'authenticationDetails'],
        description: 'Azure AD token issuance audit logs'
      }
    ]
  },
  { 
    id: 'DC014', 
    name: 'Group Membership Change', 
    description: 'Changes to group membership', 
    dataSource: 'Directory Services',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4728', '4729', '4732', '4733', '4756', '4757'],
        requiredFields: ['TargetUserName', 'MemberName', 'MemberSid', 'SubjectUserName', 'TargetSid'],
        description: 'Windows Security log for group membership changes'
      }
    ]
  },
  { id: 'DC015', name: 'Rogue AP Detection', description: 'Detection of unauthorized wireless access points', dataSource: 'Wireless IDS' },
  { id: 'DC016', name: 'Client Isolation Events', description: 'Wireless client isolation and containment events', dataSource: 'Wireless Security' },
  {
    id: 'DC017',
    name: 'File Creation',
    description: 'File system creation events',
    dataSource: 'System Logs',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-Sysmon/Operational',
        eventCodes: ['11'],
        requiredFields: ['TargetFilename', 'CreationUtcTime', 'Image', 'User'],
        description: 'Sysmon file creation events'
      }
    ]
  },
  {
    id: 'DC018',
    name: 'Registry Modification',
    description: 'Windows Registry key and value changes',
    dataSource: 'System Logs',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-Sysmon/Operational',
        eventCodes: ['12', '13', '14'],
        requiredFields: ['EventType', 'TargetObject', 'Details', 'Image', 'User'],
        description: 'Sysmon registry events'
      },
      {
        channel: 'Security',
        eventCodes: ['4657'],
        requiredFields: ['ObjectName', 'ObjectValueName', 'OldValue', 'NewValue', 'SubjectUserName'],
        description: 'Windows Security registry auditing'
      }
    ]
  },
  {
    id: 'DC019',
    name: 'Scheduled Task Creation',
    description: 'Scheduled task creation and modification events',
    dataSource: 'System Logs',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-TaskScheduler/Operational',
        eventCodes: ['106', '140', '141', '200'],
        requiredFields: ['TaskName', 'UserContext', 'ActionName'],
        description: 'Task Scheduler operational log'
      },
      {
        channel: 'Security',
        eventCodes: ['4698', '4699', '4700', '4701', '4702'],
        requiredFields: ['TaskName', 'TaskContent', 'SubjectUserName', 'SubjectDomainName'],
        description: 'Windows Security scheduled task auditing'
      }
    ]
  },
  {
    id: 'DC020',
    name: 'WMI Activity',
    description: 'Windows Management Instrumentation events',
    dataSource: 'System Logs',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-WMI-Activity/Operational',
        eventCodes: ['5857', '5858', '5859', '5860', '5861'],
        requiredFields: ['Namespace', 'Query', 'User', 'ClientMachine', 'Operation'],
        description: 'WMI activity operational log'
      }
    ]
  }
];

export const analytics: Analytic[] = [
  { 
    id: 'CAR-2021-01-001', 
    name: 'Successful Login from Multiple Geolocations', 
    description: 'Detects when a user logs in from geographically distant locations in a short time', 
    requiredDataComponents: ['DC001', 'DC004'], 
    detectsTechniques: ['T1078'], 
    source: 'MITRE CAR'
  },
  { 
    id: 'CAR-2021-01-002', 
    name: 'Impossible Travel Detection', 
    description: 'Identifies authentication from locations impossible to travel between', 
    requiredDataComponents: ['DC001', 'DC004', 'DC012'], 
    detectsTechniques: ['T1078', 'T1550'], 
    source: 'MITRE CAR'
  },
  { 
    id: 'CAR-2021-02-001', 
    name: 'Suspicious Account Creation', 
    description: 'Detects creation of accounts with admin privileges', 
    requiredDataComponents: ['DC002', 'DC014'], 
    detectsTechniques: ['T1136'], 
    source: 'MITRE CAR' 
  },
  { 
    id: 'CAR-2021-02-002', 
    name: 'Privilege Escalation via Group Change', 
    description: 'Detects addition of users to privileged groups', 
    requiredDataComponents: ['DC003', 'DC014'], 
    detectsTechniques: ['T1078', 'T1098'], 
    source: 'MITRE CAR' 
  },
  { 
    id: 'CAR-2021-03-001', 
    name: 'Suspicious Token Usage', 
    description: 'Detects OAuth token abuse patterns', 
    requiredDataComponents: ['DC013', 'DC009'], 
    detectsTechniques: ['T1550', 'T1528'], 
    source: 'MITRE CAR' 
  },
  { 
    id: 'CAR-2021-04-001', 
    name: 'External Remote Service Access', 
    description: 'Detects access via external remote services', 
    requiredDataComponents: ['DC005', 'DC006', 'DC004'], 
    detectsTechniques: ['T1133'], 
    source: 'MITRE CAR' 
  },
  { 
    id: 'SIGMA-NET-001', 
    name: 'Rogue Access Point Detection', 
    description: 'Identifies unauthorized wireless access points', 
    requiredDataComponents: ['DC015', 'DC010'], 
    detectsTechniques: ['T1557', 'T1200'], 
    source: 'Sigma' 
  },
  { 
    id: 'SIGMA-NET-002', 
    name: 'Anomalous Wireless Client Behavior', 
    description: 'Detects unusual wireless client connection patterns', 
    requiredDataComponents: ['DC010', 'DC016'], 
    detectsTechniques: ['T1557', 'T1040'], 
    source: 'Sigma' 
  },
  { 
    id: 'CAR-2021-05-001', 
    name: 'MFA Fatigue Attack', 
    description: 'Detects repeated MFA push notifications indicative of fatigue attack', 
    requiredDataComponents: ['DC001', 'DC012'], 
    detectsTechniques: ['T1621'], 
    source: 'MITRE CAR' 
  },
  { 
    id: 'CAR-2021-05-002', 
    name: 'Conditional Access Bypass Attempt', 
    description: 'Detects attempts to bypass conditional access policies', 
    requiredDataComponents: ['DC012', 'DC004'], 
    detectsTechniques: ['T1556'], 
    source: 'MITRE CAR' 
  },
  {
    id: 'DET0455',
    name: 'Abuse of PowerShell for Arbitrary Execution',
    description: 'Detects suspicious PowerShell execution patterns including encoded commands, bypassing execution policy, and downloading content from the internet.',
    requiredDataComponents: ['DC007', 'DC008'],
    detectsTechniques: ['T1059.001'],
    source: 'MITRE Detection Strategies',
    detectionStrategyId: 'DET0455',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4688'],
        requiredFields: ['NewProcessName', 'CommandLine', 'ParentProcessName', 'SubjectUserName', 'TokenElevationType'],
        description: 'Process creation with command line - must have "Audit Process Creation" and "Include command line" enabled'
      },
      {
        channel: 'Microsoft-Windows-PowerShell/Operational',
        eventCodes: ['4103', '4104'],
        requiredFields: ['ScriptBlockText', 'ScriptBlockId', 'Path'],
        description: 'PowerShell script block logging - requires Module and Script Block Logging GPO'
      },
      {
        channel: 'Microsoft-Windows-Sysmon/Operational',
        eventCodes: ['1'],
        requiredFields: ['Image', 'CommandLine', 'ParentImage', 'ParentCommandLine', 'Hashes', 'OriginalFileName'],
        description: 'Sysmon process creation - recommended for enhanced visibility'
      }
    ],
    pseudocode: `SELECT * FROM process_creation
WHERE (
  process_name LIKE '%powershell%' OR 
  process_name LIKE '%pwsh%'
) AND (
  command_line LIKE '%-enc%' OR
  command_line LIKE '%-EncodedCommand%' OR
  command_line LIKE '%-ep bypass%' OR
  command_line LIKE '%-ExecutionPolicy Bypass%' OR
  command_line LIKE '%DownloadString%' OR
  command_line LIKE '%IEX%' OR
  command_line LIKE '%Invoke-Expression%' OR
  command_line LIKE '%-nop%' OR
  command_line LIKE '%-NoProfile%' OR
  command_line LIKE '%-w hidden%' OR
  command_line LIKE '%-WindowStyle Hidden%'
)`
  },
  {
    id: 'DET0500',
    name: 'Suspicious Scheduled Task Creation',
    description: 'Detects creation of scheduled tasks that may be used for persistence or privilege escalation.',
    requiredDataComponents: ['DC007', 'DC019'],
    detectsTechniques: ['T1053.005'],
    source: 'MITRE Detection Strategies',
    detectionStrategyId: 'DET0500',
    logRequirements: [
      {
        channel: 'Security',
        eventCodes: ['4698'],
        requiredFields: ['TaskName', 'TaskContent', 'SubjectUserName', 'SubjectDomainName'],
        description: 'Scheduled task creation auditing - requires "Audit Other Object Access Events"'
      },
      {
        channel: 'Microsoft-Windows-TaskScheduler/Operational',
        eventCodes: ['106'],
        requiredFields: ['TaskName', 'UserContext'],
        description: 'Task Scheduler operational log'
      }
    ],
    pseudocode: `SELECT * FROM scheduled_task_creation
WHERE (
  task_content LIKE '%cmd.exe%' OR
  task_content LIKE '%powershell%' OR
  task_content LIKE '%mshta%' OR
  task_content LIKE '%wscript%' OR
  task_content LIKE '%cscript%' OR
  task_content LIKE '%rundll32%' OR
  task_content LIKE '%regsvr32%'
) AND (
  task_path LIKE '%\\AppData\\%' OR
  task_path LIKE '%\\Temp\\%' OR
  task_path LIKE '%\\ProgramData\\%'
)`
  },
  {
    id: 'DET0512',
    name: 'WMI Event Subscription Persistence',
    description: 'Detects WMI event subscriptions used for persistence.',
    requiredDataComponents: ['DC020'],
    detectsTechniques: ['T1546.003'],
    source: 'MITRE Detection Strategies',
    detectionStrategyId: 'DET0512',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-WMI-Activity/Operational',
        eventCodes: ['5857', '5858', '5859', '5860', '5861'],
        requiredFields: ['Namespace', 'Query', 'User', 'Operation'],
        description: 'WMI activity operational logging'
      },
      {
        channel: 'Microsoft-Windows-Sysmon/Operational',
        eventCodes: ['19', '20', '21'],
        requiredFields: ['EventType', 'Operation', 'User', 'EventNamespace', 'Name', 'Query', 'Destination'],
        description: 'Sysmon WMI event subscription monitoring'
      }
    ],
    pseudocode: `SELECT * FROM wmi_events
WHERE (
  event_id IN (5857, 5858, 5859, 5860, 5861) OR
  (source = 'Sysmon' AND event_id IN (19, 20, 21))
) AND (
  query LIKE '%CommandLineEventConsumer%' OR
  query LIKE '%ActiveScriptEventConsumer%' OR
  destination LIKE '%cmd.exe%' OR
  destination LIKE '%powershell%'
)`
  },
  {
    id: 'DET0478',
    name: 'Registry Run Key Modification',
    description: 'Detects modifications to registry Run keys commonly used for persistence.',
    requiredDataComponents: ['DC018'],
    detectsTechniques: ['T1547.001'],
    source: 'MITRE Detection Strategies',
    detectionStrategyId: 'DET0478',
    logRequirements: [
      {
        channel: 'Microsoft-Windows-Sysmon/Operational',
        eventCodes: ['12', '13', '14'],
        requiredFields: ['EventType', 'TargetObject', 'Details', 'Image', 'User'],
        description: 'Sysmon registry monitoring'
      },
      {
        channel: 'Security',
        eventCodes: ['4657'],
        requiredFields: ['ObjectName', 'ObjectValueName', 'NewValue', 'SubjectUserName', 'ProcessName'],
        description: 'Windows Security registry auditing - requires SACL on registry keys'
      }
    ],
    pseudocode: `SELECT * FROM registry_events
WHERE (
  target_object LIKE '%\\CurrentVersion\\Run%' OR
  target_object LIKE '%\\CurrentVersion\\RunOnce%' OR
  target_object LIKE '%\\CurrentVersion\\RunServices%' OR
  target_object LIKE '%\\CurrentVersion\\Policies\\Explorer\\Run%'
) AND (
  details LIKE '%cmd%' OR
  details LIKE '%powershell%' OR
  details LIKE '%wscript%' OR
  details LIKE '%mshta%' OR
  details LIKE '%.exe%'
)`
  }
];

export const techniques: Technique[] = [
  { id: 'T1078', name: 'Valid Accounts', tactic: 'Defense Evasion, Persistence, Privilege Escalation, Initial Access', description: 'Adversaries may obtain and abuse credentials of existing accounts', usedByGroups: ['APT29', 'APT28', 'Lazarus'] },
  { id: 'T1550', name: 'Use Alternate Authentication Material', tactic: 'Defense Evasion, Lateral Movement', description: 'Adversaries may use alternate authentication material such as tokens', usedByGroups: ['APT29', 'APT28'] },
  { id: 'T1136', name: 'Create Account', tactic: 'Persistence', description: 'Adversaries may create accounts to maintain access', usedByGroups: ['APT29', 'Lazarus'] },
  { id: 'T1098', name: 'Account Manipulation', tactic: 'Persistence', description: 'Adversaries may manipulate accounts to maintain access', usedByGroups: ['APT29', 'APT28'] },
  { id: 'T1528', name: 'Steal Application Access Token', tactic: 'Credential Access', description: 'Adversaries can steal application access tokens', usedByGroups: ['APT29'] },
  { id: 'T1133', name: 'External Remote Services', tactic: 'Persistence, Initial Access', description: 'Adversaries may leverage external-facing remote services', usedByGroups: ['APT28', 'Lazarus'] },
  { id: 'T1557', name: 'Adversary-in-the-Middle', tactic: 'Credential Access, Collection', description: 'Adversaries may attempt to position themselves between endpoints', usedByGroups: ['APT28'] },
  { id: 'T1200', name: 'Hardware Additions', tactic: 'Initial Access', description: 'Adversaries may introduce hardware devices to gain access', usedByGroups: ['APT28'] },
  { id: 'T1040', name: 'Network Sniffing', tactic: 'Credential Access, Discovery', description: 'Adversaries may sniff network traffic to capture credentials', usedByGroups: ['APT28', 'APT29'] },
  { id: 'T1621', name: 'Multi-Factor Authentication Request Generation', tactic: 'Credential Access', description: 'Adversaries may generate MFA requests to gain access (MFA fatigue)', usedByGroups: ['APT29', 'Lazarus'] },
  { id: 'T1556', name: 'Modify Authentication Process', tactic: 'Credential Access, Defense Evasion, Persistence', description: 'Adversaries may modify authentication mechanisms', usedByGroups: ['APT29'] },
  { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution', description: 'Adversaries may abuse PowerShell commands and scripts for execution', usedByGroups: ['APT29', 'APT28', 'Lazarus'] },
  { id: 'T1053.005', name: 'Scheduled Task', tactic: 'Execution, Persistence, Privilege Escalation', description: 'Adversaries may abuse scheduled tasks for persistence and execution', usedByGroups: ['APT29', 'APT28', 'Lazarus'] },
  { id: 'T1546.003', name: 'WMI Event Subscription', tactic: 'Persistence, Privilege Escalation', description: 'Adversaries may establish persistence using WMI event subscriptions', usedByGroups: ['APT29', 'APT28'] },
  { id: 'T1547.001', name: 'Registry Run Keys / Startup Folder', tactic: 'Persistence, Privilege Escalation', description: 'Adversaries may achieve persistence by adding Run keys to the Registry', usedByGroups: ['APT29', 'APT28', 'Lazarus'] },
];

export const ctidMappedProducts: Asset[] = [
  {
    id: 'CTID-AZURE-ENTRA',
    vendor: 'Microsoft',
    productName: 'Azure Entra ID',
    deployment: 'Cloud',
    description: 'Cloud-based identity and access management service. Provides authentication, conditional access, and identity protection.',
    dataComponents: ['DC001', 'DC002', 'DC003', 'DC004', 'DC009', 'DC012', 'DC013', 'DC014'],
    source: 'ctid',
  },
  {
    id: 'CTID-MERAKI-MR',
    vendor: 'Cisco',
    productName: 'Meraki MR (Wireless)',
    deployment: 'Cloud-managed',
    description: 'Cloud-managed wireless access points with integrated security features.',
    dataComponents: ['DC005', 'DC006', 'DC010', 'DC015'],
    source: 'ctid',
  },
  {
    id: 'CTID-AIRMARSHAL',
    vendor: 'Cisco',
    productName: 'Meraki Air Marshal',
    deployment: 'Cloud-managed',
    description: 'Wireless intrusion detection and prevention system (WIDS/WIPS) integrated into Meraki infrastructure.',
    dataComponents: ['DC010', 'DC015', 'DC016'],
    source: 'ctid',
  },
  {
    id: 'CTID-WINDOWS',
    vendor: 'Microsoft',
    productName: 'Windows Event Logging',
    deployment: 'On-premises / Hybrid',
    description: 'Native Windows security event logging including Security, PowerShell, Sysmon, and application logs. Foundation for endpoint detection.',
    dataComponents: ['DC001', 'DC002', 'DC003', 'DC004', 'DC007', 'DC008', 'DC014', 'DC017', 'DC018', 'DC019', 'DC020'],
    source: 'ctid',
  },
  {
    id: 'CTID-SYSMON',
    vendor: 'Microsoft',
    productName: 'Sysmon (System Monitor)',
    deployment: 'On-premises',
    description: 'Windows system service that logs detailed system activity including process creation, network connections, and file changes.',
    dataComponents: ['DC007', 'DC017', 'DC018', 'DC020'],
    source: 'ctid',
  },
];

export function searchProducts(query: string): Asset[] {
  const lowerQuery = query.toLowerCase();
  return ctidMappedProducts.filter(p => 
    p.vendor.toLowerCase().includes(lowerQuery) ||
    p.productName.toLowerCase().includes(lowerQuery) ||
    p.description.toLowerCase().includes(lowerQuery)
  );
}

export function getProductMapping(assetId: string): ProductMapping | null {
  const asset = [...ctidMappedProducts, ...customMappings.map(m => m.asset)].find(p => p.id === assetId);
  if (!asset) return null;

  const productDataComponents = dataComponents.filter(dc => 
    asset.dataComponents.includes(dc.id)
  );

  const productAnalytics = analytics.filter(a => 
    a.requiredDataComponents.some(dc => asset.dataComponents.includes(dc))
  );

  const techniqueIds = new Set<string>();
  productAnalytics.forEach(a => a.detectsTechniques.forEach(t => techniqueIds.add(t)));
  
  const productTechniques = techniques.filter(t => techniqueIds.has(t.id));

  const valueScore = Math.min(100, productAnalytics.length * 8 + productDataComponents.length * 3);

  return {
    asset,
    dataComponents: productDataComponents,
    analytics: productAnalytics,
    techniques: productTechniques,
    valueScore,
    gapsFilled: productTechniques.map(t => t.id),
  };
}

export function generateAIMapping(vendor: string, product: string, details: string): ProductMapping {
  const mockDataComponents = dataComponents.slice(0, 3);
  const mockAnalytics = analytics.slice(0, 2);
  const mockTechniqueIds = new Set<string>();
  mockAnalytics.forEach(a => a.detectsTechniques.forEach(t => mockTechniqueIds.add(t)));
  const mockTechniques = techniques.filter(t => mockTechniqueIds.has(t.id));

  return {
    asset: {
      id: `AI-${Date.now()}`,
      vendor,
      productName: product,
      deployment: details,
      description: `AI-analyzed mapping for ${vendor} ${product}`,
      dataComponents: mockDataComponents.map(dc => dc.id),
      source: 'ai-pending',
    },
    dataComponents: mockDataComponents,
    analytics: mockAnalytics,
    techniques: mockTechniques,
    valueScore: 65,
    gapsFilled: mockTechniques.map(t => t.id),
  };
}

export interface CustomMapping extends ProductMapping {
  reviews: MappingReview[];
  createdAt: Date;
  updatedAt: Date;
  status: 'draft' | 'approved';
}

let customMappings: CustomMapping[] = [];

export function saveCustomMapping(mapping: ProductMapping, reviews: MappingReview[]): CustomMapping {
  const custom: CustomMapping = {
    ...mapping,
    asset: { ...mapping.asset, source: 'custom' },
    reviews,
    createdAt: new Date(),
    updatedAt: new Date(),
    status: 'approved',
  };
  customMappings.push(custom);
  return custom;
}

export function getCustomMappings(): CustomMapping[] {
  return customMappings;
}

export function getAllProducts(): Asset[] {
  return [...ctidMappedProducts, ...customMappings.map(m => m.asset)];
}
