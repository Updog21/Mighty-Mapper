// Import products from dedicated products file (not auto-generated)
import { ctidProducts, searchProducts as searchProductsFn, getProductById } from './products';
import { fullMitreTechniques } from './mitreTechniquesFull';
import { platformMatchesAny } from '@shared/platforms';
import type { PlatformValue } from '@shared/platforms';
import type { Asset } from './products';

// Re-export for backwards compatibility
export { ctidProducts, getProductById };
export type { Asset };
export const searchProducts = searchProductsFn;

export interface MutableElement {
  name: string;
  description: string;
  fieldPath?: string;
}

export interface LogSource {
  name: string;
  channel: string;
}

export type PlatformLabel = PlatformValue;

export interface DataCollectionMeasure {
  platform: PlatformLabel;
  description: string;
}

export interface PlatformMapping {
  platform: PlatformLabel;
  eventSource: string;
  logSourceName: string;
  eventId?: string;
  logChannel?: string;
  notes?: string;
}

export interface DataComponentRef {
  id: string;
  name: string;
  description: string;
  dataSource: string;
  dataCollectionMeasures?: DataCollectionMeasure[];
  logSources?: LogSource[];
  mutableElements: MutableElement[];
  platforms: PlatformMapping[];
}

export interface AnalyticItem {
  id: string;
  name: string;
  description: string;
  pseudocode?: string;
  dataComponents: string[];
  platforms: PlatformLabel[];
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
  tactic: string;
  description: string;
  usedByGroups: string[];
  detectionStrategies: string[];
}

export interface MitreAsset {
  id: string;
  name: string;
  domain: string;
  description: string;
}

export const mitreAssets: Record<string, MitreAsset> = {
  'A0001': { id: 'A0001', name: 'Workstation', domain: 'ICS', description: 'Devices used by human operators or engineers to perform configuration, programming, maintenance, diagnostic, or operational tasks.' },
  'A0002': { id: 'A0002', name: 'Human-Machine Interface (HMI)', domain: 'ICS', description: 'Systems used by an operator to monitor the real-time status of an operational process and to perform necessary control functions.' },
  'A0003': { id: 'A0003', name: 'Programmable Logic Controller (PLC)', domain: 'ICS', description: 'Embedded programmable control device that allows deployment of customized programs/logic to control or monitor an operational process.' },
  'A0004': { id: 'A0004', name: 'Remote Terminal Unit (RTU)', domain: 'ICS', description: 'Device that typically resides between field devices and control/SCADA servers and supports communication interfacing and data aggregation.' },
  'A0005': { id: 'A0005', name: 'Intelligent Electronic Device (IED)', domain: 'ICS', description: 'Specialized field device designed to perform specific operational functions for protection, monitoring, or control within the electric sector.' },
  'A0006': { id: 'A0006', name: 'Data Historian', domain: 'ICS', description: 'Systems used to collect and store data including telemetry, events, alerts, and alarms about the operational process.' },
  'A0007': { id: 'A0007', name: 'Control Server', domain: 'ICS', description: 'Software platform that communicates with low-level control devices such as RTUs and PLCs using automation protocols.' },
  'A0008': { id: 'A0008', name: 'Application Server', domain: 'ICS', description: 'Servers used to host various software applications necessary to supporting the ICS including data analytics and alarm management.' },
  'A0009': { id: 'A0009', name: 'Data Gateway', domain: 'ICS', description: 'Device that supports communication and exchange of data between different systems, networks, or protocols within the ICS.' },
  'A0010': { id: 'A0010', name: 'Safety Controller', domain: 'ICS', description: 'Field device used to perform safety critical functions with redundant hardware and processors.' },
  'A0011': { id: 'A0011', name: 'Virtual Private Network (VPN) Server', domain: 'ICS', description: 'Device used to establish a secure network tunnel between itself and other remote VPN devices.' },
  'A0012': { id: 'A0012', name: 'Jump Host', domain: 'ICS', description: 'Devices used to support remote management sessions into ICS networks or devices from external networks.' },
  'A0013': { id: 'A0013', name: 'Field I/O', domain: 'ICS', description: 'Devices that communicate with a controller to send input data from sensors or receive output data for actuators.' },
  'A0014': { id: 'A0014', name: 'Routers', domain: 'ICS', description: 'A gateway between two networks at OSI layer 3 that relays and directs data packets through that inter-network.' },
  'A0015': { id: 'A0015', name: 'Switch', domain: 'ICS', description: 'Network device that connects endpoints so they can communicate and share data and resources.' },
  'A0016': { id: 'A0016', name: 'Firewall', domain: 'ICS', description: 'A gateway that limits access between networks in accordance with local security policy.' },
  'A0017': { id: 'A0017', name: 'Distributed Control System (DCS) Controller', domain: 'ICS', description: 'Microprocessor unit used to manage automation processes in large scale continuous automation.' },
  'A0018': { id: 'A0018', name: 'Programmable Automation Controller (PAC)', domain: 'ICS', description: 'Embedded programmable control device designed to enable automation applications across integrated systems.' },
  'ENT-WS': { id: 'ENT-WS', name: 'Workstation', domain: 'Enterprise', description: 'End-user computing device running desktop operating systems like Windows, macOS, or Linux.' },
  'ENT-SRV': { id: 'ENT-SRV', name: 'Server', domain: 'Enterprise', description: 'Server systems running server operating systems providing network services, applications, or infrastructure.' },
  'ENT-NET': { id: 'ENT-NET', name: 'Network Device', domain: 'Enterprise', description: 'Routers, switches, firewalls, and other network infrastructure devices.' },
  'ENT-CLOUD': { id: 'ENT-CLOUD', name: 'Cloud Service', domain: 'Enterprise', description: 'Cloud-hosted services and infrastructure including IaaS, PaaS, and SaaS.' },
  'ENT-IDM': { id: 'ENT-IDM', name: 'Identity Management', domain: 'Enterprise', description: 'Identity and access management systems including directory services and SSO platforms.' },
  'ENT-EP': { id: 'ENT-EP', name: 'Endpoint', domain: 'Enterprise', description: 'General endpoint devices including workstations, laptops, and mobile devices.' },
};

