#!/usr/bin/env npx tsx
/**
 * Sigma Rules Sync Script - Phase 2 Maintenance Infrastructure
 *
 * Purpose: Keep local Sigma rules repository up-to-date
 *
 * Usage:
 *   npx tsx scripts/sync-sigma.ts           # Update existing repo
 *   npx tsx scripts/sync-sigma.ts --force   # Force fresh clone
 *   npx tsx scripts/sync-sigma.ts --status  # Check status only
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const SIGMA_PATH = './data/sigma';
const SIGMA_REPO = 'https://github.com/SigmaHQ/sigma.git';

interface SyncResult {
  success: boolean;
  action: 'cloned' | 'updated' | 'status' | 'error';
  message: string;
  stats?: {
    rulesDirs: string[];
    totalFiles: number;
    lastCommit?: string;
  };
}

function run(cmd: string, cwd?: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (e: any) {
    throw new Error(`Command failed: ${cmd}\n${e.stderr || e.message}`);
  }
}

function countYmlFiles(dir: string): number {
  let count = 0;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        count += countYmlFiles(fullPath);
      } else if (item.name.endsWith('.yml') || item.name.endsWith('.yaml')) {
        count++;
      }
    }
  } catch {
    // Ignore read errors
  }
  return count;
}

function getStats(): SyncResult['stats'] {
  const rulesDirs = ['rules', 'rules-emerging-threats', 'rules-threat-hunting', 'rules-compliance']
    .filter(d => fs.existsSync(path.join(SIGMA_PATH, d)));

  let totalFiles = 0;
  for (const dir of rulesDirs) {
    totalFiles += countYmlFiles(path.join(SIGMA_PATH, dir));
  }

  let lastCommit: string | undefined;
  try {
    lastCommit = run('git log -1 --format="%h %s" HEAD', SIGMA_PATH);
  } catch {
    // Not a git repo
  }

  return { rulesDirs, totalFiles, lastCommit };
}

async function syncSigma(args: string[]): Promise<SyncResult> {
  const force = args.includes('--force');
  const statusOnly = args.includes('--status');

  const exists = fs.existsSync(SIGMA_PATH);
  const isGitRepo = exists && fs.existsSync(path.join(SIGMA_PATH, '.git'));

  // Status only mode
  if (statusOnly) {
    if (!exists) {
      return {
        success: true,
        action: 'status',
        message: 'Sigma repo not found. Run without --status to clone.'
      };
    }

    return {
      success: true,
      action: 'status',
      message: isGitRepo ? 'Sigma repo exists and is a git repository.' : 'Sigma folder exists but is not a git repo.',
      stats: getStats()
    };
  }

  // Force fresh clone
  if (force && exists) {
    console.log('[Sigma Sync] Force flag detected. Removing existing repo...');
    fs.rmSync(SIGMA_PATH, { recursive: true, force: true });
  }

  // Clone if not exists
  if (!fs.existsSync(SIGMA_PATH)) {
    console.log('[Sigma Sync] Cloning Sigma repository...');
    try {
      // Ensure parent directory exists
      fs.mkdirSync(path.dirname(SIGMA_PATH), { recursive: true });
      run(`git clone --depth 1 ${SIGMA_REPO} ${SIGMA_PATH}`);

      return {
        success: true,
        action: 'cloned',
        message: 'Successfully cloned Sigma repository.',
        stats: getStats()
      };
    } catch (e: any) {
      return {
        success: false,
        action: 'error',
        message: `Failed to clone: ${e.message}`
      };
    }
  }

  // Update existing repo
  if (isGitRepo) {
    console.log('[Sigma Sync] Updating existing repository...');
    try {
      const before = run('git rev-parse HEAD', SIGMA_PATH);
      run('git fetch --depth 1 origin main', SIGMA_PATH);
      run('git reset --hard origin/main', SIGMA_PATH);
      const after = run('git rev-parse HEAD', SIGMA_PATH);

      const updated = before !== after;

      return {
        success: true,
        action: 'updated',
        message: updated
          ? `Updated from ${before.slice(0, 7)} to ${after.slice(0, 7)}`
          : 'Already up to date.',
        stats: getStats()
      };
    } catch (e: any) {
      return {
        success: false,
        action: 'error',
        message: `Failed to update: ${e.message}`
      };
    }
  }

  // Not a git repo but folder exists
  return {
    success: false,
    action: 'error',
    message: `${SIGMA_PATH} exists but is not a git repository. Use --force to replace.`
  };
}

// Main execution
const args = process.argv.slice(2);

syncSigma(args).then(result => {
  console.log('\n=== Sigma Sync Result ===');
  console.log(`Action: ${result.action}`);
  console.log(`Success: ${result.success}`);
  console.log(`Message: ${result.message}`);

  if (result.stats) {
    console.log('\n=== Repository Stats ===');
    console.log(`Rule directories: ${result.stats.rulesDirs.join(', ')}`);
    console.log(`Total YAML files: ${result.stats.totalFiles}`);
    if (result.stats.lastCommit) {
      console.log(`Last commit: ${result.stats.lastCommit}`);
    }
  }

  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
