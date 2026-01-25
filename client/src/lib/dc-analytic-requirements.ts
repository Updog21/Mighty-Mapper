import { platformMatchesAny } from '@shared/platforms';

/**
 * Data Component Analytic Requirements
 *
 * This file implements the "analytic requirement tuple" derivation from the MITRE
 * Data Component methodology. For each DC, we define:
 *
 * 1. Name - The canonical DC name (from STIX x-mitre-data-component.name)
 * 2. Channel - Normalized telemetry channel classifier (inferred from DC semantics)
 * 3. Expected Core Fields - Fields you should expect in the telemetry
 * 4. Default Mutable Elements - Environment-variable fields to treat as tunable
 * 5. Log Sources to Look For - Typical log sources that provide this DC
 *
 * STIX Availability:
 * - Name/ID: Available in STIX (x-mitre-data-component)
 * - Channel: Partially available (inferred from DC description/examples)
 * - Mutable Elements: Partially available (inferred, validated from user's log schema)
 * - Log Sources: Not in STIX (environment-specific)
 *
 * @see https://github.com/mitre-attack/attack-stix-data
 * @see https://attack.mitre.org/datacomponents/
 */

export interface AnalyticRequirement {
  /** MITRE Data Component ID (e.g., "DC0002") */
  dcId: string;

  /** Canonical DC name from STIX */
  name: string;

  /** Normalized telemetry channel classifier */
  channel: string;

  /** Core fields expected in telemetry for this DC */
  expectedCoreFields: string[];

  /** Environment-variable fields to treat as tunable/mutable */
  defaultMutableElements: string[];

  /** Typical log sources that provide this DC */
  logSourcesToLookFor: string[];

  /** Parent Data Source name from STIX */
  dataSource?: string;

  /** Applicable platforms (derived from techniques that use this DC) */
  platforms?: string[];
}

/**
 * Channel categories - normalized telemetry channel classifiers
 * These group related DCs by their telemetry semantics
 */
export const CHANNEL_CATEGORIES = {
  // Identity & Access
  AUTH_TELEMETRY: 'Authentication telemetry',
  SESSION_LIFECYCLE: 'Session lifecycle telemetry',
  SESSION_CONTEXT: 'Session context enrichment',
  IDENTITY_ADMIN: 'Identity administration/audit',
  IDENTITY_INVENTORY: 'Identity inventory/context',
  AUTHZ_ADMIN: 'Authorization administration/audit',
  AUTHZ_DISCOVERY: 'Authorization discovery/audit',
  AUTHZ_INVENTORY: 'Authorization inventory/context',
  DIRECTORY_AUTH: 'Directory authentication/credential service telemetry',
  DIRECTORY_ACCESS: 'Directory object access audit',
  DIRECTORY_CHANGE: 'Directory change audit',

  // Execution & Process
  PROCESS_TELEMETRY: 'Endpoint process telemetry',
  PROCESS_ENRICHMENT: 'Endpoint process enrichment',
  PROCESS_INTER: 'Endpoint inter-process telemetry',
  PROCESS_TAMPER: 'Endpoint process tamper telemetry',
  SHELL_TELEMETRY: 'Endpoint shell/interpreter telemetry',
  SCRIPT_TELEMETRY: 'Endpoint interpreter telemetry',
  MODULE_TELEMETRY: 'Endpoint process/module telemetry',
  API_TELEMETRY: 'Low-level OS API/syscall telemetry',

  // File System
  FILE_TELEMETRY: 'Host file system telemetry',
  FILE_ACCESS: 'Host file access telemetry',
  FILE_CONTEXT: 'File context/enrichment',
  STORAGE_TELEMETRY: 'Host storage device/mount telemetry',
  STORAGE_ACCESS: 'Host storage access telemetry',
  STORAGE_CONFIG: 'Host storage configuration telemetry',

  // Windows Specific
  REGISTRY_TELEMETRY: 'Windows configuration telemetry',
  WMI_TELEMETRY: 'Windows management instrumentation telemetry',
  IPC_TELEMETRY: 'Windows IPC telemetry',

  // Network
  NETWORK_SESSION: 'Network session establishment telemetry',
  FLOW_TELEMETRY: 'Flow telemetry',
  CONTENT_TELEMETRY: 'Full content/PCAP or deep session content',
  SHARE_TELEMETRY: 'File sharing / SMB audit telemetry',
  FIREWALL_TELEMETRY: 'Firewall configuration telemetry',

  // Services & Persistence
  SERVICE_TELEMETRY: 'Service control/daemon registration telemetry',
  SERVICE_CONTEXT: 'Service context/inventory',
  JOB_TELEMETRY: 'Job scheduler telemetry',
  JOB_CONTEXT: 'Job context/inventory',

  // Kernel & Hardware
  DRIVER_TELEMETRY: 'Kernel/driver telemetry',
  DRIVER_CONTEXT: 'Driver context/integrity',
  FIRMWARE_TELEMETRY: 'Boot/firmware integrity telemetry',
  KERNEL_TELEMETRY: 'Kernel extension/module telemetry',

  // Security Sensors
  SENSOR_HEALTH: 'Security sensor health telemetry',
  MALWARE_REPO: 'Malware repository/sandbox artifact store',
  MALWARE_META: 'Malware repository metadata',

  // Credentials
  CREDENTIAL_ISSUE: 'Credential artifact issuance telemetry',
  CREDENTIAL_USE: 'Credential usage/auth telemetry',

  // Cloud
  CLOUD_SERVICE: 'Cloud service control-plane telemetry',
  CLOUD_INSTANCE: 'Cloud instance lifecycle telemetry',
  CLOUD_STORAGE: 'Cloud storage telemetry',
  CLOUD_FIREWALL: 'Cloud firewall/security group telemetry',

  // Container
  CONTAINER_LIFECYCLE: 'Container lifecycle telemetry',
  POD_LIFECYCLE: 'Pod lifecycle telemetry',

  // Application
  APP_AUDIT: 'Application/service audit logs',
  CONFIG_AUDIT: 'Configuration change audit',

  // Enrichment/External
  DNS_INTEL: 'DNS intelligence',
  DOMAIN_INTEL: 'Domain/WHOIS intelligence',
  CERT_INTEL: 'Certificate intelligence',
  SCAN_RESPONSE: 'Scanner response telemetry',
  SOCIAL_INTEL: 'Social media/OSINT',
  EMAIL_TELEMETRY: 'Email telemetry',
} as const;

export type ChannelCategory = typeof CHANNEL_CATEGORIES[keyof typeof CHANNEL_CATEGORIES];

/**
 * Complete DC-to-AnalyticRequirement mapping
 *
 * This is the authoritative mapping derived from:
 * 1. MITRE ATT&CK STIX data (DC names, IDs, descriptions)
 * 2. Design document examples (channels, mutable elements, log sources)
 * 3. Semantic inference from DC definitions
 */