export const dataComponents: Record<string, DataComponentRef> = {
  'DC0082': {
    id: 'DC0082',
    name: 'Network Connection Creation',
    description: 'The initial establishment of a network session, where a system or process initiates a connection to a local or remote endpoint. This typically involves capturing socket information (source/destination IP, ports, protocol) and tracking session metadata. Monitoring these events helps detect lateral movement, exfiltration, and command-and-control (C2) activities.',
    dataSource: 'Network Traffic',
    dataCollectionMeasures: [
      { platform: 'Windows', description: 'Event ID 5156 – Filtering Platform Connection - Logs network connections permitted by Windows Filtering Platform (WFP). Sysmon Event ID 3 – Network Connection Initiated - Captures process, source/destination IP, ports, and parent process.' },
      { platform: 'Linux', description: 'Netfilter (iptables), nftables logs - Tracks incoming and outgoing network connections. AuditD (connect syscall) - Logs TCP, UDP, and ICMP connections. Zeek (conn.log) - Captures protocol, duration, and bytes transferred.' },
      { platform: 'macOS', description: 'Endpoint Security Framework ES_EVENT_TYPE_NOTIFY_CONNECT - Captures process initiating network connections with full metadata.' },
      { platform: 'IaaS', description: 'AWS VPC Flow Logs / Azure NSG Flow Logs - Logs IP traffic at the network level in cloud environments.' },
      { platform: 'None', description: 'Detect anomalous network activity such as new C2 connections or data exfiltration attempts.' },
    ],
    logSources: [
      { name: 'WinEventLog:Sysmon', channel: 'EventCode=3, 22' },
      { name: 'WinEventLog:Security', channel: 'EventCode=5156, 5157' },
      { name: 'WinEventLog:Microsoft-Windows-WLAN-AutoConfig', channel: 'EventCode=8001, 8002, 8003' },
      { name: 'WinEventLog:Microsoft-Windows-Bits-Client/Operational', channel: 'BITS job lifecycle events' },
      { name: 'auditd:SYSCALL', channel: 'connect' },
      { name: 'auditd:SYSCALL', channel: 'connect/sendto' },
      { name: 'auditd:SYSCALL', channel: 'socket/connect with TLS context' },
      { name: 'linux:Sysmon', channel: 'EventCode=3, 22' },
      { name: 'linux:syslog', channel: 'network' },
      { name: 'macos:endpointsecurity', channel: 'ES_EVENT_TYPE_NOTIFY_CONNECT' },
      { name: 'macos:unifiedlog', channel: 'connection attempts' },
      { name: 'macos:osquery', channel: 'process_events/socket_events' },
      { name: 'NSM:Flow', channel: 'conn.log' },
      { name: 'NSM:Flow', channel: 'Outbound connections' },
      { name: 'AWS:VPCFlowLogs', channel: 'Outbound connection to 169.254.169.254' },
      { name: 'esxi:vmkernel', channel: 'network activity' },
    ],
    mutableElements: [
      { name: 'src_ip', description: 'Source IP address of the network connection', fieldPath: 'source.ip' },
      { name: 'dst_ip', description: 'Destination IP address of the network connection', fieldPath: 'destination.ip' },
      { name: 'dst_port', description: 'Destination port number', fieldPath: 'destination.port' },
      { name: 'src_port', description: 'Source port number', fieldPath: 'source.port' },
      { name: 'protocol', description: 'Network protocol (TCP/UDP)', fieldPath: 'network.protocol' },
      { name: 'process_name', description: 'Name of process initiating connection', fieldPath: 'process.name' },
      { name: 'user', description: 'User context of process', fieldPath: 'user.name' },
    ],
    platforms: [
      { platform: 'Windows', eventSource: 'Sysmon', logSourceName: 'WinEventLog:Sysmon', eventId: '3', logChannel: 'Microsoft-Windows-Sysmon/Operational', notes: 'Network connection detected' },
      { platform: 'Windows', eventSource: 'Windows Firewall', logSourceName: 'WinEventLog:Security', eventId: '5156', logChannel: 'Security', notes: 'Windows Filtering Platform permitted connection' },
      { platform: 'Linux', eventSource: 'Auditd', logSourceName: 'auditd:SYSCALL', eventId: 'SYSCALL connect', logChannel: '/var/log/audit/audit.log' },
      { platform: 'macOS', eventSource: 'Endpoint Security', logSourceName: 'macos:endpointsecurity', eventId: 'ES_EVENT_TYPE_NOTIFY_CONNECT' },
    ]
  },
  'DC0017': {
    id: 'DC0017',
    name: 'Command Execution',
    description: 'The execution of a line of text, potentially with arguments, created from program code.',
    dataSource: 'Command',
    mutableElements: [
      { name: 'command_line', description: 'Full command line including arguments', fieldPath: 'process.command_line' },
      { name: 'process_name', description: 'Name of executing process', fieldPath: 'process.name' },
      { name: 'parent_process', description: 'Parent process name', fieldPath: 'process.parent.name' },
      { name: 'user', description: 'User executing command', fieldPath: 'user.name' },
      { name: 'working_directory', description: 'Current working directory', fieldPath: 'process.working_directory' },
    ],
    platforms: [
      { platform: 'Windows', eventSource: 'Security', logSourceName: 'WinEventLog:Security', eventId: '4688', logChannel: 'Security', notes: 'Process creation with command line auditing' },
      { platform: 'Windows', eventSource: 'Sysmon', logSourceName: 'WinEventLog:Sysmon', eventId: '1', logChannel: 'Microsoft-Windows-Sysmon/Operational', notes: 'Process creation' },
      { platform: 'Linux', eventSource: 'Auditd', logSourceName: 'auditd:EXECVE', eventId: 'EXECVE', logChannel: '/var/log/audit/audit.log' },
      { platform: 'macOS', eventSource: 'Endpoint Security', logSourceName: 'endpointsecurity:exec', eventId: 'ES_EVENT_TYPE_NOTIFY_EXEC' },
    ]
  },
  'DC0005': {
    id: 'DC0005',
    name: 'Process Creation',
    description: 'The initial creation of a new process, typically by another process.',
    dataSource: 'Process',
    mutableElements: [
      { name: 'process_id', description: 'Process ID', fieldPath: 'process.pid' },
      { name: 'process_name', description: 'Process executable name', fieldPath: 'process.name' },
      { name: 'process_path', description: 'Full path to executable', fieldPath: 'process.executable' },
      { name: 'command_line', description: 'Full command line', fieldPath: 'process.command_line' },
      { name: 'parent_process_id', description: 'Parent process ID', fieldPath: 'process.parent.pid' },
      { name: 'parent_process_name', description: 'Parent process name', fieldPath: 'process.parent.name' },
      { name: 'user', description: 'User account', fieldPath: 'user.name' },
      { name: 'integrity_level', description: 'Process integrity level', fieldPath: 'process.integrity_level' },
      { name: 'hashes', description: 'File hashes (MD5, SHA1, SHA256)', fieldPath: 'file.hash.*' },
    ],
    platforms: [
      { platform: 'Windows', eventSource: 'Security', logSourceName: 'WinEventLog:Security', eventId: '4688', logChannel: 'Security', notes: 'Requires "Audit Process Creation" policy' },
      { platform: 'Windows', eventSource: 'Sysmon', logSourceName: 'WinEventLog:Sysmon', eventId: '1', logChannel: 'Microsoft-Windows-Sysmon/Operational', notes: 'Recommended for command line and hash data' },
      { platform: 'Linux', eventSource: 'Auditd', logSourceName: 'auditd:EXECVE', eventId: 'EXECVE', logChannel: '/var/log/audit/audit.log' },
      { platform: 'macOS', eventSource: 'Endpoint Security', logSourceName: 'endpointsecurity:exec', eventId: 'ES_EVENT_TYPE_NOTIFY_EXEC' },
      { platform: 'ESXi', eventSource: 'ESXi Shell', logSourceName: 'esxi:shell', logChannel: '/var/log/shell.log' },
    ]
  },
  'DC0024': {
    id: 'DC0024',
    name: 'Script Execution',
    description: 'The execution of scripts such as PowerShell, Python, Bash, etc.',
    dataSource: 'Script',
    mutableElements: [
      { name: 'script_block_text', description: 'Full script content', fieldPath: 'powershell.script_block_text' },
      { name: 'script_path', description: 'Path to script file', fieldPath: 'file.path' },
      { name: 'script_name', description: 'Script filename', fieldPath: 'file.name' },
      { name: 'host_application', description: 'Host application running script', fieldPath: 'process.name' },
      { name: 'user', description: 'User executing script', fieldPath: 'user.name' },
      { name: 'runspace_id', description: 'PowerShell runspace identifier', fieldPath: 'powershell.runspace_id' },
    ],
    platforms: [
      { platform: 'Windows', eventSource: 'PowerShell', logSourceName: 'WinEventLog:PowerShell', eventId: '4103', logChannel: 'Microsoft-Windows-PowerShell/Operational', notes: 'Module logging' },
      { platform: 'Windows', eventSource: 'PowerShell', logSourceName: 'WinEventLog:PowerShell', eventId: '4104', logChannel: 'Microsoft-Windows-PowerShell/Operational', notes: 'Script block logging' },
      { platform: 'Windows', eventSource: 'PowerShell', logSourceName: 'WinEventLog:PowerShell', eventId: '800', logChannel: 'Windows PowerShell', notes: 'Pipeline execution' },
      { platform: 'Linux', eventSource: 'Bash', logSourceName: 'bash:history', logChannel: '/var/log/bash.log or .bash_history', notes: 'Requires HISTFILE configuration' },
    ]
  },
  'DC0001': {
    id: 'DC0001',
    name: 'User Account Authentication',
    description: 'Logging of user authentication attempts including success and failure.',
    dataSource: 'Logon Session',
    mutableElements: [
      { name: 'user', description: 'Username attempting authentication', fieldPath: 'user.name' },
      { name: 'domain', description: 'User domain', fieldPath: 'user.domain' },
      { name: 'logon_type', description: 'Type of logon (interactive, network, etc.)', fieldPath: 'winlog.logon.type' },
      { name: 'source_ip', description: 'Source IP of authentication', fieldPath: 'source.ip' },
      { name: 'workstation', description: 'Source workstation name', fieldPath: 'source.hostname' },
      { name: 'auth_package', description: 'Authentication package used', fieldPath: 'winlog.auth_package' },
      { name: 'status', description: 'Success or failure status', fieldPath: 'event.outcome' },
    ],
    platforms: [
      { platform: 'Windows', eventSource: 'Security', logSourceName: 'WinEventLog:Security', eventId: '4624', logChannel: 'Security', notes: 'Successful logon' },
      { platform: 'Windows', eventSource: 'Security', logSourceName: 'WinEventLog:Security', eventId: '4625', logChannel: 'Security', notes: 'Failed logon' },
      { platform: 'Windows', eventSource: 'Security', logSourceName: 'WinEventLog:Security', eventId: '4648', logChannel: 'Security', notes: 'Explicit credential logon' },
      { platform: 'Linux', eventSource: 'PAM', logSourceName: 'pam:auth', logChannel: '/var/log/auth.log or /var/log/secure' },
      { platform: 'Identity Provider', eventSource: 'Sign-in Logs', logSourceName: 'azuread:signin', notes: 'Identity provider sign-in activity' },
    ]
  },
  'DC0036': {
    id: 'DC0036',
    name: 'Scheduled Job Creation',
    description: 'Creation of scheduled tasks or cron jobs for automated execution.',
    dataSource: 'Scheduled Job',
    mutableElements: [
      { name: 'task_name', description: 'Name of scheduled task', fieldPath: 'winlog.task_scheduler.task_name' },
      { name: 'task_content', description: 'Task definition XML or content', fieldPath: 'winlog.task_content' },
      { name: 'action', description: 'Action to be executed', fieldPath: 'winlog.task_scheduler.action' },
      { name: 'trigger', description: 'Trigger conditions', fieldPath: 'winlog.task_scheduler.trigger' },
      { name: 'user_context', description: 'User context for execution', fieldPath: 'user.name' },
      { name: 'author', description: 'Task author/creator', fieldPath: 'winlog.task_scheduler.author' },
    ],
    platforms: [
      { platform: 'Windows', eventSource: 'Security', logSourceName: 'WinEventLog:Security', eventId: '4698', logChannel: 'Security', notes: 'Scheduled task created' },
      { platform: 'Windows', eventSource: 'Task Scheduler', logSourceName: 'WinEventLog:TaskScheduler', eventId: '106', logChannel: 'Microsoft-Windows-TaskScheduler/Operational', notes: 'Task registered' },
      { platform: 'Linux', eventSource: 'Cron', logSourceName: 'cron:job', logChannel: '/var/log/cron' },
    ]
  },
};

