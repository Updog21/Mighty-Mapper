export interface WizardQuestion {
  id: string;
  text: string;
  dcNames: string[];
  requiredFields?: string[];
  advanced?: boolean;
}

export interface WizardQuestionCategory {
  id: string;
  label: string;
  description?: string;
  questions: WizardQuestion[];
}

export interface WizardQuestionSet {
  id: string;
  label: string;
  description: string;
  categories: WizardQuestionCategory[];
}

const identityQuestions = (prefix: string): WizardQuestion[] => [
  {
    id: `${prefix}-auth`,
    text: 'Does the data source record authentication attempts (success/failure) for accounts accessing a system/resource?',
    dcNames: ['User Account Authentication'],
  },
  {
    id: `${prefix}-session-create`,
    text: 'Does it record successful session establishment?',
    dcNames: ['Logon Session Creation'],
  },
  {
    id: `${prefix}-session-meta`,
    text: 'Does it record session context (device/IP/session IDs/risk context)?',
    dcNames: ['Logon Session Metadata'],
  },
  {
    id: `${prefix}-account-lifecycle`,
    text: 'Does it record account lifecycle changes (create/modify/delete) and account metadata?',
    dcNames: [
      'User Account Creation',
      'User Account Modification',
      'User Account Deletion',
      'User Account Metadata',
    ],
  },
  {
    id: `${prefix}-group-lifecycle`,
    text: 'Does it record group/role changes, enumeration, or metadata?',
    dcNames: ['Group Modification', 'Group Enumeration', 'Group Metadata'],
  },
];