export const DC_ANALYTIC_REQUIREMENTS: Record<string, AnalyticRequirement> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY & ACCESS
  // ═══════════════════════════════════════════════════════════════════════════

  'User Account Authentication': {
    dcId: 'DC0002',
    name: 'User Account Authentication',
    channel: CHANNEL_CATEGORIES.AUTH_TELEMETRY,
    expectedCoreFields: [
      'user/account identifier',
      'timestamp',
      'outcome (success/failure)',
      'credential/auth method (password/token/MFA)',
      'target resource',
      'source IP/device context',
    ],
    defaultMutableElements: [
      'source IP (NAT/VPN)',
      'user agent/device ID',
      'auth policy/risk evaluation outputs',
      'failure reason strings/codes',
    ],
    logSourcesToLookFor: [
      'OS auth logs',
      'IdP sign-in logs',
      'VPN auth logs',
      'Cloud sign-in logs',
      'PAM/sudo logs',
    ],
    dataSource: 'User Account',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS', 'Identity Provider'],
  },

  'Logon Session Creation': {
    dcId: 'DC0067',
    name: 'Logon Session Creation',
    channel: CHANNEL_CATEGORIES.SESSION_LIFECYCLE,
    expectedCoreFields: [
      'user identifier',
      'timestamp',
      'session/logon identifier',
      'success indicator (implicit)',
      'host/resource',
    ],
    defaultMutableElements: [
      'logon/session IDs',
      'correlation IDs',
      'token IDs',
      'workstation/device IDs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4624)',
      'SSH auth logs',
      'PAM session logs',
      'VPN session logs',
    ],
    dataSource: 'Logon Session',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Logon Session Metadata': {
    dcId: 'DC0088',
    name: 'Logon Session Metadata',
    channel: CHANNEL_CATEGORIES.SESSION_CONTEXT,
    expectedCoreFields: [
      'username',
      'logon type',
      'session/logon identifiers',
      'security context (token/SID)',
    ],
    defaultMutableElements: [
      'access token identifiers',
      'session identifiers',
      'device context',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log',
      'EDR session telemetry',
      'Identity provider session data',
    ],
    dataSource: 'Logon Session',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'User Account Creation': {
    dcId: 'DC0014',
    name: 'User Account Creation',
    channel: CHANNEL_CATEGORIES.IDENTITY_ADMIN,
    expectedCoreFields: [
      'actor (who performed change)',
      'target account ID',
      'timestamp',
      'create action',
      'attributes set',
    ],
    defaultMutableElements: [
      'request IDs',
      'provisioning workflow IDs',
      'attribute sets',
      'initiator identity',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4720)',
      'Linux useradd/auditd',
      'IdP provisioning logs',
      'Cloud IAM audit logs',
    ],
    dataSource: 'User Account',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS'],
  },

  'User Account Modification': {
    dcId: 'DC0010',
    name: 'User Account Modification',
    channel: CHANNEL_CATEGORIES.IDENTITY_ADMIN,
    expectedCoreFields: [
      'actor',
      'target account',
      'timestamp',
      'changed attributes/roles/auth methods',
    ],
    defaultMutableElements: [
      'changed attribute names/values',
      'request IDs',
      'policy identifiers',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4738)',
      'Linux usermod/auditd',
      'IdP attribute change logs',
      'Cloud IAM audit logs',
    ],
    dataSource: 'User Account',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS'],
  },

  'User Account Deletion': {
    dcId: 'DC0009',
    name: 'User Account Deletion',
    channel: CHANNEL_CATEGORIES.IDENTITY_ADMIN,
    expectedCoreFields: [
      'actor',
      'target account',
      'timestamp',
      'delete/disable outcome',
    ],
    defaultMutableElements: [
      'request IDs',
      'deprovision workflow IDs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4726)',
      'Linux userdel/auditd',
      'IdP deprovisioning logs',
      'Cloud IAM audit logs',
    ],
    dataSource: 'User Account',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS'],
  },

  'User Account Metadata': {
    dcId: 'DC0013',
    name: 'User Account Metadata',
    channel: CHANNEL_CATEGORIES.IDENTITY_INVENTORY,
    expectedCoreFields: [
      'username/user ID',
      'account type/classification',
      'environment context',
    ],
    defaultMutableElements: [
      'display names',
      'email/user principal names',
      'directory IDs',
    ],
    logSourcesToLookFor: [
      'Identity directory inventory',
      'Cloud IAM queries',
      'Active Directory exports',
    ],
    dataSource: 'User Account',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS'],
  },

  'Group Modification': {
    dcId: 'DC0094',
    name: 'Group Modification',
    channel: CHANNEL_CATEGORIES.AUTHZ_ADMIN,
    expectedCoreFields: [
      'actor',
      'group identifier',
      'timestamp',
      'membership/permission change details',
    ],
    defaultMutableElements: [
      'group membership lists',
      'role bindings',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4728, 4732, 4756)',
      'Linux group management/auditd',
      'IdP group audit logs',
      'Cloud IAM group logs',
    ],
    dataSource: 'Group',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS'],
  },

  'Group Enumeration': {
    dcId: 'DC0099',
    name: 'Group Enumeration',
    channel: CHANNEL_CATEGORIES.AUTHZ_DISCOVERY,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
      'scope/tenant/domain',
    ],
    defaultMutableElements: [
      'query parameters',
      'pagination tokens',
      'API request IDs',
    ],
    logSourcesToLookFor: [
      'Active Directory query logs',
      'LDAP query logs',
      'Cloud IAM API logs',
    ],
    dataSource: 'Group',
    platforms: ['Windows', 'Linux', 'SaaS', 'IaaS'],
  },

  'Group Metadata': {
    dcId: 'DC0105',
    name: 'Group Metadata',
    channel: CHANNEL_CATEGORIES.AUTHZ_INVENTORY,
    expectedCoreFields: [
      'group name/ID',
      'permissions/role attributes',
      'timestamp (snapshot time)',
    ],
    defaultMutableElements: [
      'permission sets',
      'associated accounts',
    ],
    logSourcesToLookFor: [
      'Directory/IAM inventory records',
      'Cloud IAM exports',
      'Active Directory dumps',
    ],
    dataSource: 'Group',
    platforms: ['Windows', 'Linux', 'SaaS', 'IaaS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIVE DIRECTORY
  // ═══════════════════════════════════════════════════════════════════════════

  'Active Directory Credential Request': {
    dcId: 'DC0084',
    name: 'Active Directory Credential Request',
    channel: CHANNEL_CATEGORIES.DIRECTORY_AUTH,
    expectedCoreFields: [
      'requester identity',
      'timestamp',
      'credential request mechanism (Kerberos/NTLM/LDAP)',
      'target principal/service',
    ],
    defaultMutableElements: [
      'ticket IDs',
      'request IDs',
      'SPNs',
      'client addresses',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4768, 4769, 4771)',
      'Domain Controller logs',
      'Kerberos logs',
    ],
    dataSource: 'Active Directory',
    platforms: ['Windows'],
  },

  'Active Directory Object Access': {
    dcId: 'DC0071',
    name: 'Active Directory Object Access',
    channel: CHANNEL_CATEGORIES.DIRECTORY_ACCESS,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'object identifier (DN/GUID)',
      'access type (read/query)',
      'outcome',
    ],
    defaultMutableElements: [
      'object identifiers',
      'query filters',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4661)',
      'Active Directory audit logs',
    ],
    dataSource: 'Active Directory',
    platforms: ['Windows'],
  },

  'Active Directory Object Creation': {
    dcId: 'DC0087',
    name: 'Active Directory Object Creation',
    channel: CHANNEL_CATEGORIES.DIRECTORY_CHANGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'object created (DN/GUID/type)',
      'attributes set',
    ],
    defaultMutableElements: [
      'object IDs',
      'attribute sets',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (5137)',
      'Active Directory audit logs',
    ],
    dataSource: 'Active Directory',
    platforms: ['Windows'],
  },

  'Active Directory Object Modification': {
    dcId: 'DC0066',
    name: 'Active Directory Object Modification',
    channel: CHANNEL_CATEGORIES.DIRECTORY_CHANGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'object modified',
      'attribute changes',
    ],
    defaultMutableElements: [
      'changed attribute names/values',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (5136, 5163)',
      'Active Directory audit logs',
    ],
    dataSource: 'Active Directory',
    platforms: ['Windows'],
  },

  'Active Directory Object Deletion': {
    dcId: 'DC0068',
    name: 'Active Directory Object Deletion',
    channel: CHANNEL_CATEGORIES.DIRECTORY_CHANGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'object deleted',
      'outcome',
    ],
    defaultMutableElements: [
      'object IDs',
      'tombstone identifiers',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (5141)',
      'Active Directory audit logs',
    ],
    dataSource: 'Active Directory',
    platforms: ['Windows'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROCESS & EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  'Process Creation': {
    dcId: 'DC0032',
    name: 'Process Creation',
    channel: CHANNEL_CATEGORIES.PROCESS_TELEMETRY,
    expectedCoreFields: [
      'process image/name/path',
      'timestamp',
      'parent process',
      'command line/args',
      'user context',
    ],
    defaultMutableElements: [
      'PID/Process GUID',
      'command line content',
      'parent-child graph',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 1',
      'Windows Security Event Log (4688)',
      'Linux auditd (execve)',
      'EDR process telemetry',
    ],
    dataSource: 'Process',
    platforms: ['Windows', 'Linux', 'macOS', 'Containers'],
  },

  'Process Termination': {
    dcId: 'DC0033',
    name: 'Process Termination',
    channel: CHANNEL_CATEGORIES.PROCESS_TELEMETRY,
    expectedCoreFields: [
      'process identifier',
      'timestamp',
      'exit/termination indicator',
      'user/context',
    ],
    defaultMutableElements: [
      'PIDs',
      'exit codes',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 5',
      'Linux auditd',
      'EDR process lifecycle telemetry',
    ],
    dataSource: 'Process',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Process Metadata': {
    dcId: 'DC0034',
    name: 'Process Metadata',
    channel: CHANNEL_CATEGORIES.PROCESS_ENRICHMENT,
    expectedCoreFields: [
      'environment variables',
      'image name',
      'owner/user',
      'integrity/signing info',
    ],
    defaultMutableElements: [
      'env var sets',
      'signer state',
      'runtime context',
    ],
    logSourcesToLookFor: [
      'EDR process telemetry',
      'OS telemetry with enrichment',
    ],
    dataSource: 'Process',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Command Execution': {
    dcId: 'DC0064',
    name: 'Command Execution',
    channel: CHANNEL_CATEGORIES.SHELL_TELEMETRY,
    expectedCoreFields: [
      'command text',
      'timestamp',
      'interpreter (cmd/bash/PowerShell)',
      'parameters/arguments',
      'user context',
    ],
    defaultMutableElements: [
      'command strings',
      'arguments',
      'working directory',
      'runspace/session identifiers',
    ],
    logSourcesToLookFor: [
      'PowerShell Operational Log (4103, 4104)',
      'Bash history / auditd',
      'EDR command telemetry',
      'Sysmon Event ID 1 (with command line)',
    ],
    dataSource: 'Command',
    platforms: ['Windows', 'Linux', 'macOS', 'Containers'],
  },

  'Script Execution': {
    dcId: 'DC0029',
    name: 'Script Execution',
    channel: CHANNEL_CATEGORIES.SCRIPT_TELEMETRY,
    expectedCoreFields: [
      'script name/path/content identifier',
      'timestamp',
      'interpreter',
      'user context',
    ],
    defaultMutableElements: [
      'script path',
      'script content',
      'script block IDs',
    ],
    logSourcesToLookFor: [
      'PowerShell Script Block Logging (4104)',
      'Windows Script Host logs',
      'EDR script telemetry',
    ],
    dataSource: 'Script',
    platforms: ['Windows', 'Linux', 'macOS', 'Containers'],
  },

  'Module Load': {
    dcId: 'DC0016',
    name: 'Module Load',
    channel: CHANNEL_CATEGORIES.MODULE_TELEMETRY,
    expectedCoreFields: [
      'process identity',
      'loaded module/library name/path',
      'timestamp',
    ],
    defaultMutableElements: [
      'module paths',
      'loaded module sets',
      'signature states',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 7',
      'EDR module load telemetry',
    ],
    dataSource: 'Module',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Process Access': {
    dcId: 'DC0035',
    name: 'Process Access',
    channel: CHANNEL_CATEGORIES.PROCESS_INTER,
    expectedCoreFields: [
      'source process',
      'target process',
      'timestamp',
      'access type/rights',
    ],
    defaultMutableElements: [
      'process IDs',
      'access masks/rights',
      'handles',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 10',
      'EDR inter-process telemetry',
    ],
    dataSource: 'Process',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Process Modification': {
    dcId: 'DC0020',
    name: 'Process Modification',
    channel: CHANNEL_CATEGORIES.PROCESS_TAMPER,
    expectedCoreFields: [
      'source process',
      'target process',
      'timestamp',
      'modification type (memory write/inject)',
    ],
    defaultMutableElements: [
      'memory regions',
      'injected payload indicators',
      'thread IDs',
    ],
    logSourcesToLookFor: [
      'EDR injection detection',
      'Sysmon Event ID 8 (CreateRemoteThread)',
    ],
    dataSource: 'Process',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'OS API Execution': {
    dcId: 'DC0021',
    name: 'OS API Execution',
    channel: CHANNEL_CATEGORIES.API_TELEMETRY,
    expectedCoreFields: [
      'calling process',
      'API called (or category)',
      'timestamp',
      'parameters/outcome',
    ],
    defaultMutableElements: [
      'API names',
      'parameter values',
      'call stacks',
    ],
    logSourcesToLookFor: [
      'ETW traces',
      'EDR API telemetry',
      'Linux eBPF/audit',
    ],
    dataSource: 'Sensor Health',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FILE SYSTEM
  // ═══════════════════════════════════════════════════════════════════════════

  'File Creation': {
    dcId: 'DC0039',
    name: 'File Creation',
    channel: CHANNEL_CATEGORIES.FILE_TELEMETRY,
    expectedCoreFields: [
      'file path',
      'timestamp',
      'creating process/user',
      'file name',
    ],
    defaultMutableElements: [
      'file paths (temp dirs)',
      'file names',
      'hashes',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 11',
      'Linux auditd',
      'EDR file telemetry',
    ],
    dataSource: 'File',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'File Modification': {
    dcId: 'DC0061',
    name: 'File Modification',
    channel: CHANNEL_CATEGORIES.FILE_TELEMETRY,
    expectedCoreFields: [
      'file path',
      'timestamp',
      'modifying process/user',
      'modification type',
    ],
    defaultMutableElements: [
      'file attributes',
      'permissions',
      'content deltas',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 2',
      'Linux auditd',
      'EDR file telemetry',
    ],
    dataSource: 'File',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'File Deletion': {
    dcId: 'DC0040',
    name: 'File Deletion',
    channel: CHANNEL_CATEGORIES.FILE_TELEMETRY,
    expectedCoreFields: [
      'file path',
      'timestamp',
      'deleting process/user',
    ],
    defaultMutableElements: [
      'paths',
      'deletion method',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 23, 26',
      'Linux auditd',
      'EDR file telemetry',
    ],
    dataSource: 'File',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'File Access': {
    dcId: 'DC0055',
    name: 'File Access',
    channel: CHANNEL_CATEGORIES.FILE_ACCESS,
    expectedCoreFields: [
      'file path',
      'timestamp',
      'accessing process/user',
      'access type (read/execute)',
    ],
    defaultMutableElements: [
      'access patterns',
      'handles',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4663)',
      'Linux auditd',
      'EDR file access telemetry',
    ],
    dataSource: 'File',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'File Metadata': {
    dcId: 'DC0059',
    name: 'File Metadata',
    channel: CHANNEL_CATEGORIES.FILE_CONTEXT,
    expectedCoreFields: [
      'file name/path',
      'timestamps',
      'owner',
      'permissions',
      'size/type',
      'hashes/signatures',
    ],
    defaultMutableElements: [
      'file timestamps',
      'hash values',
      'owner/ACL',
    ],
    logSourcesToLookFor: [
      'File integrity monitoring',
      'EDR file enrichment',
      'OS file system queries',
    ],
    dataSource: 'File',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Drive Creation': {
    dcId: 'DC0042',
    name: 'Drive Creation',
    channel: CHANNEL_CATEGORIES.STORAGE_TELEMETRY,
    expectedCoreFields: [
      'drive letter/mount point',
      'timestamp',
      'device identifier',
    ],
    defaultMutableElements: [
      'mount points',
      'removable device IDs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log',
      'USB device logs',
      'Linux mount logs',
    ],
    dataSource: 'Drive',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Drive Access': {
    dcId: 'DC0054',
    name: 'Drive Access',
    channel: CHANNEL_CATEGORIES.STORAGE_ACCESS,
    expectedCoreFields: [
      'drive/mount identifier',
      'timestamp',
      'accessing process/user',
    ],
    defaultMutableElements: [
      'mount points',
      'access paths',
    ],
    logSourcesToLookFor: [
      'File system audit logs',
      'EDR drive telemetry',
    ],
    dataSource: 'Drive',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Drive Modification': {
    dcId: 'DC0046',
    name: 'Drive Modification',
    channel: CHANNEL_CATEGORIES.STORAGE_CONFIG,
    expectedCoreFields: [
      'drive/mount identifier',
      'timestamp',
      'change type (reassign/rename/perms)',
    ],
    defaultMutableElements: [
      'mount point names',
      'permissions',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log',
      'Linux mount/fstab logs',
    ],
    dataSource: 'Drive',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WINDOWS REGISTRY
  // ═══════════════════════════════════════════════════════════════════════════

  'Windows Registry Key Access': {
    dcId: 'DC0050',
    name: 'Windows Registry Key Access',
    channel: CHANNEL_CATEGORIES.REGISTRY_TELEMETRY,
    expectedCoreFields: [
      'registry key path',
      'timestamp',
      'accessing process/user',
    ],
    defaultMutableElements: [
      'key paths',
      'value names',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 12, 13, 14',
      'Windows Security Event Log',
      'EDR registry telemetry',
    ],
    dataSource: 'Windows Registry',
    platforms: ['Windows'],
  },

  'Windows Registry Key Creation': {
    dcId: 'DC0056',
    name: 'Windows Registry Key Creation',
    channel: CHANNEL_CATEGORIES.REGISTRY_TELEMETRY,
    expectedCoreFields: [
      'key path created',
      'timestamp',
      'creating process/user',
    ],
    defaultMutableElements: [
      'key paths',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 12',
      'Windows Security Event Log',
      'EDR registry telemetry',
    ],
    dataSource: 'Windows Registry',
    platforms: ['Windows'],
  },

  'Windows Registry Key Modification': {
    dcId: 'DC0063',
    name: 'Windows Registry Key Modification',
    channel: CHANNEL_CATEGORIES.REGISTRY_TELEMETRY,
    expectedCoreFields: [
      'key path/value name',
      'timestamp',
      'modifying process/user',
      'changed data',
    ],
    defaultMutableElements: [
      'value data',
      'permissions',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 13',
      'Windows Security Event Log',
      'EDR registry telemetry',
    ],
    dataSource: 'Windows Registry',
    platforms: ['Windows'],
  },

  'Windows Registry Key Deletion': {
    dcId: 'DC0045',
    name: 'Windows Registry Key Deletion',
    channel: CHANNEL_CATEGORIES.REGISTRY_TELEMETRY,
    expectedCoreFields: [
      'deleted key path',
      'timestamp',
      'deleting process/user',
    ],
    defaultMutableElements: [
      'key paths',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 12',
      'Windows Security Event Log',
      'EDR registry telemetry',
    ],
    dataSource: 'Windows Registry',
    platforms: ['Windows'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICES & PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  'Service Creation': {
    dcId: 'DC0060',
    name: 'Service Creation',
    channel: CHANNEL_CATEGORIES.SERVICE_TELEMETRY,
    expectedCoreFields: [
      'service name',
      'timestamp',
      'service executable/image path',
      'actor/process',
    ],
    defaultMutableElements: [
      'service names',
      'binary paths',
      'start accounts',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (4697)',
      'Windows System Event Log (7045)',
      'Linux systemd logs',
      'EDR service telemetry',
    ],
    dataSource: 'Service',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Service Modification': {
    dcId: 'DC0065',
    name: 'Service Modification',
    channel: CHANNEL_CATEGORIES.SERVICE_TELEMETRY,
    expectedCoreFields: [
      'service name',
      'timestamp',
      'changed parameters (start type/image path)',
    ],
    defaultMutableElements: [
      'config parameters',
      'service ACLs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log',
      'Linux systemd logs',
      'EDR service telemetry',
    ],
    dataSource: 'Service',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Service Metadata': {
    dcId: 'DC0041',
    name: 'Service Metadata',
    channel: CHANNEL_CATEGORIES.SERVICE_CONTEXT,
    expectedCoreFields: [
      'service name',
      'executable',
      'start type',
      'account',
    ],
    defaultMutableElements: [
      'configuration values',
      'binary paths',
    ],
    logSourcesToLookFor: [
      'Service configuration queries',
      'EDR service inventory',
    ],
    dataSource: 'Service',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Scheduled Job Creation': {
    dcId: 'DC0001',
    name: 'Scheduled Job Creation',
    channel: CHANNEL_CATEGORIES.JOB_TELEMETRY,
    expectedCoreFields: [
      'job/task name',
      'timestamp',
      'schedule/trigger',
      'command/action',
    ],
    defaultMutableElements: [
      'task names',
      'schedules',
      'command lines',
    ],
    logSourcesToLookFor: [
      'Windows Task Scheduler Log (4698)',
      'Sysmon Event ID 1 (schtasks.exe)',
      'Linux cron logs',
      'at/batch logs',
    ],
    dataSource: 'Scheduled Job',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Scheduled Job Modification': {
    dcId: 'DC0012',
    name: 'Scheduled Job Modification',
    channel: CHANNEL_CATEGORIES.JOB_TELEMETRY,
    expectedCoreFields: [
      'job name',
      'timestamp',
      'changed schedule/command',
    ],
    defaultMutableElements: [
      'schedule fields',
      'command strings',
    ],
    logSourcesToLookFor: [
      'Windows Task Scheduler Log (4702)',
      'Linux cron/at logs',
    ],
    dataSource: 'Scheduled Job',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Scheduled Job Metadata': {
    dcId: 'DC0005',
    name: 'Scheduled Job Metadata',
    channel: CHANNEL_CATEGORIES.JOB_CONTEXT,
    expectedCoreFields: [
      'name',
      'timing',
      'command(s)',
    ],
    defaultMutableElements: [
      'schedules',
      'command args',
    ],
    logSourcesToLookFor: [
      'Task/job configuration queries',
      'crontab listings',
    ],
    dataSource: 'Scheduled Job',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NETWORK
  // ═══════════════════════════════════════════════════════════════════════════

  'Network Connection Creation': {
    dcId: 'DC0082',
    name: 'Network Connection Creation',
    channel: CHANNEL_CATEGORIES.NETWORK_SESSION,
    expectedCoreFields: [
      'timestamp',
      'source/destination IP',
      'source/destination port',
      'protocol',
      'initiating process/host context',
    ],
    defaultMutableElements: [
      'ephemeral ports',
      'NAT addresses',
      'connection IDs',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 3',
      'Firewall logs',
      'EDR network telemetry',
      'VPN logs',
    ],
    dataSource: 'Network Traffic',
    platforms: ['Windows', 'Linux', 'macOS', 'Network Devices', 'Containers'],
  },

  'Network Traffic Flow': {
    dcId: 'DC0078',
    name: 'Network Traffic Flow',
    channel: CHANNEL_CATEGORIES.FLOW_TELEMETRY,
    expectedCoreFields: [
      '5-tuple (src IP, dst IP, src port, dst port, protocol)',
      'start/end timestamps',
      'bytes/packets',
      'direction',
    ],
    defaultMutableElements: [
      'ephemeral ports',
      'flow IDs',
      'NAT mapping',
    ],
    logSourcesToLookFor: [
      'VPC Flow Logs',
      'NetFlow/IPFIX',
      'Zeek conn.log',
      'Firewall flow logs',
    ],
    dataSource: 'Network Traffic',
    platforms: ['Windows', 'Linux', 'macOS', 'Network Devices', 'IaaS', 'Containers'],
  },

  'Network Traffic Content': {
    dcId: 'DC0085',
    name: 'Network Traffic Content',
    channel: CHANNEL_CATEGORIES.CONTENT_TELEMETRY,
    expectedCoreFields: [
      'protocol headers and payload/session content',
      'timestamps',
      'endpoints',
    ],
    defaultMutableElements: [
      'payload contents',
      'session reassembly artifacts',
      'content encodings',
    ],
    logSourcesToLookFor: [
      'PCAP',
      'Zeek logs (http.log, dns.log, ssl.log)',
      'Deep packet inspection',
      'NDR platforms',
    ],
    dataSource: 'Network Traffic',
    platforms: ['Network Devices'],
  },

  'Network Share Access': {
    dcId: 'DC0102',
    name: 'Network Share Access',
    channel: CHANNEL_CATEGORIES.SHARE_TELEMETRY,
    expectedCoreFields: [
      'share name/path',
      'timestamp',
      'user',
      'source host/IP',
      'outcome',
    ],
    defaultMutableElements: [
      'share paths',
      'source IPs',
      'session IDs',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (5140, 5145)',
      'SMB audit logs',
    ],
    dataSource: 'Network Share',
    platforms: ['Windows', 'Linux', 'Network Devices'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WINDOWS SPECIFIC
  // ═══════════════════════════════════════════════════════════════════════════

  'WMI Creation': {
    dcId: 'DC0008',
    name: 'WMI Creation',
    channel: CHANNEL_CATEGORIES.WMI_TELEMETRY,
    expectedCoreFields: [
      'object type (filter/consumer/subscription/binding/provider)',
      'timestamp',
      'creating process/user',
      'object identifiers',
    ],
    defaultMutableElements: [
      'object names/IDs',
      'query strings',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 19, 20, 21',
      'WMI trace logs',
      'EDR WMI telemetry',
    ],
    dataSource: 'WMI',
    platforms: ['Windows'],
  },

  'Named Pipe Metadata': {
    dcId: 'DC0048',
    name: 'Named Pipe Metadata',
    channel: CHANNEL_CATEGORIES.IPC_TELEMETRY,
    expectedCoreFields: [
      'pipe name',
      'timestamp',
      'creating process',
    ],
    defaultMutableElements: [
      'pipe names',
      'process IDs',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 17, 18',
      'EDR pipe telemetry',
    ],
    dataSource: 'Named Pipe',
    platforms: ['Windows'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // KERNEL & DRIVERS
  // ═══════════════════════════════════════════════════════════════════════════

  'Driver Load': {
    dcId: 'DC0079',
    name: 'Driver Load',
    channel: CHANNEL_CATEGORIES.DRIVER_TELEMETRY,
    expectedCoreFields: [
      'driver name/path',
      'timestamp',
      'load outcome',
    ],
    defaultMutableElements: [
      'driver paths',
      'load order',
      'device contexts',
    ],
    logSourcesToLookFor: [
      'Sysmon Event ID 6',
      'Windows System Event Log',
      'EDR driver telemetry',
    ],
    dataSource: 'Driver',
    platforms: ['Windows', 'Linux'],
  },

  'Driver Metadata': {
    dcId: 'DC0074',
    name: 'Driver Metadata',
    channel: CHANNEL_CATEGORIES.DRIVER_CONTEXT,
    expectedCoreFields: [
      'driver hash/signature/integrity/origin',
      'timestamp (collection time)',
    ],
    defaultMutableElements: [
      'hash values',
      'signature status',
      'error codes',
    ],
    logSourcesToLookFor: [
      'Driver signing verification',
      'EDR driver analysis',
    ],
    dataSource: 'Driver',
    platforms: ['Windows', 'Linux'],
  },

  'Firmware Modification': {
    dcId: 'DC0004',
    name: 'Firmware Modification',
    channel: CHANNEL_CATEGORIES.FIRMWARE_TELEMETRY,
    expectedCoreFields: [
      'component modified (MBR/VBR/firmware area)',
      'timestamp',
      'modifying actor/process',
    ],
    defaultMutableElements: [
      'firmware components',
      'boot records',
      'integrity measurements',
    ],
    logSourcesToLookFor: [
      'UEFI logs',
      'Secure Boot logs',
      'EDR firmware telemetry',
    ],
    dataSource: 'Firmware',
    platforms: ['Windows', 'Linux'],
  },

  'Kernel Module Load': {
    dcId: 'DC0031',
    name: 'Kernel Module Load',
    channel: CHANNEL_CATEGORIES.KERNEL_TELEMETRY,
    expectedCoreFields: [
      'module name/path',
      'timestamp',
      'load outcome',
    ],
    defaultMutableElements: [
      'module names',
      'load parameters',
    ],
    logSourcesToLookFor: [
      'Linux auditd (init_module)',
      'dmesg',
      'EDR kernel telemetry',
    ],
    dataSource: 'Kernel',
    platforms: ['Linux', 'macOS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY SENSORS & MALWARE
  // ═══════════════════════════════════════════════════════════════════════════

  'Host Status': {
    dcId: 'DC0018',
    name: 'Host Status',
    channel: CHANNEL_CATEGORIES.SENSOR_HEALTH,
    expectedCoreFields: [
      'sensor/service name',
      'status state (healthy/disabled/tampered)',
      'timestamp',
      'host/device identifier',
    ],
    defaultMutableElements: [
      'status reasons',
      'agent versions',
      'heartbeat intervals',
    ],
    logSourcesToLookFor: [
      'EDR health telemetry',
      'AV status logs',
      'Security sensor heartbeats',
    ],
    dataSource: 'Sensor Health',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Malware Content': {
    dcId: 'DC0011',
    name: 'Malware Content',
    channel: CHANNEL_CATEGORIES.MALWARE_REPO,
    expectedCoreFields: [
      'payload content/artifact reference',
      'associated hashes',
      'timestamp (ingest/analysis)',
    ],
    defaultMutableElements: [
      'extracted strings',
      'signatures',
      'behavioral artifacts',
    ],
    logSourcesToLookFor: [
      'Malware sandbox submissions',
      'AV quarantine',
      'Malware repository feeds',
    ],
    dataSource: 'Malware Repository',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  'Malware Metadata': {
    dcId: 'DC0003',
    name: 'Malware Metadata',
    channel: CHANNEL_CATEGORIES.MALWARE_META,
    expectedCoreFields: [
      'file hashes',
      'compilation time',
      'configuration/watermarks',
    ],
    defaultMutableElements: [
      'hash sets',
      'compilation timestamps',
      'configs',
    ],
    logSourcesToLookFor: [
      'Malware repository metadata',
      'Threat intel feeds',
      'Sandbox analysis reports',
    ],
    dataSource: 'Malware Repository',
    platforms: ['Windows', 'Linux', 'macOS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CREDENTIALS
  // ═══════════════════════════════════════════════════════════════════════════

  'Web Credential Creation': {
    dcId: 'DC0006',
    name: 'Web Credential Creation',
    channel: CHANNEL_CATEGORIES.CREDENTIAL_ISSUE,
    expectedCoreFields: [
      'principal/account',
      'timestamp',
      'credential artifact type/ID',
    ],
    defaultMutableElements: [
      'ticket/token IDs',
      'service principals',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (1200, 4769)',
      'OAuth token issuance logs',
      'IdP token logs',
    ],
    dataSource: 'Web Credential',
    platforms: ['Windows', 'SaaS', 'Identity Provider'],
  },

  'Web Credential Usage': {
    dcId: 'DC0007',
    name: 'Web Credential Usage',
    channel: CHANNEL_CATEGORIES.CREDENTIAL_USE,
    expectedCoreFields: [
      'principal',
      'timestamp',
      'target resource/service',
      'outcome',
    ],
    defaultMutableElements: [
      'ticket/token IDs',
      'client addresses',
    ],
    logSourcesToLookFor: [
      'Windows Security Event Log (1202)',
      'OAuth token usage logs',
      'IdP access logs',
    ],
    dataSource: 'Web Credential',
    platforms: ['Windows', 'SaaS', 'Identity Provider'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // APPLICATION & CONFIGURATION
  // ═══════════════════════════════════════════════════════════════════════════

  'Application Log Content': {
    dcId: 'DC0038',
    name: 'Application Log Content',
    channel: CHANNEL_CATEGORIES.APP_AUDIT,
    expectedCoreFields: [
      'timestamp',
      'actor (user/service)',
      'action/event name',
      'target object/resource',
      'outcome/error',
    ],
    defaultMutableElements: [
      'request IDs',
      'session IDs',
      'object IDs',
      'error messages',
    ],
    logSourcesToLookFor: [
      'Application-specific audit logs',
      'Database audit logs',
      'Web server logs',
      'SaaS activity logs',
    ],
    dataSource: 'Application Log',
    platforms: ['Windows', 'Linux', 'macOS', 'SaaS', 'IaaS'],
  },

  'Configuration Modification': {
    dcId: 'DC0089',
    name: 'Configuration Modification',
    channel: CHANNEL_CATEGORIES.CONFIG_AUDIT,
    expectedCoreFields: [
      'configuration item',
      'timestamp',
      'actor',
      'old/new values',
    ],
    defaultMutableElements: [
      'config keys',
      'config values',
      'revision IDs',
    ],
    logSourcesToLookFor: [
      'Configuration management audit',
      'Cloud config change logs',
      'SaaS admin audit logs',
    ],
    dataSource: 'Application Log',
    platforms: ['SaaS', 'IaaS'],
  },

  'API Request': {
    dcId: 'DC0090',
    name: 'API Request',
    channel: CHANNEL_CATEGORIES.APP_AUDIT,
    expectedCoreFields: [
      'API endpoint',
      'timestamp',
      'actor/caller',
      'request parameters',
      'response code',
    ],
    defaultMutableElements: [
      'request IDs',
      'session tokens',
      'client IPs',
    ],
    logSourcesToLookFor: [
      'API gateway logs',
      'Cloud API audit logs (CloudTrail)',
      'SaaS API logs',
    ],
    dataSource: 'Application Log',
    platforms: ['SaaS', 'IaaS'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLOUD - IaaS
  // ═══════════════════════════════════════════════════════════════════════════

  'Cloud Service Enumeration': {
    dcId: 'DC0070',
    name: 'Cloud Service Enumeration',
    channel: CHANNEL_CATEGORIES.CLOUD_SERVICE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'service type',
      'query/list action',
    ],
    defaultMutableElements: [
      'pagination tokens',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (Describe*/List*)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Service',
    platforms: ['IaaS'],
  },

  'Cloud Service Metadata': {
    dcId: 'DC0092',
    name: 'Cloud Service Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_SERVICE,
    expectedCoreFields: [
      'service identifier',
      'configuration attributes',
      'timestamp',
    ],
    defaultMutableElements: [
      'resource ARNs/IDs',
      'config values',
    ],
    logSourcesToLookFor: [
      'Cloud resource inventory',
      'CSPM snapshots',
    ],
    dataSource: 'Cloud Service',
    platforms: ['IaaS'],
  },

  'Cloud Service Modification': {
    dcId: 'DC0069',
    name: 'Cloud Service Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_SERVICE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'service modified',
      'change details',
    ],
    defaultMutableElements: [
      'request IDs',
      'resource ARNs',
      'config deltas',
    ],
    logSourcesToLookFor: [
      'CloudTrail (Update*/Modify*/Put*)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Service',
    platforms: ['IaaS'],
  },

  'Cloud Service Disable': {
    dcId: 'DC0091',
    name: 'Cloud Service Disable',
    channel: CHANNEL_CATEGORIES.CLOUD_SERVICE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'service disabled',
      'outcome',
    ],
    defaultMutableElements: [
      'request IDs',
      'resource ARNs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (Disable*/Stop*)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Service',
    platforms: ['IaaS'],
  },

  'Instance Creation': {
    dcId: 'DC0075',
    name: 'Instance Creation',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'instance ID',
      'instance type',
      'configuration',
    ],
    defaultMutableElements: [
      'instance IDs',
      'request IDs',
      'AMI/image IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (RunInstances)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  'Instance Modification': {
    dcId: 'DC0076',
    name: 'Instance Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'instance modified',
      'change details',
    ],
    defaultMutableElements: [
      'instance IDs',
      'config changes',
    ],
    logSourcesToLookFor: [
      'CloudTrail (ModifyInstance*)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  'Instance Start': {
    dcId: 'DC0077',
    name: 'Instance Start',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'instance ID',
      'outcome',
    ],
    defaultMutableElements: [
      'instance IDs',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (StartInstances)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  'Instance Stop': {
    dcId: 'DC0081',
    name: 'Instance Stop',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'instance ID',
      'outcome',
    ],
    defaultMutableElements: [
      'instance IDs',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (StopInstances)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  'Instance Deletion': {
    dcId: 'DC0080',
    name: 'Instance Deletion',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'instance ID',
      'outcome',
    ],
    defaultMutableElements: [
      'instance IDs',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (TerminateInstances)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  'Instance Enumeration': {
    dcId: 'DC0083',
    name: 'Instance Enumeration',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
    ],
    defaultMutableElements: [
      'pagination tokens',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DescribeInstances)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  'Instance Metadata': {
    dcId: 'DC0086',
    name: 'Instance Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'instance ID',
      'configuration',
      'network info',
      'tags',
    ],
    defaultMutableElements: [
      'instance IDs',
      'config values',
      'IP addresses',
    ],
    logSourcesToLookFor: [
      'Cloud instance inventory',
      'CSPM snapshots',
    ],
    dataSource: 'Instance',
    platforms: ['IaaS'],
  },

  // Cloud Storage
  'Cloud Storage Creation': {
    dcId: 'DC0093',
    name: 'Cloud Storage Creation',
    channel: CHANNEL_CATEGORIES.CLOUD_STORAGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'bucket/container name',
      'configuration',
    ],
    defaultMutableElements: [
      'bucket names',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (CreateBucket)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Storage',
    platforms: ['IaaS'],
  },

  'Cloud Storage Modification': {
    dcId: 'DC0094',
    name: 'Cloud Storage Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_STORAGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'bucket modified',
      'change details (ACL/policy)',
    ],
    defaultMutableElements: [
      'bucket names',
      'policy changes',
    ],
    logSourcesToLookFor: [
      'CloudTrail (PutBucket*)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Storage',
    platforms: ['IaaS'],
  },

  'Cloud Storage Deletion': {
    dcId: 'DC0095',
    name: 'Cloud Storage Deletion',
    channel: CHANNEL_CATEGORIES.CLOUD_STORAGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'bucket/object deleted',
    ],
    defaultMutableElements: [
      'bucket names',
      'object keys',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DeleteBucket/DeleteObject)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Storage',
    platforms: ['IaaS'],
  },

  'Cloud Storage Enumeration': {
    dcId: 'DC0096',
    name: 'Cloud Storage Enumeration',
    channel: CHANNEL_CATEGORIES.CLOUD_STORAGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
    ],
    defaultMutableElements: [
      'pagination tokens',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (ListBuckets/ListObjects)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Cloud Storage',
    platforms: ['IaaS'],
  },

  'Cloud Storage Access': {
    dcId: 'DC0097',
    name: 'Cloud Storage Access',
    channel: CHANNEL_CATEGORIES.CLOUD_STORAGE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'object accessed',
      'access type',
    ],
    defaultMutableElements: [
      'object keys',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'S3 Data Events (GetObject)',
      'Azure Storage logs',
      'GCP Cloud Storage logs',
    ],
    dataSource: 'Cloud Storage',
    platforms: ['IaaS', 'Office Suite'],
  },

  'Cloud Storage Metadata': {
    dcId: 'DC0098',
    name: 'Cloud Storage Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_STORAGE,
    expectedCoreFields: [
      'bucket/object name',
      'configuration',
      'ACL/permissions',
    ],
    defaultMutableElements: [
      'bucket names',
      'config values',
    ],
    logSourcesToLookFor: [
      'Cloud storage inventory',
      'CSPM snapshots',
    ],
    dataSource: 'Cloud Storage',
    platforms: ['IaaS', 'Office Suite'],
  },

  // Firewall
  'Firewall Disable': {
    dcId: 'DC0100',
    name: 'Firewall Disable',
    channel: CHANNEL_CATEGORIES.CLOUD_FIREWALL,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'firewall/security group',
      'disable action',
    ],
    defaultMutableElements: [
      'resource IDs',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DeleteSecurityGroup)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Firewall',
    platforms: ['IaaS', 'Network Devices'],
  },

  'Firewall Enumeration': {
    dcId: 'DC0101',
    name: 'Firewall Enumeration',
    channel: CHANNEL_CATEGORIES.CLOUD_FIREWALL,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
    ],
    defaultMutableElements: [
      'pagination tokens',
      'request IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DescribeSecurityGroups)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Firewall',
    platforms: ['IaaS', 'Network Devices'],
  },

  'Firewall Metadata': {
    dcId: 'DC0103',
    name: 'Firewall Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_FIREWALL,
    expectedCoreFields: [
      'firewall/security group ID',
      'rules',
      'associated resources',
    ],
    defaultMutableElements: [
      'rule sets',
      'resource associations',
    ],
    logSourcesToLookFor: [
      'Security group inventory',
      'CSPM snapshots',
    ],
    dataSource: 'Firewall',
    platforms: ['IaaS', 'Network Devices'],
  },

  'Firewall Rule Modification': {
    dcId: 'DC0102',
    name: 'Firewall Rule Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_FIREWALL,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'firewall/security group',
      'rule changes',
    ],
    defaultMutableElements: [
      'rule IDs',
      'IP ranges',
      'port ranges',
    ],
    logSourcesToLookFor: [
      'CloudTrail (AuthorizeSecurityGroup*/RevokeSecurityGroup*)',
      'Azure Activity Log',
      'GCP Cloud Audit Logs',
    ],
    dataSource: 'Firewall',
    platforms: ['IaaS', 'Network Devices'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTAINERS
  // ═══════════════════════════════════════════════════════════════════════════

  'Container Creation': {
    dcId: 'DC0057',
    name: 'Container Creation',
    channel: CHANNEL_CATEGORIES.CONTAINER_LIFECYCLE,
    expectedCoreFields: [
      'container ID',
      'timestamp',
      'image',
      'configuration',
    ],
    defaultMutableElements: [
      'container IDs',
      'image digests',
    ],
    logSourcesToLookFor: [
      'Docker daemon logs',
      'Kubernetes audit logs',
      'Container runtime logs',
    ],
    dataSource: 'Container',
    platforms: ['Containers'],
  },

  'Container Start': {
    dcId: 'DC0058',
    name: 'Container Start',
    channel: CHANNEL_CATEGORIES.CONTAINER_LIFECYCLE,
    expectedCoreFields: [
      'container ID',
      'timestamp',
      'outcome',
    ],
    defaultMutableElements: [
      'container IDs',
    ],
    logSourcesToLookFor: [
      'Docker daemon logs',
      'Kubernetes audit logs',
    ],
    dataSource: 'Container',
    platforms: ['Containers'],
  },

  'Container Enumeration': {
    dcId: 'DC0062',
    name: 'Container Enumeration',
    channel: CHANNEL_CATEGORIES.CONTAINER_LIFECYCLE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
    ],
    defaultMutableElements: [
      'namespace',
      'label selectors',
    ],
    logSourcesToLookFor: [
      'Kubernetes audit logs',
      'Docker API logs',
    ],
    dataSource: 'Container',
    platforms: ['Containers'],
  },

  'Pod Creation': {
    dcId: 'DC0072',
    name: 'Pod Creation',
    channel: CHANNEL_CATEGORIES.POD_LIFECYCLE,
    expectedCoreFields: [
      'pod name',
      'namespace',
      'timestamp',
      'spec',
    ],
    defaultMutableElements: [
      'pod names',
      'UIDs',
    ],
    logSourcesToLookFor: [
      'Kubernetes audit logs',
    ],
    dataSource: 'Pod',
    platforms: ['Containers'],
  },

  'Pod Modification': {
    dcId: 'DC0073',
    name: 'Pod Modification',
    channel: CHANNEL_CATEGORIES.POD_LIFECYCLE,
    expectedCoreFields: [
      'pod name',
      'namespace',
      'timestamp',
      'changes',
    ],
    defaultMutableElements: [
      'pod names',
      'spec changes',
    ],
    logSourcesToLookFor: [
      'Kubernetes audit logs',
    ],
    dataSource: 'Pod',
    platforms: ['Containers'],
  },

  'Pod Enumeration': {
    dcId: 'DC0109',
    name: 'Pod Enumeration',
    channel: CHANNEL_CATEGORIES.POD_LIFECYCLE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'namespace',
      'query/list action',
    ],
    defaultMutableElements: [
      'namespace',
      'label selectors',
    ],
    logSourcesToLookFor: [
      'Kubernetes audit logs',
    ],
    dataSource: 'Pod',
    platforms: ['Containers'],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ENRICHMENT / EXTERNAL INTEL
  // ═══════════════════════════════════════════════════════════════════════════

  'Active DNS': {
    dcId: 'DC0103',
    name: 'Active DNS',
    channel: CHANNEL_CATEGORIES.DNS_INTEL,
    expectedCoreFields: [
      'query domain',
      'timestamp',
      'response records',
    ],
    defaultMutableElements: [
      'IP addresses',
      'TTL values',
    ],
    logSourcesToLookFor: [
      'Active DNS scanning services',
      'DNS enumeration tools',
    ],
    dataSource: 'Domain Name',
    platforms: ['None'],
  },

  'Passive DNS': {
    dcId: 'DC0096',
    name: 'Passive DNS',
    channel: CHANNEL_CATEGORIES.DNS_INTEL,
    expectedCoreFields: [
      'domain',
      'first/last seen',
      'historical records',
    ],
    defaultMutableElements: [
      'IP addresses',
      'record types',
    ],
    logSourcesToLookFor: [
      'Passive DNS feeds',
      'Threat intel platforms',
    ],
    dataSource: 'Domain Name',
    platforms: ['None'],
  },

  'Domain Registration': {
    dcId: 'DC0101',
    name: 'Domain Registration',
    channel: CHANNEL_CATEGORIES.DOMAIN_INTEL,
    expectedCoreFields: [
      'domain name',
      'registrar',
      'registration date',
      'registrant info',
    ],
    defaultMutableElements: [
      'registrant details',
      'nameservers',
    ],
    logSourcesToLookFor: [
      'WHOIS queries',
      'Domain intel feeds',
    ],
    dataSource: 'Domain Name',
    platforms: ['None'],
  },

  'Certificate Registration': {
    dcId: 'DC0093',
    name: 'Certificate Registration',
    channel: CHANNEL_CATEGORIES.CERT_INTEL,
    expectedCoreFields: [
      'certificate subject',
      'issuer',
      'validity dates',
      'fingerprint',
    ],
    defaultMutableElements: [
      'serial numbers',
      'fingerprints',
    ],
    logSourcesToLookFor: [
      'Certificate Transparency logs',
      'Cert intel feeds',
    ],
    dataSource: 'Certificate',
    platforms: ['None'],
  },

  'Response Metadata': {
    dcId: 'DC0106',
    name: 'Response Metadata',
    channel: CHANNEL_CATEGORIES.SCAN_RESPONSE,
    expectedCoreFields: [
      'target IP/port',
      'timestamp',
      'open ports/services',
      'versions',
    ],
    defaultMutableElements: [
      'scan IDs',
      'target addresses',
    ],
    logSourcesToLookFor: [
      'Vulnerability scanner exports',
      'Shodan/Censys data',
      'Port scan results',
    ],
    dataSource: 'Internet Scan',
    platforms: ['None'],
  },

  'Response Content': {
    dcId: 'DC0104',
    name: 'Response Content',
    channel: CHANNEL_CATEGORIES.SCAN_RESPONSE,
    expectedCoreFields: [
      'target',
      'timestamp',
      'banner content',
      'response body',
    ],
    defaultMutableElements: [
      'banner text',
      'body content',
    ],
    logSourcesToLookFor: [
      'Banner grab tools',
      'Web scrapers',
      'Vulnerability scanner details',
    ],
    dataSource: 'Internet Scan',
    platforms: ['None'],
  },

  'Social Media': {
    dcId: 'DC0107',
    name: 'Social Media',
    channel: CHANNEL_CATEGORIES.SOCIAL_INTEL,
    expectedCoreFields: [
      'platform',
      'timestamp',
      'content/post',
      'author',
    ],
    defaultMutableElements: [
      'post IDs',
      'author handles',
    ],
    logSourcesToLookFor: [
      'Social media APIs',
      'OSINT platforms',
    ],
    dataSource: 'Social Media',
    platforms: ['None'],
  },

  'Email File': {
    dcId: 'DC0108',
    name: 'Email File',
    channel: CHANNEL_CATEGORIES.EMAIL_TELEMETRY,
    expectedCoreFields: [
      'attachment name',
      'timestamp',
      'sender/recipient',
      'hash',
    ],
    defaultMutableElements: [
      'message IDs',
      'attachment hashes',
    ],
    logSourcesToLookFor: [
      'Email gateway logs',
      'O365/Google Workspace DLP',
      'Email security platforms',
    ],
    dataSource: 'Email',
    platforms: ['Office Suite'],
  },

  // Snapshots & Volumes (IaaS/ESXi)
  'Snapshot Creation': {
    dcId: 'DC0110',
    name: 'Snapshot Creation',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'snapshot ID',
      'timestamp',
      'source volume/instance',
      'actor',
    ],
    defaultMutableElements: [
      'snapshot IDs',
      'volume IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (CreateSnapshot)',
      'vSphere events',
    ],
    dataSource: 'Snapshot',
    platforms: ['IaaS', 'ESXi'],
  },

  'Snapshot Modification': {
    dcId: 'DC0111',
    name: 'Snapshot Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'snapshot ID',
      'timestamp',
      'changes',
    ],
    defaultMutableElements: [
      'snapshot IDs',
      'attribute changes',
    ],
    logSourcesToLookFor: [
      'CloudTrail (ModifySnapshotAttribute)',
      'vSphere events',
    ],
    dataSource: 'Snapshot',
    platforms: ['IaaS', 'ESXi'],
  },

  'Snapshot Deletion': {
    dcId: 'DC0112',
    name: 'Snapshot Deletion',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'snapshot ID',
      'timestamp',
      'actor',
    ],
    defaultMutableElements: [
      'snapshot IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DeleteSnapshot)',
      'vSphere events',
    ],
    dataSource: 'Snapshot',
    platforms: ['IaaS', 'ESXi'],
  },

  'Snapshot Enumeration': {
    dcId: 'DC0113',
    name: 'Snapshot Enumeration',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
    ],
    defaultMutableElements: [
      'pagination tokens',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DescribeSnapshots)',
      'vSphere events',
    ],
    dataSource: 'Snapshot',
    platforms: ['IaaS', 'ESXi'],
  },

  'Snapshot Metadata': {
    dcId: 'DC0114',
    name: 'Snapshot Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'snapshot ID',
      'source',
      'size',
      'encryption state',
    ],
    defaultMutableElements: [
      'snapshot IDs',
      'tags',
    ],
    logSourcesToLookFor: [
      'Cloud snapshot inventory',
    ],
    dataSource: 'Snapshot',
    platforms: ['IaaS', 'ESXi'],
  },

  'Volume Creation': {
    dcId: 'DC0115',
    name: 'Volume Creation',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'volume ID',
      'timestamp',
      'size/type',
      'actor',
    ],
    defaultMutableElements: [
      'volume IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (CreateVolume)',
      'vSphere events',
    ],
    dataSource: 'Volume',
    platforms: ['IaaS', 'ESXi'],
  },

  'Volume Modification': {
    dcId: 'DC0116',
    name: 'Volume Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'volume ID',
      'timestamp',
      'changes',
    ],
    defaultMutableElements: [
      'volume IDs',
      'size changes',
    ],
    logSourcesToLookFor: [
      'CloudTrail (ModifyVolume)',
      'vSphere events',
    ],
    dataSource: 'Volume',
    platforms: ['IaaS', 'ESXi'],
  },

  'Volume Deletion': {
    dcId: 'DC0117',
    name: 'Volume Deletion',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'volume ID',
      'timestamp',
      'actor',
    ],
    defaultMutableElements: [
      'volume IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DeleteVolume)',
      'vSphere events',
    ],
    dataSource: 'Volume',
    platforms: ['IaaS', 'ESXi'],
  },

  'Volume Enumeration': {
    dcId: 'DC0118',
    name: 'Volume Enumeration',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'actor',
      'timestamp',
      'query/list action',
    ],
    defaultMutableElements: [
      'pagination tokens',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DescribeVolumes)',
      'vSphere events',
    ],
    dataSource: 'Volume',
    platforms: ['IaaS', 'ESXi'],
  },

  'Volume Metadata': {
    dcId: 'DC0119',
    name: 'Volume Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'volume ID',
      'type',
      'size',
      'attachments',
    ],
    defaultMutableElements: [
      'volume IDs',
      'attachment states',
    ],
    logSourcesToLookFor: [
      'Cloud volume inventory',
    ],
    dataSource: 'Volume',
    platforms: ['IaaS', 'ESXi'],
  },

  'Image Creation': {
    dcId: 'DC0120',
    name: 'Image Creation',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'image ID',
      'timestamp',
      'source',
      'actor',
    ],
    defaultMutableElements: [
      'image IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (CreateImage)',
      'Container registry logs',
    ],
    dataSource: 'Image',
    platforms: ['IaaS', 'Containers'],
  },

  'Image Modification': {
    dcId: 'DC0121',
    name: 'Image Modification',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'image ID',
      'timestamp',
      'changes',
    ],
    defaultMutableElements: [
      'image IDs',
      'permission changes',
    ],
    logSourcesToLookFor: [
      'CloudTrail (ModifyImageAttribute)',
      'Container registry logs',
    ],
    dataSource: 'Image',
    platforms: ['IaaS', 'Containers'],
  },

  'Image Deletion': {
    dcId: 'DC0122',
    name: 'Image Deletion',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'image ID',
      'timestamp',
      'actor',
    ],
    defaultMutableElements: [
      'image IDs',
    ],
    logSourcesToLookFor: [
      'CloudTrail (DeregisterImage)',
      'Container registry logs',
    ],
    dataSource: 'Image',
    platforms: ['IaaS', 'Containers'],
  },

  'Image Metadata': {
    dcId: 'DC0123',
    name: 'Image Metadata',
    channel: CHANNEL_CATEGORIES.CLOUD_INSTANCE,
    expectedCoreFields: [
      'image ID',
      'creation date',
      'architecture',
      'permissions',
    ],
    defaultMutableElements: [
      'image IDs',
      'tags',
    ],
    logSourcesToLookFor: [
      'Cloud image inventory',
      'Container registry inventory',
    ],
    dataSource: 'Image',
    platforms: ['IaaS', 'Containers'],
  },
};

/**
 * Fast lookup by DC ID for requirement resolution
 */
const ANALYTIC_REQUIREMENTS_BY_ID = new Map<string, AnalyticRequirement>(
  Object.values(DC_ANALYTIC_REQUIREMENTS).map(requirement => [
    requirement.dcId.toLowerCase(),
    requirement,
  ])
);

/**
 * Helper function to get analytic requirement by DC name or ID
 */
export function getAnalyticRequirement(dcNameOrId: string): AnalyticRequirement | undefined {
  const direct = DC_ANALYTIC_REQUIREMENTS[dcNameOrId];
  if (direct) return direct;
  return ANALYTIC_REQUIREMENTS_BY_ID.get(dcNameOrId.toLowerCase());
}

/**
 * Helper function to get all requirements for a list of DC names or IDs
 */
export function getAnalyticRequirements(dcNames: string[]): AnalyticRequirement[] {
  return dcNames
    .map(name => getAnalyticRequirement(name))
    .filter((req): req is AnalyticRequirement => req !== undefined);
}

/**
 * Get all DC names grouped by channel
 */
export function getDCsByChannel(): Record<string, string[]> {
  const byChannel: Record<string, string[]> = {};

  for (const [dcName, req] of Object.entries(DC_ANALYTIC_REQUIREMENTS)) {
    if (!byChannel[req.channel]) {
      byChannel[req.channel] = [];
    }
    byChannel[req.channel].push(dcName);
  }

  return byChannel;
}

/**
 * Get all DC names for a specific platform
 */
export function getDCsForPlatform(platform: string): string[] {
  return Object.entries(DC_ANALYTIC_REQUIREMENTS)
    .filter(([_, req]) => Array.isArray(req.platforms) && platformMatchesAny(req.platforms, [platform]))
    .map(([dcName]) => dcName);
}
