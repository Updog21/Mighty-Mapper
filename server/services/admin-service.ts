import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { dataComponents, detectionStrategies } from '@shared/schema';
import { settingsService } from './settings-service';

const runCommand = (command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        const errorText = stderr.trim() || `${command} ${args.join(' ')} failed`;
        reject(new Error(errorText));
      }
    });
    child.on('error', reject);
  });
};

const runGitCommand = async (args: string[], cwd: string): Promise<string> => {
  const result = await runCommand('git', args, cwd);
  return result.stdout.trim();
};

interface StixObject {
  id: string;
  type: string;
  name?: string;
  description?: string;
  x_mitre_data_source_ref?: string;
  x_mitre_domains?: string[];
  revoked?: boolean;
  x_mitre_deprecated?: boolean;
  external_references?: Array<{
    source_name: string;
    external_id?: string;
  }>;
}

interface StixBundle {
  type: 'bundle';
  objects: StixObject[];
}

export class AdminService {
  private readonly DATA_DIR = path.resolve(process.cwd(), 'data');
  private readonly SIGMA_DIR = path.resolve(process.cwd(), 'data', 'sigma');
  private readonly SPLUNK_DIR = path.resolve(process.cwd(), 'data', 'splunk-security-content');
  private readonly ELASTIC_DIR = path.resolve(process.cwd(), 'data', 'elastic-detection-rules');
  private readonly AZURE_DIR = path.resolve(process.cwd(), 'data', 'azure-sentinel');
  private readonly CTID_DIR = path.resolve(process.cwd(), 'data', 'ctid-mappings-explorer');
  private readonly REPOS = {
    sigma: {
      url: 'https://github.com/SigmaHQ/sigma.git',
      dir: path.resolve(process.cwd(), 'data', 'sigma'),
    },
    splunk: {
      url: 'https://github.com/splunk/security_content.git',
      dir: path.resolve(process.cwd(), 'data', 'splunk-security-content'),
    },
    elastic: {
      url: 'https://github.com/elastic/detection-rules.git',
      dir: path.resolve(process.cwd(), 'data', 'elastic-detection-rules'),
    },
    azure: {
      url: 'https://github.com/Azure/Azure-Sentinel.git',
      dir: path.resolve(process.cwd(), 'data', 'azure-sentinel'),
    },
    ctid: {
      url: 'https://github.com/center-for-threat-informed-defense/mappings-explorer.git',
      dir: path.resolve(process.cwd(), 'data', 'ctid-mappings-explorer'),
    },
  } as const;
  private readonly DEFAULT_STIX_URL =
    'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
  private mitreSyncTimer?: NodeJS.Timeout;
  private mitreSyncInterval?: NodeJS.Timeout;
  private repoSyncTimer?: NodeJS.Timeout;
  private repoSyncInterval?: NodeJS.Timeout;

  async smartRefreshRepo(repoKey: keyof typeof this.REPOS): Promise<{ status: string; message: string }> {
    const repo = this.REPOS[repoKey];
    try {
      if (!fs.existsSync(this.DATA_DIR)) {
        fs.mkdirSync(this.DATA_DIR, { recursive: true });
      }

      const gitDir = path.join(repo.dir, '.git');

      if (fs.existsSync(gitDir)) {
        if (repoKey === 'azure') {
          console.log(`[AdminService] ${repoKey} repo exists. Refreshing sparse checkout...`);
          await runGitCommand(['config', 'core.sparseCheckout', 'true'], repo.dir);
          await runGitCommand(['sparse-checkout', 'set', '--no-cone', 'Solutions/**/Analytic Rules/**'], repo.dir);
        }

        console.log(`[AdminService] ${repoKey} repo exists. Pulling latest changes...`);
        await runGitCommand(['fetch', '--prune', 'origin'], repo.dir);
        const branch = await runGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], repo.dir);
        await runGitCommand(['reset', '--hard', `origin/${branch}`], repo.dir);
        await runGitCommand(['clean', '-fd'], repo.dir);
        return { status: 'success', message: `Updated ${repoKey} repo to origin/${branch}` };
      }

      console.log(`[AdminService] ${repoKey} repo missing. Cloning...`);
      if (fs.existsSync(repo.dir)) {
        fs.rmSync(repo.dir, { recursive: true, force: true });
      }