export const detectionStrategies: DetectionStrategy[] = [
  {
    id: 'DET0002',
    name: 'Outbound Connection to Malicious Infrastructure',
    description: 'This detection strategy identifies outbound network connections from internal hosts to known malicious or suspicious external infrastructure. These connections may indicate command and control (C2) activity, data exfiltration, or other adversary communication channels.',
    techniques: ['T1071', 'T1571', 'T1573'],
    analytics: [
      {
        id: 'AN0002',
        name: 'Outbound Connection to Rare External IP',
        description: 'Detects outbound connections to IP addresses that are rarely seen in the environment, which may indicate C2 beaconing or communication with adversary infrastructure.',
        pseudocode: `SELECT src_ip, dst_ip, dst_port, process_name, user
FROM network_connections
WHERE direction = 'outbound'
  AND dst_ip NOT IN (SELECT ip FROM known_good_destinations)
  AND dst_ip IN (SELECT ip FROM threat_intel_iocs)
  OR connection_count < 5 OVER LAST 30 DAYS`,
        dataComponents: ['DC0082'],
        platforms: ['Windows', 'Linux', 'macOS']
      },
      {
        id: 'AN0003',
        name: 'Process Making Unusual Network Connection',
        description: 'Detects when a process not typically associated with network activity initiates an outbound connection.',
        pseudocode: `SELECT process_name, process_path, dst_ip, dst_port, user
FROM network_connections
JOIN process_creation ON network_connections.process_id = process_creation.process_id
WHERE process_name IN ('notepad.exe', 'calc.exe', 'mspaint.exe', 'regsvr32.exe')
  AND direction = 'outbound'`,
        dataComponents: ['DC0082', 'DC0005'],
        platforms: ['Windows']
      }
    ],
    dataComponentRefs: ['DC0082', 'DC0005']
  },
  {
    id: 'DET0455',
    name: 'Abuse of PowerShell for Arbitrary Execution',
    description: 'This detection strategy identifies suspicious PowerShell usage patterns that may indicate malicious script execution, including encoded commands, execution policy bypass, download cradles, and other evasion techniques commonly used by adversaries.',
    techniques: ['T1059.001', 'T1059'],
    analytics: [
      {
        id: 'AN0455',
        name: 'PowerShell Encoded Command Execution',
        description: 'Detects PowerShell execution with encoded commands, which is commonly used to obfuscate malicious scripts and evade detection.',
        pseudocode: `SELECT process_name, command_line, parent_process, user
FROM process_creation
WHERE process_name ILIKE '%powershell%' OR process_name ILIKE '%pwsh%'
  AND (
    command_line ILIKE '%-enc%'
    OR command_line ILIKE '%-encodedcommand%'
    OR command_line ILIKE '%-e %' AND LENGTH(SPLIT(command_line, ' ')[-1]) > 100
  )`,
        dataComponents: ['DC0005', 'DC0017'],
        platforms: ['Windows']
      },
      {
        id: 'AN0456',
        name: 'PowerShell Download Cradle',
        description: 'Detects PowerShell downloading and executing content from the internet, a common technique for staging malware.',
        pseudocode: `SELECT process_name, command_line, user
FROM process_creation
WHERE process_name ILIKE '%powershell%'
  AND (
    command_line ILIKE '%downloadstring%'
    OR command_line ILIKE '%downloadfile%'
    OR command_line ILIKE '%invoke-webrequest%'
    OR command_line ILIKE '%iwr %'
    OR command_line ILIKE '%curl %'
    OR command_line ILIKE '%wget %'
  )
  AND (
    command_line ILIKE '%iex%'
    OR command_line ILIKE '%invoke-expression%'
    OR command_line ILIKE '%.invoke(%'
  )`,
        dataComponents: ['DC0005', 'DC0017', 'DC0024'],
        platforms: ['Windows']
      },
      {
        id: 'AN0457',
        name: 'PowerShell Execution Policy Bypass',
        description: 'Detects attempts to bypass PowerShell execution policy restrictions.',
        pseudocode: `SELECT process_name, command_line, parent_process, user
FROM process_creation  
WHERE process_name ILIKE '%powershell%'
  AND (
    command_line ILIKE '%-ep bypass%'
    OR command_line ILIKE '%-executionpolicy bypass%'
    OR command_line ILIKE '%-exec bypass%'
    OR command_line ILIKE '%set-executionpolicy%bypass%'
  )`,
        dataComponents: ['DC0005', 'DC0017'],
        platforms: ['Windows']
      }
    ],
    dataComponentRefs: ['DC0005', 'DC0017', 'DC0024']
  },
  {
    id: 'DET0500',
    name: 'Scheduled Task Persistence',
    description: 'This detection strategy identifies the creation or modification of scheduled tasks that may be used for persistence, privilege escalation, or execution of malicious payloads.',
    techniques: ['T1053.005', 'T1053'],
    analytics: [
      {
        id: 'AN0500',
        name: 'Scheduled Task Created with Suspicious Action',
        description: 'Detects scheduled tasks created with suspicious executable paths or command interpreters.',
        pseudocode: `SELECT task_name, task_content, user_context, action
FROM scheduled_task_events
WHERE event_type = 'created'
  AND (
    action ILIKE '%cmd.exe%'
    OR action ILIKE '%powershell%'
    OR action ILIKE '%mshta%'
    OR action ILIKE '%wscript%'
    OR action ILIKE '%cscript%'
    OR action ILIKE '%rundll32%'
    OR action ILIKE '%regsvr32%'
    OR action ILIKE '%\\temp\\%'
    OR action ILIKE '%\\appdata\\%'
  )`,
        dataComponents: ['DC0036', 'DC0005'],
        platforms: ['Windows']
      }
    ],
    dataComponentRefs: ['DC0036', 'DC0005']
  },
  {
    id: 'DET0001',
    name: 'Credential Access via Brute Force',
    description: 'This detection strategy identifies brute force attacks against user accounts, including password spraying and credential stuffing attempts.',
    techniques: ['T1110', 'T1110.001', 'T1110.003'],
    analytics: [
      {
        id: 'AN0001',
        name: 'Multiple Failed Logon Attempts',
        description: 'Detects multiple failed authentication attempts from a single source, which may indicate brute force activity.',
        pseudocode: `SELECT src_ip, user, COUNT(*) as failed_attempts
FROM authentication_events
WHERE status = 'failure'
  AND timestamp > NOW() - INTERVAL '15 minutes'
GROUP BY src_ip, user
HAVING COUNT(*) > 10`,
        dataComponents: ['DC0001'],
        platforms: ['Windows', 'Linux', 'Identity Provider']
      },
      {
        id: 'AN0004',
        name: 'Password Spray Detection',
        description: 'Detects attempts to authenticate with common passwords across multiple accounts.',
        pseudocode: `SELECT src_ip, COUNT(DISTINCT user) as unique_users, COUNT(*) as total_attempts
FROM authentication_events
WHERE status = 'failure'
  AND timestamp > NOW() - INTERVAL '1 hour'
GROUP BY src_ip
HAVING COUNT(DISTINCT user) > 20`,
        dataComponents: ['DC0001'],
        platforms: ['Windows', 'Identity Provider']
      }
    ],
    dataComponentRefs: ['DC0001']
  }
];