export const WIZARD_QUESTION_SETS: Record<string, WizardQuestionSet> = {
  Windows: {
    id: 'Windows',
    label: 'Windows',
    description: 'Windows OS telemetry, Sysmon, and Windows EDR sources.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Authentication, sessions, accounts, and groups.',
        questions: [
          ...identityQuestions('windows'),
          {
            id: 'windows-ad-objects',
            text: 'Does it record Active Directory credential requests and AD object access/changes?',
            dcNames: [
              'Active Directory Credential Request',
              'Active Directory Object Access',
              'Active Directory Object Creation',
              'Active Directory Object Modification',
              'Active Directory Object Deletion',
            ],
            advanced: true,
          },
        ],
      },
      {
        id: 'execution',
        label: 'Execution',
        description: 'Process and command execution telemetry.',
        questions: [
          {
            id: 'windows-process',
            text: 'Does it record process start/stop and process context?',
            dcNames: ['Process Creation', 'Process Termination', 'Process Metadata'],
          },
          {
            id: 'windows-command',
            text: 'Does it record command execution?',
            dcNames: ['Command Execution'],
          },
          {
            id: 'windows-script',
            text: 'Does it record script execution?',
            dcNames: ['Script Execution'],
          },
        ],
      },
      {
        id: 'persistence-config',
        label: 'Persistence & configuration',
        description: 'Service, registry, and scheduled job changes.',
        questions: [
          {
            id: 'windows-scheduled',
            text: 'Does it record scheduled job/task creation or modification?',
            dcNames: ['Scheduled Job Creation', 'Scheduled Job Modification', 'Scheduled Job Metadata'],
          },
          {
            id: 'windows-service',
            text: 'Does it record service creation/modification and service metadata?',
            dcNames: ['Service Creation', 'Service Modification', 'Service Metadata'],
          },
          {
            id: 'windows-registry',
            text: 'Does it record Windows Registry access/creation/modification/deletion?',
            dcNames: [
              'Windows Registry Key Access',
              'Windows Registry Key Creation',
              'Windows Registry Key Modification',
              'Windows Registry Key Deletion',
            ],
          },
        ],
      },
      {
        id: 'data-plane',
        label: 'Data plane activity',
        description: 'File and network activity telemetry.',
        questions: [
          {
            id: 'windows-files',
            text: 'Does it record file create/modify/delete/access plus file metadata?',
            dcNames: ['File Creation', 'File Modification', 'File Deletion', 'File Access', 'File Metadata'],
          },
          {
            id: 'windows-drives',
            text: 'Does it record drive/mount creation/access/modification events?',
            dcNames: ['Drive Creation', 'Drive Access', 'Drive Modification'],
            advanced: true,
          },
          {
            id: 'windows-network',
            text: 'Does it record network connection/flow/content telemetry from the host?',
            dcNames: ['Network Connection Creation', 'Network Traffic Flow', 'Network Traffic Content'],
          },
          {
            id: 'windows-share',
            text: 'Does it record network share access?',
            dcNames: ['Network Share Access'],
          },
          {
            id: 'windows-app',
            text: 'Does it produce application audit logs for services hosted on Windows?',
            dcNames: ['Application Log Content'],
          },
        ],
      },
      {
        id: 'findings',
        label: 'Security product findings',
        description: 'Findings or alert-style telemetry (EDR/AV detections).',
        questions: [
          {
            id: 'windows-findings',
            text: 'Does it emit security findings or alerts (not raw telemetry)?',
            dcNames: ['Application Log Content'],
          },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        description: 'Optional signals for specialized detections.',
        questions: [
          {
            id: 'windows-wmi',
            text: 'Does it record WMI object creation or filters/consumers?',
            dcNames: ['WMI Creation'],
            advanced: true,
          },
          {
            id: 'windows-module',
            text: 'Does it record module/library loads (DLL load visibility)?',
            dcNames: ['Module Load'],
            advanced: true,
          },
          {
            id: 'windows-process-access',
            text: 'Does it record process access or process modification signals?',
            dcNames: ['Process Access', 'Process Modification'],
            advanced: true,
          },
          {
            id: 'windows-named-pipe',
            text: 'Does it record named pipe metadata?',
            dcNames: ['Named Pipe Metadata'],
            advanced: true,
          },
          {
            id: 'windows-drivers',
            text: 'Does it record driver load and driver metadata?',
            dcNames: ['Driver Load', 'Driver Metadata'],
            advanced: true,
          },
          {
            id: 'windows-kernel',
            text: 'Does it record kernel module load or firmware modification signals?',
            dcNames: ['Kernel Module Load', 'Firmware Modification'],
            advanced: true,
          },
          {
            id: 'windows-os-api',
            text: 'Does it record OS API execution signals?',
            dcNames: ['OS API Execution'],
            advanced: true,
          },
          {
            id: 'windows-web-cred',
            text: 'Does it record web credential creation or usage (Kerberos tickets/tokens)?',
            dcNames: ['Web Credential Creation', 'Web Credential Usage'],
            advanced: true,
          },
          {
            id: 'windows-malware',
            text: 'Does it store malware artifacts/metadata (quarantine or sandbox)?',
            dcNames: ['Malware Content', 'Malware Metadata'],
            advanced: true,
          },
          {
            id: 'windows-host-status',
            text: 'Does it record host sensor health or tamper status?',
            dcNames: ['Host Status'],
            advanced: true,
          },
        ],
      },
    ],
  },
  Linux: {
    id: 'Linux',
    label: 'Linux',
    description: 'Linux OS telemetry and Linux EDR sources.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Authentication, sessions, accounts, and groups.',
        questions: identityQuestions('linux'),
      },
      {
        id: 'execution',
        label: 'Execution',
        description: 'Process and command execution telemetry.',
        questions: [
          {
            id: 'linux-process',
            text: 'Does it record process start/stop and process metadata?',
            dcNames: ['Process Creation', 'Process Termination', 'Process Metadata'],
          },
          {
            id: 'linux-command',
            text: 'Does it record command execution?',
            dcNames: ['Command Execution'],
          },
          {
            id: 'linux-script',
            text: 'Does it record script execution?',
            dcNames: ['Script Execution'],
          },
        ],
      },
      {
        id: 'persistence-config',
        label: 'Persistence & configuration',
        description: 'Service and scheduled job changes.',
        questions: [
          {
            id: 'linux-service',
            text: 'Does it record service/daemon creation or modification?',
            dcNames: ['Service Creation', 'Service Modification', 'Service Metadata'],
          },
          {
            id: 'linux-scheduled',
            text: 'Does it record scheduled job creation/modification?',
            dcNames: ['Scheduled Job Creation', 'Scheduled Job Modification', 'Scheduled Job Metadata'],
          },
        ],
      },
      {
        id: 'data-plane',
        label: 'Data plane activity',
        description: 'File and network activity telemetry.',
        questions: [
          {
            id: 'linux-files',
            text: 'Does it record file create/modify/delete/access plus file metadata?',
            dcNames: ['File Creation', 'File Modification', 'File Deletion', 'File Access', 'File Metadata'],
          },
          {
            id: 'linux-drives',
            text: 'Does it record drive/mount creation/access/modification events?',
            dcNames: ['Drive Creation', 'Drive Access', 'Drive Modification'],
            advanced: true,
          },
          {
            id: 'linux-network',
            text: 'Does it record network connection/flow/content telemetry from the host?',
            dcNames: ['Network Connection Creation', 'Network Traffic Flow', 'Network Traffic Content'],
          },
          {
            id: 'linux-app',
            text: 'Does it produce application audit logs for services hosted on Linux?',
            dcNames: ['Application Log Content'],
          },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        description: 'Optional signals for specialized detections.',
        questions: [
          {
            id: 'linux-process-access',
            text: 'Does it record process access or process modification signals?',
            dcNames: ['Process Access', 'Process Modification'],
            advanced: true,
          },
          {
            id: 'linux-os-api',
            text: 'Does it record OS API execution signals?',
            dcNames: ['OS API Execution'],
            advanced: true,
          },
          {
            id: 'linux-kernel',
            text: 'Does it record kernel module load or firmware modification signals?',
            dcNames: ['Kernel Module Load', 'Firmware Modification'],
            advanced: true,
          },
          {
            id: 'linux-malware',
            text: 'Does it store malware artifacts/metadata (quarantine or sandbox)?',
            dcNames: ['Malware Content', 'Malware Metadata'],
            advanced: true,
          },
          {
            id: 'linux-host-status',
            text: 'Does it record host sensor health or tamper status?',
            dcNames: ['Host Status'],
            advanced: true,
          },
        ],
      },
    ],
  },
  macOS: {
    id: 'macOS',
    label: 'macOS',
    description: 'macOS endpoint telemetry and EDR sources.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Authentication and sessions.',
        questions: identityQuestions('macos'),
      },
      {
        id: 'execution',
        label: 'Execution',
        description: 'Process and command execution telemetry.',
        questions: [
          {
            id: 'macos-process',
            text: 'Does it record process start/stop and process metadata?',
            dcNames: ['Process Creation', 'Process Termination', 'Process Metadata'],
          },
          {
            id: 'macos-command',
            text: 'Does it record command execution?',
            dcNames: ['Command Execution'],
          },
          {
            id: 'macos-script',
            text: 'Does it record script execution?',
            dcNames: ['Script Execution'],
          },
        ],
      },
      {
        id: 'data-plane',
        label: 'Data plane activity',
        description: 'File and network activity telemetry.',
        questions: [
          {
            id: 'macos-files',
            text: 'Does it record file create/modify/delete/access plus file metadata?',
            dcNames: ['File Creation', 'File Modification', 'File Deletion', 'File Access', 'File Metadata'],
          },
          {
            id: 'macos-network',
            text: 'Does it record network connection/flow/content telemetry from the host?',
            dcNames: ['Network Connection Creation', 'Network Traffic Flow', 'Network Traffic Content'],
          },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        description: 'Optional signals for specialized detections.',
        questions: [
          {
            id: 'macos-module',
            text: 'Does it record module/library loads?',
            dcNames: ['Module Load'],
            advanced: true,
          },
          {
            id: 'macos-process-access',
            text: 'Does it record process access or process modification signals?',
            dcNames: ['Process Access', 'Process Modification'],
            advanced: true,
          },
          {
            id: 'macos-os-api',
            text: 'Does it record OS API execution signals?',
            dcNames: ['OS API Execution'],
            advanced: true,
          },
          {
            id: 'macos-malware',
            text: 'Does it store malware artifacts/metadata (quarantine or sandbox)?',
            dcNames: ['Malware Content', 'Malware Metadata'],
            advanced: true,
          },
          {
            id: 'macos-host-status',
            text: 'Does it record host sensor health or tamper status?',
            dcNames: ['Host Status'],
            advanced: true,
          },
        ],
      },
    ],
  },
  'Identity Provider': {
    id: 'Identity Provider',
    label: 'Identity Provider',
    description: 'Centralized authentication and identity services.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Authentication, sessions, accounts, and groups.',
        questions: [
          ...identityQuestions('idp'),
          {
            id: 'idp-web-credential',
            text: 'Does it record web credential creation or usage (tokens/tickets)?',
            dcNames: ['Web Credential Creation', 'Web Credential Usage'],
          },
        ],
      },
      {
        id: 'findings',
        label: 'Security product findings',
        description: 'Findings or alert-style telemetry.',
        questions: [
          {
            id: 'idp-findings',
            text: 'Does it emit security findings or alerts?',
            dcNames: ['Application Log Content'],
          },
        ],
      },
    ],
  },
  SaaS: {
    id: 'SaaS',
    label: 'SaaS',
    description: 'SaaS application audit and telemetry sources.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Authentication and account lifecycle events (if present).',
        questions: [
          ...identityQuestions('saas'),
          {
            id: 'saas-web-credential',
            text: 'Does it record web credential creation or usage (tokens/tickets)?',
            dcNames: ['Web Credential Creation', 'Web Credential Usage'],
            advanced: true,
          },
        ],
      },
      {
        id: 'data-plane',
        label: 'Data plane activity',
        description: 'Application audit and API activity.',
        questions: [
          {
            id: 'saas-app-logs',
            text: 'Does it provide application audit logs for user/admin actions?',
            dcNames: ['Application Log Content'],
          },
          {
            id: 'saas-api',
            text: 'Does it record API request activity?',
            dcNames: ['API Request'],
          },
        ],
      },
      {
        id: 'persistence-config',
        label: 'Persistence & configuration',
        description: 'Configuration or policy changes.',
        questions: [
          {
            id: 'saas-config',
            text: 'Does it record configuration or policy modifications?',
            dcNames: ['Configuration Modification'],
          },
        ],
      },
      {
        id: 'findings',
        label: 'Security product findings',
        description: 'Findings or alert-style telemetry.',
        questions: [
          {
            id: 'saas-findings',
            text: 'Does it emit security findings or alerts?',
            dcNames: ['Application Log Content'],
          },
        ],
      },
    ],
  },
  'Office Suite': {
    id: 'Office Suite',
    label: 'Office Suite',
    description: 'Office suite audit, email, and collaboration telemetry.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Authentication and session telemetry.',
        questions: identityQuestions('office'),
      },
      {
        id: 'data-plane',
        label: 'Data plane activity',
        description: 'Email and file activity.',
        questions: [
          {
            id: 'office-app-logs',
            text: 'Does it provide application audit logs for suite activities?',
            dcNames: ['Application Log Content'],
          },
          {
            id: 'office-email',
            text: 'Does it provide email attachment or artifact telemetry?',
            dcNames: ['Email File'],
          },
          {
            id: 'office-files',
            text: 'Does it provide file access/creation/modification/deletion and metadata?',
            dcNames: ['File Access', 'File Creation', 'File Modification', 'File Deletion', 'File Metadata'],
          },
          {
            id: 'office-cloud-storage',
            text: 'Does it provide cloud storage access/enumeration/metadata?',
            dcNames: [
              'Cloud Storage Access',
              'Cloud Storage Enumeration',
              'Cloud Storage Metadata',
              'Cloud Storage Modification',
            ],
          },
        ],
      },
      {
        id: 'persistence-config',
        label: 'Persistence & configuration',
        description: 'Configuration or policy changes.',
        questions: [
          {
            id: 'office-config',
            text: 'Does it record configuration or policy modifications?',
            dcNames: ['Configuration Modification'],
          },
        ],
      },
    ],
  },
  IaaS: {
    id: 'IaaS',
    label: 'IaaS',
    description: 'Cloud control-plane and infrastructure telemetry.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Cloud IAM authentication and account lifecycle.',
        questions: identityQuestions('iaas'),
      },
      {
        id: 'control-plane',
        label: 'Control plane changes',
        description: 'Cloud service enumeration and configuration changes.',
        questions: [
          {
            id: 'iaas-service-changes',
            text: 'Does it record cloud service enumeration/metadata/modification/disable events?',
            dcNames: [
              'Cloud Service Enumeration',
              'Cloud Service Metadata',
              'Cloud Service Modification',
              'Cloud Service Disable',
            ],
          },
          {
            id: 'iaas-firewall',
            text: 'Does it record cloud firewall/security group changes?',
            dcNames: ['Firewall Disable', 'Firewall Enumeration', 'Firewall Metadata', 'Firewall Rule Modification'],
          },
        ],
      },
      {
        id: 'instances',
        label: 'Instance lifecycle',
        description: 'Instance creation, start/stop, and metadata.',
        questions: [
          {
            id: 'iaas-instances',
            text: 'Does it record instance lifecycle operations and metadata?',
            dcNames: [
              'Instance Creation',
              'Instance Modification',
              'Instance Start',
              'Instance Stop',
              'Instance Deletion',
              'Instance Enumeration',
              'Instance Metadata',
            ],
          },
        ],
      },
      {
        id: 'storage',
        label: 'Cloud storage activity',
        description: 'Cloud storage access and lifecycle.',
        questions: [
          {
            id: 'iaas-storage',
            text: 'Does it record cloud storage create/modify/delete/enumerate/access/metadata?',
            dcNames: [
              'Cloud Storage Creation',
              'Cloud Storage Modification',
              'Cloud Storage Deletion',
              'Cloud Storage Enumeration',
              'Cloud Storage Access',
              'Cloud Storage Metadata',
            ],
          },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        description: 'Optional infrastructure lifecycle telemetry.',
        questions: [
          {
            id: 'iaas-images',
            text: 'Does it record image creation/modification/deletion and image metadata?',
            dcNames: ['Image Creation', 'Image Modification', 'Image Deletion', 'Image Metadata'],
            advanced: true,
          },
          {
            id: 'iaas-snapshots',
            text: 'Does it record snapshot lifecycle events and metadata?',
            dcNames: ['Snapshot Creation', 'Snapshot Modification', 'Snapshot Deletion', 'Snapshot Enumeration', 'Snapshot Metadata'],
            advanced: true,
          },
          {
            id: 'iaas-volumes',
            text: 'Does it record volume lifecycle events and metadata?',
            dcNames: ['Volume Creation', 'Volume Modification', 'Volume Deletion', 'Volume Enumeration', 'Volume Metadata'],
            advanced: true,
          },
        ],
      },
    ],
  },
  'Network Devices': {
    id: 'Network Devices',
    label: 'Network Devices',
    description: 'Network and edge telemetry (WAF, proxy, VPN, NDR).',
    categories: [
      {
        id: 'data-plane',
        label: 'Network telemetry',
        description: 'Connection, flow, and content telemetry.',
        questions: [
          {
            id: 'network-connection',
            text: 'Does it record network connection establishment events?',
            dcNames: ['Network Connection Creation'],
          },
          {
            id: 'network-flow',
            text: 'Does it record summarized network flow telemetry?',
            dcNames: ['Network Traffic Flow'],
          },
          {
            id: 'network-content',
            text: 'Does it record network traffic content or deep protocol metadata?',
            dcNames: ['Network Traffic Content'],
          },
          {
            id: 'network-share',
            text: 'Does it record network share access?',
            dcNames: ['Network Share Access'],
            advanced: true,
          },
        ],
      },
      {
        id: 'persistence-config',
        label: 'Security control plane',
        description: 'Firewall configuration and policy telemetry.',
        questions: [
          {
            id: 'network-firewall',
            text: 'Does it record firewall disable/enumeration/metadata/rule changes?',
            dcNames: ['Firewall Disable', 'Firewall Enumeration', 'Firewall Metadata', 'Firewall Rule Modification'],
          },
        ],
      },
    ],
  },
  Containers: {
    id: 'Containers',
    label: 'Containers',
    description: 'Container runtime and Kubernetes telemetry.',
    categories: [
      {
        id: 'execution',
        label: 'Execution',
        description: 'Process and command execution inside containers.',
        questions: [
          {
            id: 'containers-process',
            text: 'Does it record process start/stop and command execution inside containers?',
            dcNames: ['Process Creation', 'Process Termination', 'Command Execution', 'Script Execution'],
          },
        ],
      },
      {
        id: 'control-plane',
        label: 'Container control plane',
        description: 'Container and pod lifecycle telemetry.',
        questions: [
          {
            id: 'containers-lifecycle',
            text: 'Does it record container lifecycle and enumeration events?',
            dcNames: ['Container Creation', 'Container Start', 'Container Enumeration'],
          },
          {
            id: 'containers-pods',
            text: 'Does it record pod lifecycle and enumeration events?',
            dcNames: ['Pod Creation', 'Pod Modification', 'Pod Enumeration'],
          },
        ],
      },
      {
        id: 'data-plane',
        label: 'Network telemetry',
        description: 'Cluster or workload network telemetry.',
        questions: [
          {
            id: 'containers-network',
            text: 'Does it record network connection/flow/content telemetry for workloads?',
            dcNames: ['Network Connection Creation', 'Network Traffic Flow', 'Network Traffic Content'],
          },
        ],
      },
    ],
  },
  'ESXi': {
    id: 'ESXi',
    label: 'ESXi',
    description: 'Hypervisor and virtualization control-plane telemetry.',
    categories: [
      {
        id: 'identity-access',
        label: 'Identity & access',
        description: 'Management authentication and sessions.',
        questions: identityQuestions('esxi'),
      },
      {
        id: 'instances',
        label: 'Instance lifecycle',
        description: 'Virtual machine lifecycle events.',
        questions: [
          {
            id: 'esxi-instance',
            text: 'Does it record instance start/stop/modification/enumeration/metadata?',
            dcNames: ['Instance Start', 'Instance Stop', 'Instance Modification', 'Instance Enumeration', 'Instance Metadata'],
          },
          {
            id: 'esxi-snapshots',
            text: 'Does it record snapshot lifecycle and metadata?',
            dcNames: ['Snapshot Creation', 'Snapshot Modification', 'Snapshot Deletion', 'Snapshot Enumeration', 'Snapshot Metadata'],
          },
          {
            id: 'esxi-volumes',
            text: 'Does it record volume lifecycle and metadata?',
            dcNames: ['Volume Creation', 'Volume Modification', 'Volume Deletion', 'Volume Enumeration', 'Volume Metadata'],
            advanced: true,
          },
        ],
      },
    ],
  },
  None: {
    id: 'None',
    label: 'External Threat Intelligence',
    description: 'External scanning, DNS intelligence, certificates, and OSINT sources',
    categories: [
      {
        id: 'enrichment',
        label: 'Enrichment sources',
        description: 'External scanning and intelligence telemetry.',
        questions: [
          {
            id: 'enrich-active-dns',
            text: 'Does it provide active DNS intelligence?',
            dcNames: ['Active DNS'],
          },
          {
            id: 'enrich-passive-dns',
            text: 'Does it provide passive DNS intelligence?',
            dcNames: ['Passive DNS'],
          },
          {
            id: 'enrich-domain',
            text: 'Does it provide domain registration or WHOIS-style metadata?',
            dcNames: ['Domain Registration'],
          },
          {
            id: 'enrich-cert',
            text: 'Does it provide certificate registration intelligence?',
            dcNames: ['Certificate Registration'],
          },
          {
            id: 'enrich-response-meta',
            text: 'Does it provide response metadata from scanning or banners?',
            dcNames: ['Response Metadata'],
          },
          {
            id: 'enrich-response-content',
            text: 'Does it provide response content from scanning or banners?',
            dcNames: ['Response Content'],
          },
          {
            id: 'enrich-social',
            text: 'Does it provide social media or OSINT sources?',
            dcNames: ['Social Media'],
          },
        ],
      },
    ],
  },
};

export const WIZARD_CONTEXT_ALIASES: Record<string, string> = {
  'office 365': 'Office Suite',
  'google workspace': 'Office Suite',
  'azure ad': 'Identity Provider',
  'active directory': 'Identity Provider',
  'identity': 'Identity Provider',
  'saas application': 'SaaS',
  'cloud infrastructure': 'IaaS',
  'container/kubernetes': 'Containers',
  'network': 'Network Devices',
  'network / network devices': 'Network Devices',
  'network devices': 'Network Devices',
  'esxi': 'ESXi',
  'esxi / virtualization': 'ESXi',
  'enrichment': 'None',
};
