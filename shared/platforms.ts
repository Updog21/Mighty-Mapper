export const PLATFORM_VALUES = [
  "Windows",
  "Linux",
  "macOS",
  "Android",
  "iOS",
  "None",
  "PRE",
  "IaaS",
  "SaaS",
  "Office 365",
  "Office Suite",
  "Identity Provider",
  "Google Workspace",
  "Azure AD",
  "AWS",
  "GCP",
  "Azure",
  "Containers",
  "ESXi",
  "Network Devices",
] as const;

export type PlatformValue = typeof PLATFORM_VALUES[number];

const CANONICAL_BY_NORMALIZED = new Map<string, PlatformValue>(
  PLATFORM_VALUES.map((platform) => [platform.toLowerCase(), platform])
);

const PLATFORM_SYNONYMS: Record<string, PlatformValue[]> = {
  "windows endpoint": ["Windows"],
  "linux server/endpoint": ["Linux"],
  "macos endpoint": ["macOS"],
  "container/kubernetes": ["Containers"],
  "esxi / vmware": ["ESXi"],
  "cloud infrastructure": ["IaaS"],
  "saas application": ["SaaS"],
  "network": ["Network Devices"],
  "network devices": ["Network Devices"],
  "network / network devices": ["Network Devices"],
  "esxi / virtualization": ["ESXi"],
  "office365": ["Office 365"],
  "m365": ["Office 365"],
  "microsoft 365": ["Office 365"],
  "google workspace": ["Google Workspace"],
  "g suite": ["Google Workspace"],
  "azure ad": ["Azure AD"],
  "entra id": ["Azure AD"],
  "active directory": ["Identity Provider"],
  "identity": ["Identity Provider"],
  "idp": ["Identity Provider"],
};

const PLATFORM_MATCH_GROUPS: Record<PlatformValue, PlatformValue[]> = {
  "Windows": ["Windows"],
  "Linux": ["Linux"],
  "macOS": ["macOS"],
  "Android": ["Android"],
  "iOS": ["iOS"],
  "None": ["None"],
  "PRE": ["PRE"],
  "IaaS": ["IaaS", "AWS", "Azure", "GCP"],
  "AWS": ["AWS", "IaaS"],
  "Azure": ["Azure", "IaaS"],
  "GCP": ["GCP", "IaaS"],
  "SaaS": ["SaaS", "Office 365", "Office Suite", "Google Workspace"],
  "Office 365": ["Office 365", "Office Suite", "SaaS"],
  "Office Suite": ["Office Suite", "Office 365", "Google Workspace", "SaaS"],
  "Google Workspace": ["Google Workspace", "Office Suite", "SaaS"],
  "Identity Provider": ["Identity Provider", "Azure AD"],
  "Azure AD": ["Azure AD", "Identity Provider"],
  "Containers": ["Containers"],
  "ESXi": ["ESXi"],
  "Network Devices": ["Network Devices"],
};

const normalizePlatformValue = (value: string) => value.toLowerCase().trim();

export const resolvePlatformValues = (platforms: string[]): PlatformValue[] => {
  const resolved = new Set<PlatformValue>();
  platforms.forEach((platform) => {
    const normalized = normalizePlatformValue(platform);
    if (!normalized) return;
    const alias = PLATFORM_SYNONYMS[normalized];
    if (alias) {
      alias.forEach((entry) => resolved.add(entry));
      return;
    }
    const canonical = CANONICAL_BY_NORMALIZED.get(normalized);
    if (canonical) {
      resolved.add(canonical);
    }
  });
  return Array.from(resolved);
};

export const normalizePlatformList = (platforms: string[]): PlatformValue[] => {
  return resolvePlatformValues(platforms);
};

export const buildPlatformMatchSet = (platforms: string[]): Set<string> => {
  const resolved = resolvePlatformValues(platforms);
  const matches = new Set<string>();
  resolved.forEach((platform) => {
    const group = PLATFORM_MATCH_GROUPS[platform] || [platform];
    group.forEach((entry) => matches.add(entry.toLowerCase()));
  });
  return matches;
};

export const platformMatchesAny = (platforms: string[], selectedPlatforms: string[]): boolean => {
  if (!selectedPlatforms || selectedPlatforms.length === 0) return true;
  const targetSet = resolvePlatformValues(platforms).map((platform) => platform.toLowerCase());
  if (targetSet.length === 0) return false;
  const matchSet = buildPlatformMatchSet(selectedPlatforms);
  return targetSet.some((platform) => matchSet.has(platform));
};