const curatedTechniques: Technique[] = [
  { id: 'T1059', name: 'Command and Scripting Interpreter', tactic: 'Execution', description: 'Adversaries may abuse command and script interpreters to execute commands, scripts, or binaries.', usedByGroups: ['APT29', 'APT28', 'Lazarus'], detectionStrategies: ['DET0455'] },
  { id: 'T1059.001', name: 'PowerShell', tactic: 'Execution', description: 'Adversaries may abuse PowerShell commands and scripts for execution.', usedByGroups: ['APT29', 'APT28', 'Lazarus'], detectionStrategies: ['DET0455'] },
  { id: 'T1071', name: 'Application Layer Protocol', tactic: 'Command and Control', description: 'Adversaries may communicate using application layer protocols to avoid detection.', usedByGroups: ['APT29', 'APT28'], detectionStrategies: ['DET0002'] },
  { id: 'T1571', name: 'Non-Standard Port', tactic: 'Command and Control', description: 'Adversaries may communicate using a protocol on a non-standard port.', usedByGroups: ['APT28', 'Lazarus'], detectionStrategies: ['DET0002'] },
  { id: 'T1573', name: 'Encrypted Channel', tactic: 'Command and Control', description: 'Adversaries may employ encryption to conceal command and control traffic.', usedByGroups: ['APT29'], detectionStrategies: ['DET0002'] },
  { id: 'T1053', name: 'Scheduled Task/Job', tactic: 'Execution, Persistence, Privilege Escalation', description: 'Adversaries may abuse task scheduling functionality to facilitate execution.', usedByGroups: ['APT29', 'APT28', 'Lazarus'], detectionStrategies: ['DET0500'] },
  { id: 'T1053.005', name: 'Scheduled Task', tactic: 'Execution, Persistence, Privilege Escalation', description: 'Adversaries may abuse the Windows Task Scheduler for persistence.', usedByGroups: ['APT29', 'APT28', 'Lazarus'], detectionStrategies: ['DET0500'] },
  { id: 'T1110', name: 'Brute Force', tactic: 'Credential Access', description: 'Adversaries may use brute force techniques to gain access to accounts.', usedByGroups: ['APT28', 'Lazarus'], detectionStrategies: ['DET0001'] },
  { id: 'T1110.001', name: 'Password Guessing', tactic: 'Credential Access', description: 'Adversaries may guess passwords to attempt access to accounts.', usedByGroups: ['APT28'], detectionStrategies: ['DET0001'] },
  { id: 'T1110.003', name: 'Password Spraying', tactic: 'Credential Access', description: 'Adversaries may use a single password against many accounts.', usedByGroups: ['APT29', 'APT28'], detectionStrategies: ['DET0001'] },
];