      if (repoKey === 'azure') {
        await runGitCommand(['clone', '--filter=blob:none', '--sparse', repo.url, repo.dir], this.DATA_DIR);
        await runGitCommand(['sparse-checkout', 'set', '--no-cone', 'Solutions/**/Analytic Rules/**'], repo.dir);
      } else {
        await runGitCommand(['clone', '--depth', '1', repo.url, repo.dir], this.DATA_DIR);
      }
      return { status: 'success', message: `Cloned ${repoKey} repo successfully.` };
    } catch (error) {
      console.error(`[AdminService] Error refreshing ${repoKey} repo:`, error);
      throw new Error(`Failed to refresh ${repoKey} repo: ${(error as Error).message}`);
    }
  }

  async runDbPush(): Promise<{ status: string; message: string }> {
    try {
      const result = await runCommand('npm', ['run', 'db:push'], process.cwd());
      const outputLine = result.stdout.split('\n').filter(Boolean).pop();
      return {
        status: 'success',
        message: outputLine || 'Database schema applied successfully.',
      };
    } catch (error) {
      console.error('[AdminService] Error running db:push:', error);
      throw new Error(`Failed to run db:push: ${(error as Error).message}`);
    }
  }

  /**
   * Smart Refresh: Checks if the Sigma repo exists.
   * - If yes: Runs `git pull` to update.
   * - If no: Runs `git clone` to initialize.
   */
  async smartRefreshSigmaRules(): Promise<{ status: string; message: string }> {
    return this.smartRefreshRepo('sigma');
  }

  /**
   * Get the current status of the external data repositories
   */
  async getRepoStatus(): Promise<{
    sigma: { exists: boolean; lastUpdated?: Date };
    splunk: { exists: boolean; lastUpdated?: Date };
    elastic: { exists: boolean; lastUpdated?: Date };
    azure: { exists: boolean; lastUpdated?: Date };
    ctid: { exists: boolean; lastUpdated?: Date };
    stats: {
      sigma: { rules: number };
      splunk: { detections: number };
      elastic: { rules: number };
      azure: { rules: number };
      ctid: { mappings: number };
    };
  }> {
    const getStatus = async (dir: string) => {
      const gitDir = path.join(dir, '.git');
      const exists = fs.existsSync(gitDir);
      let lastUpdated: Date | undefined;

      if (exists) {
        try {
          const output = await runGitCommand(['log', '-1', '--format=%cd'], dir);
          lastUpdated = new Date(output.trim());
        } catch {
          // ignore error getting date
        }
      }

      return { exists, lastUpdated };
    };

    const [sigma, splunk, elastic, azure, ctid, stats] = await Promise.all([
      getStatus(this.SIGMA_DIR),
      getStatus(this.SPLUNK_DIR),
      getStatus(this.ELASTIC_DIR),
      getStatus(this.AZURE_DIR),
      getStatus(this.CTID_DIR),
      this.getRepoStats(),
    ]);

    return { sigma, splunk, elastic, azure, ctid, stats };
  }

  async getStartupLog(limit = 50): Promise<string[]> {
    const logPath = path.resolve(process.cwd(), 'logs', 'startup.log');
    try {
      const raw = await fs.promises.readFile(logPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      return lines.slice(-limit);
    } catch {
      return [];
    }
  }

  private async getRepoStats(): Promise<{
    sigma: { rules: number };
    splunk: { detections: number };
    elastic: { rules: number };
    azure: { rules: number };
    ctid: { mappings: number };
  }> {
    const [sigmaRules, splunkDetections, elasticRules, azureRules, ctidMappings] = await Promise.all([
      this.countFiles(path.join(this.SIGMA_DIR, 'rules'), '**/*.yml'),
      this.countFiles(path.join(this.SPLUNK_DIR, 'detections'), '**/*.yml'),
      this.countFiles(path.join(this.ELASTIC_DIR, 'rules'), '**/*.toml'),
      this.countFiles(path.join(this.AZURE_DIR, 'Solutions'), '**/Analytic* Rules/**/*.{yml,yaml}'),
      this.countFiles(path.join(this.CTID_DIR, 'src', 'data'), '**/*.json'),
    ]);

    return {
      sigma: { rules: sigmaRules },
      splunk: { detections: splunkDetections },
      elastic: { rules: elasticRules },
      azure: { rules: azureRules },
      ctid: { mappings: ctidMappings },
    };
  }

  private async countFiles(basePath: string, pattern: string): Promise<number> {
    try {
      const { glob } = await import('glob');
      const files = await glob(path.join(basePath, pattern));
      return files.length;
    } catch {
      return 0;
    }
  }

  scheduleRepoSync(): void {
    if (this.repoSyncTimer || this.repoSyncInterval) {
      return;
    }

    const runSync = async () => {
      try {
        await Promise.all([
          this.smartRefreshRepo('sigma'),
          this.smartRefreshRepo('splunk'),
          this.smartRefreshRepo('elastic'),
          this.smartRefreshRepo('azure'),
          this.smartRefreshRepo('ctid'),
        ]);
      } catch (error) {
        console.error('[AdminService] Scheduled repo sync failed:', error);
      }
    };

    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(2, 15, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const msUntilNextRun = nextRun.getTime() - now.getTime();
    this.repoSyncTimer = setTimeout(() => {
      runSync();
      this.repoSyncInterval = setInterval(runSync, 24 * 60 * 60 * 1000);
    }, msUntilNextRun);
  }

  scheduleMitreSync(): void {
    if (this.mitreSyncTimer || this.mitreSyncInterval) {
      return;
    }

    const runSync = async () => {
      try {
        await this.syncMitreData('scheduled');
      } catch (error) {
        console.error('[AdminService] Scheduled MITRE sync failed:', error);
      }
    };

    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setHours(2, 0, 0, 0);
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    const msUntilNextRun = nextRun.getTime() - now.getTime();
    this.mitreSyncTimer = setTimeout(() => {
      runSync();
      this.mitreSyncInterval = setInterval(runSync, 24 * 60 * 60 * 1000);
    }, msUntilNextRun);
  }

  async syncMitreData(trigger: 'scheduled' | 'manual' = 'manual'): Promise<{
    status: string;
    message: string;
    dataComponents: number;
    detectionStrategies: number;
  }> {
    const stixUrl =
      process.env.MITRE_STIX_URL ||
      process.env.MITRE_WORKBENCH_STIX_URL ||
      this.DEFAULT_STIX_URL;

    try {
      console.log(`[AdminService] MITRE sync (${trigger}) using ${stixUrl}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      let response: Response;
      try {
        response = await fetch(stixUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`Failed to fetch STIX bundle: ${response.status}`);
      }

      const bundle = (await response.json()) as StixBundle;
      const dataSourceMap = new Map<string, string>();

      for (const obj of bundle.objects) {
        if (obj.type === 'x-mitre-data-source' && obj.id && obj.name) {
          dataSourceMap.set(obj.id, obj.name);
        }
      }

      const flattenedComponents = bundle.objects
        .filter(obj => obj.type === 'x-mitre-data-component')
        .map(obj => {
          const externalId = this.getExternalId(obj);
          return {
            componentId: externalId || obj.id,
            name: obj.name || 'Unknown',
            dataSourceId: obj.x_mitre_data_source_ref || null,
            dataSourceName: obj.x_mitre_data_source_ref
              ? dataSourceMap.get(obj.x_mitre_data_source_ref) || null
              : null,
            description: obj.description || '',
            domains: Array.isArray(obj.x_mitre_domains) ? obj.x_mitre_domains : [],
            revoked: Boolean(obj.revoked),
            deprecated: Boolean(obj.x_mitre_deprecated),
          };
        });

      if (flattenedComponents.length > 0) {
        await db
          .insert(dataComponents)
          .values(flattenedComponents)
          .onConflictDoUpdate({
            target: dataComponents.componentId,
            set: {
              name: sql`excluded.name`,
              description: sql`excluded.description`,
              dataSourceId: sql`excluded.data_source_id`,
              dataSourceName: sql`excluded.data_source_name`,
              domains: sql`excluded.domains`,
              revoked: sql`excluded.revoked`,
              deprecated: sql`excluded.deprecated`,
            },
          });
      }

      const flattenedStrategies = bundle.objects
        .filter(obj => obj.type === 'x-mitre-detection-strategy')
        .map(obj => ({
          strategyId: this.getExternalId(obj) || obj.id,
          name: obj.name || 'Unknown',
          description: obj.description || '',
        }));

      if (flattenedStrategies.length > 0) {
        await db
          .insert(detectionStrategies)
          .values(flattenedStrategies)
          .onConflictDoUpdate({
            target: detectionStrategies.strategyId,
            set: {
              name: sql`excluded.name`,
              description: sql`excluded.description`,
            },
          });
      }

      await settingsService.set('last_mitre_sync', new Date().toISOString());

      return {
        status: 'success',
        message: 'MITRE data synchronized successfully.',
        dataComponents: flattenedComponents.length,
        detectionStrategies: flattenedStrategies.length,
      };
    } catch (error) {
      console.error('[AdminService] Error syncing MITRE data:', error);
      throw new Error(`Failed to sync MITRE data: ${(error as Error).message}`);
    }
  }

  async getLastMitreSync(): Promise<string | null> {
    const value = await settingsService.get('last_mitre_sync', '');
    return value || null;
  }

  private getExternalId(obj: StixObject): string | null {
    const externalRef = obj.external_references?.find(
      ref => ref.source_name === 'mitre-attack' && ref.external_id
    );
    return externalRef?.external_id || null;
  }
}

export const adminService = new AdminService();
