import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { useSystemStatus, useProducts, useAliases } from '@/hooks/useProducts';
import {
  RefreshCw,
  Database,
  GitBranch,
  Shield,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  Server,
  Package,
  Tag,
  Clock,
  Zap,
  Key,
  Search,
  SlidersHorizontal
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type TaskStatus = 'idle' | 'running' | 'success' | 'error';

interface TaskState {
  status: TaskStatus;
  message: string;
  progress: number;
}

export default function AdminTasks() {
  const { data: systemStatus, isLoading: statusLoading, refetch: refetchStatus } = useSystemStatus();
  const { data: products } = useProducts();
  const { data: aliases } = useAliases();

  const [sigmaSync, setSigmaSync] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [splunkSync, setSplunkSync] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [elasticSync, setElasticSync] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [azureSync, setAzureSync] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [ctidSync, setCtidSync] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [detectionsIndex, setDetectionsIndex] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [stixInit, setStixInit] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [dbPush, setDbPush] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [dbSeed, setDbSeed] = useState<TaskState>({ status: 'idle', message: '', progress: 0 });
  const [autoRefreshLogs, setAutoRefreshLogs] = useState(false);
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false);
  const [aliasSearch, setAliasSearch] = useState('');
  const [aliasEdits, setAliasEdits] = useState<Record<number, string>>({});
  const [aliasSaving, setAliasSaving] = useState<Record<number, boolean>>({});
  const [geminiKeyInput, setGeminiKeyInput] = useState('');
  const [geminiModelInput, setGeminiModelInput] = useState('');
  const [geminiTemperatureInput, setGeminiTemperatureInput] = useState('');
  const [geminiTopPInput, setGeminiTopPInput] = useState('');
  const [geminiTopKInput, setGeminiTopKInput] = useState('');
  const [geminiSeedInput, setGeminiSeedInput] = useState('');
  const [geminiMaxTokensInput, setGeminiMaxTokensInput] = useState('');
  const [geminiStatus, setGeminiStatus] = useState<{
    configured: boolean;
    source: 'database' | 'environment' | 'none';
    updatedAt?: string | null;
    model?: string;
    modelSource?: 'database' | 'environment' | 'default';
    generation?: {
      temperature?: { value: string | null; source: 'database' | 'environment' | 'default' | 'none' };
      topP?: { value: string | null; source: 'database' | 'environment' | 'default' | 'none' };
      topK?: { value: string | null; source: 'database' | 'environment' | 'default' | 'none' };
      seed?: { value: string | null; source: 'database' | 'environment' | 'default' | 'none' };
      maxOutputTokens?: { value: string | null; source: 'database' | 'environment' | 'default' | 'none' };
    };
  } | null>(null);
  const [geminiSaving, setGeminiSaving] = useState(false);
  const [geminiModelSaving, setGeminiModelSaving] = useState(false);
  const [geminiConfigSaving, setGeminiConfigSaving] = useState(false);
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [geminiMessage, setGeminiMessage] = useState<string | null>(null);
  const [geminiConfigMessage, setGeminiConfigMessage] = useState<string | null>(null);
  const [geminiTestResult, setGeminiTestResult] = useState<{
    ok: boolean;
    model: string;
    usage: {
      promptTokens: number;
      candidatesTokens: number;
      totalTokens: number;
    };
    usageRemaining: number | null;
    note?: string;
  } | null>(null);

  const runSigmaSync = async () => {
    setSigmaSync({ status: 'running', message: 'Refreshing Sigma rules...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/refresh-sigma', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to refresh Sigma rules');
      }

      const result = await response.json();
      setSigmaSync({
        status: 'success',
        message: result.message || 'Sigma rules synchronized successfully',
        progress: 100
      });

      setTimeout(() => setSigmaSync({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setSigmaSync({ status: 'error', message: error.message || 'Failed to sync Sigma rules', progress: 0 });
    }
  };

  const runStixInit = async () => {
    setStixInit({ status: 'running', message: 'Syncing MITRE data...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/refresh-mitre', { method: 'POST' });

      if (!response.ok) {
        throw new Error('Failed to sync MITRE data');
      }

      const result = await response.json();
      setStixInit({
        status: 'success',
        message: `Updated ${result.dataComponents || 0} data components and ${result.detectionStrategies || 0} strategies`,
        progress: 100
      });

      refetchStatus();
      setTimeout(() => setStixInit({ status: 'idle', message: '', progress: 0 }), 3000);
    } catch (error: any) {
      setStixInit({ status: 'error', message: error.message || 'Failed to sync MITRE data', progress: 0 });
    }
  };

  const runSplunkSync = async () => {
    setSplunkSync({ status: 'running', message: 'Refreshing Splunk rules...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/refresh-splunk', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to refresh Splunk rules');
      }

      const result = await response.json();
      setSplunkSync({
        status: 'success',
        message: result.message || 'Splunk rules synchronized successfully',
        progress: 100
      });

      setTimeout(() => setSplunkSync({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setSplunkSync({ status: 'error', message: error.message || 'Failed to sync Splunk rules', progress: 0 });
    }
  };

  const runElasticSync = async () => {
    setElasticSync({ status: 'running', message: 'Refreshing Elastic rules...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/refresh-elastic', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to refresh Elastic rules');
      }

      const result = await response.json();
      setElasticSync({
        status: 'success',
        message: result.message || 'Elastic rules synchronized successfully',
        progress: 100
      });

      setTimeout(() => setElasticSync({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setElasticSync({ status: 'error', message: error.message || 'Failed to sync Elastic rules', progress: 0 });
    }
  };

  const runAzureSync = async () => {
    setAzureSync({ status: 'running', message: 'Refreshing Azure Sentinel rules...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/refresh-azure', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to refresh Azure Sentinel rules');
      }

      const result = await response.json();
      setAzureSync({
        status: 'success',
        message: result.message || 'Azure Sentinel rules synchronized successfully',
        progress: 100
      });

      setTimeout(() => setAzureSync({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setAzureSync({ status: 'error', message: error.message || 'Failed to sync Azure Sentinel rules', progress: 0 });
    }
  };

  const runCtidSync = async () => {
    setCtidSync({ status: 'running', message: 'Refreshing CTID mappings...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/refresh-ctid', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to refresh CTID mappings');
      }

      const result = await response.json();
      setCtidSync({
        status: 'success',
        message: result.message || 'CTID mappings synchronized successfully',
        progress: 100
      });

      setTimeout(() => setCtidSync({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setCtidSync({ status: 'error', message: error.message || 'Failed to sync CTID mappings', progress: 0 });
    }
  };

  const runDetectionsIndexRebuild = async () => {
    setDetectionsIndex({ status: 'running', message: 'Rebuilding detections index...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/rebuild-detections-index', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to rebuild detections index');
      }

      const result = await response.json();
      setDetectionsIndex({
        status: 'success',
        message: result.message || 'Detections index rebuilt successfully',
        progress: 100
      });

      setTimeout(() => setDetectionsIndex({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setDetectionsIndex({ status: 'error', message: error.message || 'Failed to rebuild detections index', progress: 0 });
    }
  };

  const runDbSeed = async () => {
    setDbSeed({ status: 'running', message: 'Seeding database...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/db-seed', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to run db:seed');
      }
      const result = await response.json();
      setDbSeed({
        status: 'success',
        message: result.message || 'Database seed completed successfully.',
        progress: 100
      });
      setTimeout(() => setDbSeed({ status: 'idle', message: '', progress: 0 }), 3000);
      refetchStatus();
    } catch (error: any) {
      setDbSeed({ status: 'error', message: error.message || 'Failed to run db:seed', progress: 0 });
    }
  };

  const runDbPush = async () => {
    setDbPush({ status: 'running', message: 'Applying schema changes...', progress: 30 });

    try {
      const response = await fetch('/api/admin/maintenance/db-push', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Failed to run db:push');
      }
      const result = await response.json();
      setDbPush({
        status: 'success',
        message: result.message || 'Database schema applied successfully',
        progress: 100
      });
      setTimeout(() => setDbPush({ status: 'idle', message: '', progress: 0 }), 3000);
    } catch (error: any) {
      setDbPush({ status: 'error', message: error.message || 'Failed to run db:push', progress: 0 });
    }
  };

  const filteredAliases = (aliases || []).filter((alias) => {
    const needle = aliasSearch.trim().toLowerCase();
    if (!needle) return true;
    return (
      alias.alias.toLowerCase().includes(needle) ||
      alias.productName.toLowerCase().includes(needle) ||
      alias.vendor.toLowerCase().includes(needle)
    );
  });

  const saveAlias = async (aliasId: number) => {
    const nextValue = (aliasEdits[aliasId] || '').trim();
    if (!nextValue) return;

    setAliasSaving((prev) => ({ ...prev, [aliasId]: true }));
    try {
      const response = await fetch(`/api/admin/aliases/${aliasId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: nextValue }),
      });
      if (!response.ok) {
        throw new Error('Failed to update alias');
      }
      await response.json();
      setAliasEdits((prev) => {
        const copy = { ...prev };
        delete copy[aliasId];
        return copy;
      });
      refetchStatus();
    } catch {
      // ignore for now; keep edit state
    } finally {
      setAliasSaving((prev) => ({ ...prev, [aliasId]: false }));
    }
  };

  const fetchGeminiStatus = async () => {
    try {
      const response = await fetch('/api/admin/ai-keys/gemini');
      if (!response.ok) {
        throw new Error('Failed to fetch Gemini key status');
      }
      const data = await response.json();
      setGeminiStatus(data);
      setGeminiModelInput((current) => current || data.model || '');
      setGeminiTemperatureInput((current) => current || data.generation?.temperature?.value || '');
      setGeminiTopPInput((current) => current || data.generation?.topP?.value || '');
      setGeminiTopKInput((current) => current || data.generation?.topK?.value || '');
      setGeminiSeedInput((current) => current || data.generation?.seed?.value || '');
      setGeminiMaxTokensInput((current) => current || data.generation?.maxOutputTokens?.value || '');
    } catch {
      setGeminiStatus(null);
    }
  };

  const saveGeminiKey = async () => {
    const apiKey = geminiKeyInput.trim();
    if (!apiKey) {
      setGeminiMessage('Enter a Gemini API key to save.');
      return;
    }
    setGeminiSaving(true);
    setGeminiMessage(null);
    try {
      const response = await fetch('/api/admin/ai-keys/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to save Gemini key');
      }
      setGeminiKeyInput('');
      setGeminiMessage('Gemini key saved.');
      await fetchGeminiStatus();
    } catch (error: any) {
      setGeminiMessage(error.message || 'Failed to save Gemini key');
    } finally {
      setGeminiSaving(false);
    }
  };

  const saveGeminiModel = async () => {
    const model = geminiModelInput.trim();
    if (!model) {
      setGeminiMessage('Enter a Gemini model name to save.');
      return;
    }
    setGeminiModelSaving(true);
    setGeminiMessage(null);
    try {
      const response = await fetch('/api/admin/ai-keys/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to save Gemini model');
      }
      setGeminiMessage('Gemini model saved.');
      await fetchGeminiStatus();
    } catch (error: any) {
      setGeminiMessage(error.message || 'Failed to save Gemini model');
    } finally {
      setGeminiModelSaving(false);
    }
  };

  const saveGeminiConfig = async () => {
    setGeminiConfigSaving(true);
    setGeminiConfigMessage(null);
    try {
      const payload: Record<string, string> = {};
      if (geminiTemperatureInput.trim()) payload.temperature = geminiTemperatureInput.trim();
      if (geminiTopPInput.trim()) payload.topP = geminiTopPInput.trim();
      if (geminiTopKInput.trim()) payload.topK = geminiTopKInput.trim();
      if (geminiSeedInput.trim()) payload.seed = geminiSeedInput.trim();
      if (geminiMaxTokensInput.trim()) payload.maxOutputTokens = geminiMaxTokensInput.trim();

      if (Object.keys(payload).length === 0) {
        setGeminiConfigMessage('Enter at least one generation setting to save.');
        setGeminiConfigSaving(false);
        return;
      }

      const response = await fetch('/api/admin/ai-keys/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || 'Failed to save Gemini generation settings');
      }
      setGeminiConfigMessage('Gemini generation settings saved.');
      await fetchGeminiStatus();
    } catch (error: any) {
      setGeminiConfigMessage(error.message || 'Failed to save Gemini generation settings');
    } finally {
      setGeminiConfigSaving(false);
    }
  };

  const testGeminiKey = async () => {
    setGeminiTesting(true);
    setGeminiMessage(null);
    setGeminiTestResult(null);
    try {
      const response = await fetch('/api/admin/ai-keys/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: geminiKeyInput.trim() || undefined,
          model: geminiModelInput.trim() || undefined,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to validate Gemini key');
      }
      setGeminiTestResult(payload);
      setGeminiMessage(payload.ok ? 'Gemini key validated.' : 'Gemini key validation failed.');
      await fetchGeminiStatus();
    } catch (error: any) {
      setGeminiMessage(error.message || 'Failed to validate Gemini key');
    } finally {
      setGeminiTesting(false);
    }
  };

  useEffect(() => {
    fetchGeminiStatus();
    if (!autoRefreshLogs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      refetchStatus();
    }, 5000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoRefreshLogs, refetchStatus]);

  const getStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'running':
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'running':
        return <Badge variant="secondary" className="bg-blue-500/20 text-blue-400">Running</Badge>;
      case 'success':
        return <Badge variant="secondary" className="bg-green-500/20 text-green-400">Complete</Badge>;
      case 'error':
        return <Badge variant="destructive">Error</Badge>;
      default:
        return <Badge variant="outline">Ready</Badge>;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Admin Tasks</h1>
              <p className="text-muted-foreground text-sm mt-1">
                System maintenance, data synchronization, and administrative operations
              </p>
            </header>

            {/* System Status Overview */}
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-primary" />
                  System Status
                </CardTitle>
                <CardDescription>Current state of Antikythera components</CardDescription>
              </CardHeader>
              <CardContent>
                {statusLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading status...
                  </div>
                ) : systemStatus ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg bg-background/50 border border-border">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Package className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wide">Products</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{systemStatus.products.total}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        CTID: {systemStatus.products.bySource.ctid} | Custom: {systemStatus.products.bySource.custom}
                      </p>
                    </div>

                    <div className="p-4 rounded-lg bg-background/50 border border-border">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Tag className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wide">Aliases</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">{systemStatus.aliases}</p>
                      <p className="text-xs text-muted-foreground mt-1">Search synonyms</p>
                    </div>

                    <div className="p-4 rounded-lg bg-background/50 border border-border">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Shield className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wide">STIX Data</span>
                      </div>
                      <p className="text-2xl font-bold text-foreground">
                        {systemStatus.stix?.techniques || 0}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Techniques loaded</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Last Sync: {systemStatus.lastMitreSync ? new Date(systemStatus.lastMitreSync).toLocaleDateString() : 'Never'}
                      </p>
                    </div>

                    <div className="p-4 rounded-lg bg-background/50 border border-border">
                      <div className="flex items-center gap-2 text-muted-foreground mb-1">
                        <Clock className="w-4 h-4" />
                        <span className="text-xs uppercase tracking-wide">Last Updated</span>
                      </div>
                      <p className="text-sm font-mono text-foreground">
                        {new Date(systemStatus.timestamp).toLocaleTimeString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(systemStatus.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Connection Error</AlertTitle>
                    <AlertDescription>Unable to fetch system status</AlertDescription>
                  </Alert>
                )}

                <div className="mt-4 flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => refetchStatus()}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh Status
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Maintenance Tasks */}
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">

              {/* Gemini API Key */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Key className="w-5 h-5 text-primary" />
                      Gemini API Key
                    </CardTitle>
                    {geminiStatus?.configured ? (
                      <Badge variant="secondary" className="bg-green-500/20 text-green-400">Configured</Badge>
                    ) : (
                      <Badge variant="outline">Not Set</Badge>
                    )}
                  </div>
                  <CardDescription>
                    Add or replace the Gemini API key for AI-assisted mapping.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Key source: {geminiStatus?.source || 'unknown'}</p>
                    {geminiStatus?.updatedAt && (
                      <p>Last updated: {new Date(geminiStatus.updatedAt).toLocaleString()}</p>
                    )}
                    {geminiStatus?.model && (
                      <p>Model: {geminiStatus.model}</p>
                    )}
                  </div>

                  <Input
                    type="password"
                    value={geminiKeyInput}
                    onChange={(event) => setGeminiKeyInput(event.target.value)}
                    placeholder="Paste Gemini API key"
                    className="bg-background"
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button
                      onClick={saveGeminiKey}
                      disabled={geminiSaving}
                      className="w-full"
                    >
                      {geminiSaving ? 'Saving...' : 'Save Key'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={testGeminiKey}
                      disabled={geminiTesting}
                      className="w-full"
                    >
                      {geminiTesting ? 'Testing...' : 'Test Key'}
                    </Button>
                  </div>

                  <Input
                    type="text"
                    value={geminiModelInput}
                    onChange={(event) => setGeminiModelInput(event.target.value)}
                    placeholder="Gemini model (e.g., gemini-1.5-flash)"
                    className="bg-background"
                  />

                  <Button
                    variant="secondary"
                    onClick={saveGeminiModel}
                    disabled={geminiModelSaving}
                    className="w-full"
                  >
                    {geminiModelSaving ? 'Saving...' : 'Save Model'}
                  </Button>

                  {geminiMessage && (
                    <div className="text-xs text-muted-foreground">{geminiMessage}</div>
                  )}

                  {geminiTestResult && (
                    <div className="rounded-lg border border-border bg-background/50 p-3 text-xs text-muted-foreground space-y-1">
                      <div className="flex items-center gap-2">
                        {geminiTestResult.ok ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span>Validation {geminiTestResult.ok ? 'succeeded' : 'failed'}</span>
                      </div>
                      <div>Usage (tokens): {geminiTestResult.usage.totalTokens}</div>
                      <div>Usage remaining: {geminiTestResult.usageRemaining ?? 'N/A'}</div>
                      {geminiTestResult.note && (
                        <div>{geminiTestResult.note}</div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Gemini Generation Settings */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <SlidersHorizontal className="w-5 h-5 text-primary" />
                      Gemini Generation Settings
                    </CardTitle>
                    <Badge variant="outline">Config</Badge>
                  </div>
                  <CardDescription>
                    Control determinism and output length for grounded Gemini calls.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Lower temperature and fixed seed improve repeatability, but grounded search can still vary.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Temperature</div>
                      <Input
                        value={geminiTemperatureInput}
                        onChange={(event) => setGeminiTemperatureInput(event.target.value)}
                        placeholder="0.1"
                        className="bg-background"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        Source: {geminiStatus?.generation?.temperature?.source || 'default'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Top P</div>
                      <Input
                        value={geminiTopPInput}
                        onChange={(event) => setGeminiTopPInput(event.target.value)}
                        placeholder="1"
                        className="bg-background"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        Source: {geminiStatus?.generation?.topP?.source || 'default'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Top K</div>
                      <Input
                        value={geminiTopKInput}
                        onChange={(event) => setGeminiTopKInput(event.target.value)}
                        placeholder="40"
                        className="bg-background"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        Source: {geminiStatus?.generation?.topK?.source || 'default'}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Seed</div>
                      <Input
                        value={geminiSeedInput}
                        onChange={(event) => setGeminiSeedInput(event.target.value)}
                        placeholder="1234"
                        className="bg-background"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        Source: {geminiStatus?.generation?.seed?.source || 'none'}
                      </div>
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <div className="text-xs text-muted-foreground">Max Output Tokens</div>
                      <Input
                        value={geminiMaxTokensInput}
                        onChange={(event) => setGeminiMaxTokensInput(event.target.value)}
                        placeholder="1024"
                        className="bg-background"
                      />
                      <div className="text-[10px] text-muted-foreground">
                        Source: {geminiStatus?.generation?.maxOutputTokens?.source || 'none'}
                      </div>
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    onClick={saveGeminiConfig}
                    disabled={geminiConfigSaving}
                    className="w-full"
                  >
                    {geminiConfigSaving ? 'Saving...' : 'Save Generation Settings'}
                  </Button>

                  {geminiConfigMessage && (
                    <div className="text-xs text-muted-foreground">{geminiConfigMessage}</div>
                  )}
                </CardContent>
              </Card>

              {/* Sigma Sync */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="w-5 h-5 text-primary" />
                      Sigma Rules Sync
                    </CardTitle>
                    {getStatusBadge(sigmaSync.status)}
                  </div>
                  <CardDescription>
                    Update local Sigma rules repository from GitHub
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Synchronizes the local Sigma rules cache with the latest version from SigmaHQ/sigma repository.</p>
                  </div>

                  {sigmaSync.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(sigmaSync.status)}
                        <span className="text-sm">{sigmaSync.message}</span>
                      </div>
                      {sigmaSync.status === 'running' && (
                        <Progress value={sigmaSync.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runSigmaSync}
                    disabled={sigmaSync.status === 'running'}
                  >
                    {sigmaSync.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Sigma Rules
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Splunk Sync */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="w-5 h-5 text-primary" />
                      Splunk Rules Sync
                    </CardTitle>
                    {getStatusBadge(splunkSync.status)}
                  </div>
                  <CardDescription>
                    Update local Splunk security content repository from GitHub
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Synchronizes the local Splunk detections cache with the latest Splunk security_content repository.</p>
                  </div>

                  {splunkSync.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(splunkSync.status)}
                        <span className="text-sm">{splunkSync.message}</span>
                      </div>
                      {splunkSync.status === 'running' && (
                        <Progress value={splunkSync.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runSplunkSync}
                    disabled={splunkSync.status === 'running'}
                  >
                    {splunkSync.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Splunk Rules
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Elastic Sync */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="w-5 h-5 text-primary" />
                      Elastic Rules Sync
                    </CardTitle>
                    {getStatusBadge(elasticSync.status)}
                  </div>
                  <CardDescription>
                    Update local Elastic detection rules repository from GitHub
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Synchronizes the local Elastic detection rules cache with the latest elastic/detection-rules repository.</p>
                  </div>

                  {elasticSync.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(elasticSync.status)}
                        <span className="text-sm">{elasticSync.message}</span>
                      </div>
                      {elasticSync.status === 'running' && (
                        <Progress value={elasticSync.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runElasticSync}
                    disabled={elasticSync.status === 'running'}
                  >
                    {elasticSync.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Elastic Rules
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Azure Sentinel Sync */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="w-5 h-5 text-primary" />
                      Azure Sentinel Sync
                    </CardTitle>
                    {getStatusBadge(azureSync.status)}
                  </div>
                  <CardDescription>
                    Update local Azure Sentinel analytic rules repository from GitHub
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Synchronizes the local Azure Sentinel rules cache with the latest Azure/Azure-Sentinel repository.</p>
                  </div>

                  {azureSync.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(azureSync.status)}
                        <span className="text-sm">{azureSync.message}</span>
                      </div>
                      {azureSync.status === 'running' && (
                        <Progress value={azureSync.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runAzureSync}
                    disabled={azureSync.status === 'running'}
                  >
                    {azureSync.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync Azure Sentinel
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* CTID Sync */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <GitBranch className="w-5 h-5 text-primary" />
                      CTID Mappings Sync
                    </CardTitle>
                    {getStatusBadge(ctidSync.status)}
                  </div>
                  <CardDescription>
                    Update local CTID mappings repository from GitHub
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Synchronizes the local CTID mappings cache with the latest mappings-explorer repository.</p>
                  </div>

                  {ctidSync.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(ctidSync.status)}
                        <span className="text-sm">{ctidSync.message}</span>
                      </div>
                      {ctidSync.status === 'running' && (
                        <Progress value={ctidSync.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runCtidSync}
                    disabled={ctidSync.status === 'running'}
                  >
                    {ctidSync.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Sync CTID Mappings
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Detections Index */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Search className="w-5 h-5 text-primary" />
                      Detections Search Index
                    </CardTitle>
                    {getStatusBadge(detectionsIndex.status)}
                  </div>
                  <CardDescription>
                    Rebuild the on-disk search index used by the Detections page
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Indexes local detection repositories so keyword searches are fast and full-file.</p>
                  </div>

                  {detectionsIndex.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(detectionsIndex.status)}
                        <span className="text-sm">{detectionsIndex.message}</span>
                      </div>
                      {detectionsIndex.status === 'running' && (
                        <Progress value={detectionsIndex.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runDetectionsIndexRebuild}
                    disabled={detectionsIndex.status === 'running'}
                  >
                    {detectionsIndex.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Rebuilding...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Rebuild Index
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* MITRE Sync */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Shield className="w-5 h-5 text-primary" />
                      MITRE Data Sync
                    </CardTitle>
                    {getStatusBadge(stixInit.status)}
                  </div>
                  <CardDescription>
                    Refresh data components and detection strategies from STIX
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Flattens the latest MITRE STIX bundle and upserts definitions without overwriting custom mappings.</p>
                  </div>

                  {stixInit.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(stixInit.status)}
                        <span className="text-sm">{stixInit.message}</span>
                      </div>
                      {stixInit.status === 'running' && (
                        <Progress value={stixInit.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runStixInit}
                    disabled={stixInit.status === 'running'}
                  >
                    {stixInit.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Syncing...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Update MITRE Data
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Database Push */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-primary" />
                      Database Push
                    </CardTitle>
                    {getStatusBadge(dbPush.status)}
                  </div>
                  <CardDescription>
                    Apply schema changes with Drizzle
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Runs <code className="font-mono">npm run db:push</code> to apply schema updates.</p>
                  </div>

                  {dbPush.status !== 'idle' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(dbPush.status)}
                        <span className="text-sm">{dbPush.message}</span>
                      </div>
                      {dbPush.status === 'running' && (
                        <Progress value={dbPush.progress} className="h-2" />
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    onClick={runDbPush}
                    disabled={dbPush.status === 'running'}
                  >
                    {dbPush.status === 'running' ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Applying...
                      </>
                    ) : (
                      <>
                        <Database className="w-4 h-4 mr-2" />
                        Run db:push
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>

              {/* Database Seed */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Database className="w-5 h-5 text-primary" />
                      Database Seed
                    </CardTitle>
                    {getStatusBadge(dbSeed.status)}
                  </div>
                  <CardDescription>
                    Populate database with initial data
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    <p>Seeds the database with CTID products, data components, detection strategies, and default aliases.</p>
                  </div>

                  {dbSeed.status === 'running' && (
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>CLI Required</AlertTitle>
                      <AlertDescription className="font-mono text-xs mt-2">
                        npm run db:seed
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={runDbSeed}
                    disabled={dbSeed.status === 'running'}
                  >
                    <Database className="w-4 h-4 mr-2" />
                    View Seed Command
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Separator />

            {/* Quick Stats Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Repo Stats */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Repository Stats</CardTitle>
                  <CardDescription>Local rule cache status and counts</CardDescription>
                </CardHeader>
                <CardContent>
                  {systemStatus?.repos?.stats ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-purple-500/10 text-purple-400 border-purple-500/30">Sigma</Badge>
                          <span className="text-sm text-muted-foreground">Rules</span>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold">{systemStatus.repos.stats.sigma.rules}</div>
                          <div className="text-xs text-muted-foreground">
                            Updated: {systemStatus.repos.sigma.lastUpdated ? new Date(systemStatus.repos.sigma.lastUpdated).toLocaleDateString() : 'Unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">Splunk</Badge>
                          <span className="text-sm text-muted-foreground">Detections</span>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold">{systemStatus.repos.stats.splunk.detections}</div>
                          <div className="text-xs text-muted-foreground">
                            Updated: {systemStatus.repos.splunk.lastUpdated ? new Date(systemStatus.repos.splunk.lastUpdated).toLocaleDateString() : 'Unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-orange-500/10 text-orange-400 border-orange-500/30">Elastic</Badge>
                          <span className="text-sm text-muted-foreground">Rules</span>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold">{systemStatus.repos.stats.elastic.rules}</div>
                          <div className="text-xs text-muted-foreground">
                            Updated: {systemStatus.repos.elastic.lastUpdated ? new Date(systemStatus.repos.elastic.lastUpdated).toLocaleDateString() : 'Unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-sky-500/10 text-sky-400 border-sky-500/30">Azure Sentinel</Badge>
                          <span className="text-sm text-muted-foreground">Rules</span>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold">{systemStatus.repos.stats.azure.rules}</div>
                          <div className="text-xs text-muted-foreground">
                            Updated: {systemStatus.repos.azure.lastUpdated ? new Date(systemStatus.repos.azure.lastUpdated).toLocaleDateString() : 'Unknown'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">CTID</Badge>
                          <span className="text-sm text-muted-foreground">Mappings</span>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-bold">{systemStatus.repos.stats.ctid.mappings}</div>
                          <div className="text-xs text-muted-foreground">
                            Updated: {systemStatus.repos.ctid.lastUpdated ? new Date(systemStatus.repos.ctid.lastUpdated).toLocaleDateString() : 'Unknown'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Repository stats are unavailable.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Products by Source */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Products by Source</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {products && (
                      <>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/30">CTID</Badge>
                            <span className="text-sm">Center for Threat-Informed Defense</span>
                          </div>
                          <span className="font-mono font-bold">
                            {products.filter(p => p.source === 'ctid').length}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30">Custom</Badge>
                            <span className="text-sm">User-defined products</span>
                          </div>
                          <span className="font-mono font-bold">
                            {products.filter(p => p.source === 'custom').length}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-lg bg-background/50">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30">AI Pending</Badge>
                            <span className="text-sm">Awaiting AI analysis</span>
                          </div>
                          <span className="font-mono font-bold">
                            {products.filter(p => p.source === 'ai-pending').length}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Product Aliases */}
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Product Aliases</CardTitle>
                  <CardDescription>Search and edit product aliases</CardDescription>
                </CardHeader>
                <CardContent>
                  <Dialog open={aliasDialogOpen} onOpenChange={setAliasDialogOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="w-full">
                        Manage Aliases
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Product Aliases</DialogTitle>
                        <DialogDescription>
                          Search and edit aliases used for product matching.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <Input
                          placeholder="Search aliases or products..."
                          value={aliasSearch}
                          onChange={(event) => setAliasSearch(event.target.value)}
                        />
                        <ScrollArea className="h-[420px] rounded-md border border-border bg-background/50 p-3">
                          <div className="space-y-3">
                            {filteredAliases.map((alias) => {
                              const currentValue = aliasEdits[alias.id] ?? alias.alias;
                              return (
                                <div key={alias.id} className="flex items-center gap-3 rounded-md border border-border bg-card/50 p-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="text-sm font-medium text-foreground">
                                      {alias.productName}
                                      <span className="text-xs text-muted-foreground ml-2">{alias.vendor}</span>
                                    </div>
                                    <Input
                                      value={currentValue}
                                      onChange={(event) =>
                                        setAliasEdits((prev) => ({
                                          ...prev,
                                          [alias.id]: event.target.value,
                                        }))
                                      }
                                      className="mt-2"
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() => saveAlias(alias.id)}
                                    disabled={aliasSaving[alias.id] || currentValue.trim() === alias.alias}
                                  >
                                    {aliasSaving[alias.id] ? 'Saving...' : 'Save'}
                                  </Button>
                                </div>
                              );
                            })}
                            {filteredAliases.length === 0 && (
                              <div className="text-sm text-muted-foreground text-center py-6">
                                No aliases match your search.
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            </div>

            <Separator />

            {/* Startup Logs */}
            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-lg">Startup Logs</CardTitle>
                    <CardDescription>Latest container startup steps</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => refetchStatus()}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh
                    </Button>
                    <Button
                      variant={autoRefreshLogs ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAutoRefreshLogs((current) => !current)}
                    >
                      {autoRefreshLogs ? 'Auto Refreshing' : 'Auto Refresh'}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {systemStatus?.startupLog && systemStatus.startupLog.length > 0 ? (
                  <ScrollArea className="h-60 rounded-md border border-border bg-background/50 p-3 font-mono text-xs text-muted-foreground">
                    <div className="space-y-1">
                      {systemStatus.startupLog.map((line, idx) => (
                        <div key={`startup-log-${idx}`}>{line}</div>
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    No startup logs available yet.
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>
      </main>
    </div>
  );
}