const fullTechniques: Technique[] = fullMitreTechniques.map((technique) => ({
  ...technique,
  usedByGroups: [],
  detectionStrategies: [],
}));

const techniqueById = new Map<string, Technique>();
fullTechniques.forEach((technique) => {
  techniqueById.set(technique.id.toUpperCase(), technique);
});
curatedTechniques.forEach((technique) => {
  techniqueById.set(technique.id.toUpperCase(), technique);
});

export const techniques: Technique[] = Array.from(techniqueById.values()).sort((a, b) =>
  a.id.localeCompare(b.id)
);

// Note: ctidProducts is now imported from ./products.ts and re-exported at top of file

export function getDetectionStrategiesForProduct(productId: string): DetectionStrategy[] {
  const product = ctidProducts.find(p => p.id === productId);
  if (!product) return [];
  
  return detectionStrategies.filter(ds =>
    ds.dataComponentRefs.some(dcId => product.dataComponentIds.includes(dcId))
  );
}

export function getDataComponentsForProduct(productId: string): DataComponentRef[] {
  const product = ctidProducts.find(p => p.id === productId);
  if (!product) return [];
  
  return product.dataComponentIds
    .map(id => dataComponents[id])
    .filter(Boolean);
}

export function getDetectionStrategiesByTechniques(techniqueIds: string[], platform?: string): DetectionStrategy[] {
  if (!techniqueIds || techniqueIds.length === 0) return [];
  
  const techSet = new Set(techniqueIds.map(t => t.toUpperCase()));
  
  const matchedStrategies = detectionStrategies.filter(ds => 
    ds.techniques.some(t => {
      const upperT = t.toUpperCase();
      return techSet.has(upperT) || 
        techniqueIds.some(tid => {
          const upperTid = tid.toUpperCase();
          return upperTid.startsWith(upperT) || upperT.startsWith(upperTid);
        });
    })
  );
  
  if (!platform) {
    return matchedStrategies;
  }
  
  return matchedStrategies.map(ds => {
    const filteredAnalytics = ds.analytics.filter(a => platformMatchesAny(a.platforms, [platform]));
    
    if (filteredAnalytics.length === 0) return null;
    
    return {
      ...ds,
      analytics: filteredAnalytics
    };
  }).filter((ds): ds is DetectionStrategy => ds !== null);
}

export function getDataComponentsFromStrategies(strategies: DetectionStrategy[]): DataComponentRef[] {
  if (!strategies || strategies.length === 0) return [];
  
  const dcIds = new Set<string>();
  strategies.forEach(ds => {
    if (ds.dataComponentRefs) {
      ds.dataComponentRefs.forEach(dcId => dcIds.add(dcId));
    }
    if (ds.analytics) {
      ds.analytics.forEach(a => {
        if (a.dataComponents) {
          a.dataComponents.forEach(dcId => dcIds.add(dcId));
        }
      });
    }
  });
  
  return Array.from(dcIds)
    .map(id => dataComponents[id])
    .filter((dc): dc is DataComponentRef => dc !== undefined && dc !== null);
}

export function getTechniquesFromStrategies(strategies: DetectionStrategy[]): Technique[] {
  const techIds = new Set<string>();
  strategies.forEach(ds => {
    ds.techniques.forEach(t => techIds.add(t));
  });
  
  return techniques.filter(t => techIds.has(t.id));
}

export interface CTIDAnalyticMatch {
  analytic: AnalyticItem;
  strategy: DetectionStrategy;
  dataComponentRefs: DataComponentRef[];
  matchedTechniques: string[];
}

function techniqueMatches(queryTechId: string, ctidTechId: string): boolean {
  if (queryTechId === ctidTechId) return true;
  const queryBase = queryTechId.split('.')[0];
  const ctidBase = ctidTechId.split('.')[0];
  if (queryBase !== ctidBase) return false;
  if (!queryTechId.includes('.') && ctidTechId.startsWith(queryBase + '.')) return true;
  if (!ctidTechId.includes('.') && queryTechId.startsWith(ctidBase + '.')) return true;
  return false;
}

export function getCTIDAnalyticsForTechniques(
  techniqueIds: string[],
  platforms: string[]
): CTIDAnalyticMatch[] {
  const matches: CTIDAnalyticMatch[] = [];
  detectionStrategies.forEach(strategy => {
    const matchedTechniques = strategy.techniques.filter(ctidTech =>
      techniqueIds.some(queryTech => techniqueMatches(queryTech, ctidTech))
    );
    
    if (matchedTechniques.length === 0) return;
    
    strategy.analytics.forEach(analytic => {
      const platformMatch = platformMatchesAny(analytic.platforms, platforms);
      
      if (platformMatch) {
        const dcRefs = analytic.dataComponents
          .map(dcId => dataComponents[dcId])
          .filter((dc): dc is DataComponentRef => dc !== undefined && dc !== null);
        
        matches.push({
          analytic,
          strategy,
          dataComponentRefs: dcRefs,
          matchedTechniques
        });
      }
    });
  });
  
  return matches;
}
