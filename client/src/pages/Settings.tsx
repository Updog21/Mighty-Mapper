import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/AppShell';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Settings as SettingsIcon, Database, Webhook, Key, ChevronDown, ChevronRight } from 'lucide-react';

type AiProvider = 'gemini' | 'openai';

interface SourcedValue {
  value: string | null;
  source: 'database' | 'environment' | 'default' | 'none';
}

interface AiSettingsStatus {
  activeProvider: AiProvider;
  providerSource: 'database' | 'environment' | 'default';
  gemini: {
    configured: boolean;
    source: 'database' | 'environment' | 'none';
    updatedAt?: string | null;
    model: string;
    modelSource: 'database' | 'environment' | 'default';
  };
  openai: {
    configured: boolean;
    source: 'database' | 'environment' | 'none';
    updatedAt?: string | null;
    model: string;
    modelSource: 'database' | 'environment' | 'default';
  };
}

interface GeminiDetailStatus {
  configured: boolean;
  source: string;
  updatedAt: string | null;
  model: string;
  modelSource: string;
  generation: {
    temperature: SourcedValue;
    topP: SourcedValue;
    topK: SourcedValue;
    seed: SourcedValue;
    maxOutputTokens: SourcedValue;
  };
}

interface OpenAIDetailStatus {
  configured: boolean;
  source: string;
  updatedAt: string | null;
  model: string;
  modelSource: string;
  generation: {
    temperature: SourcedValue;
    topP: SourcedValue;
    maxOutputTokens: SourcedValue;
  };
}

export default function Settings() {
  const [aiSettings, setAiSettings] = useState<AiSettingsStatus | null>(null);
  const [activeProvider, setActiveProvider] = useState<AiProvider>('gemini');
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  // Gemini state
  const [geminiDetail, setGeminiDetail] = useState<GeminiDetailStatus | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('');
  const [geminiTemp, setGeminiTemp] = useState('');
  const [geminiTopP, setGeminiTopP] = useState('');
  const [geminiTopK, setGeminiTopK] = useState('');
  const [geminiSeed, setGeminiSeed] = useState('');
  const [geminiMaxTokens, setGeminiMaxTokens] = useState('');
  const [geminiTesting, setGeminiTesting] = useState(false);
  const [geminiAdvancedOpen, setGeminiAdvancedOpen] = useState(false);

  // OpenAI state
  const [openaiDetail, setOpenaiDetail] = useState<OpenAIDetailStatus | null>(null);
  const [openAiKey, setOpenAiKey] = useState('');
  const [openAiModel, setOpenAiModel] = useState('');
  const [openaiTemp, setOpenaiTemp] = useState('');
  const [openaiTopP, setOpenaiTopP] = useState('');
  const [openaiMaxTokens, setOpenaiMaxTokens] = useState('');
  const [openaiTesting, setOpenaiTesting] = useState(false);
  const [openaiAdvancedOpen, setOpenaiAdvancedOpen] = useState(false);

  const fetchAiSettings = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/ai-settings', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch AI settings');
      const payload = await response.json();
      setAiSettings(payload);
      setActiveProvider(payload.activeProvider || 'gemini');
    } catch (error: any) {
      setAiMessage(error.message || 'Failed to fetch AI settings');
    }
  }, []);

  const fetchGeminiDetail = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/ai-keys/gemini', { credentials: 'include' });
      if (!response.ok) return;
      const payload: GeminiDetailStatus = await response.json();
      setGeminiDetail(payload);
      setGeminiModel((current) => current || payload.model || '');
      setGeminiTemp((current) => current || payload.generation.temperature.value || '');
      setGeminiTopP((current) => current || payload.generation.topP.value || '');
      setGeminiTopK((current) => current || payload.generation.topK.value || '');
      setGeminiSeed((current) => current || payload.generation.seed.value || '');
      setGeminiMaxTokens((current) => current || payload.generation.maxOutputTokens.value || '');
    } catch { /* silent */ }
  }, []);

  const fetchOpenaiDetail = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/ai-keys/openai', { credentials: 'include' });
      if (!response.ok) return;
      const payload: OpenAIDetailStatus = await response.json();
      setOpenaiDetail(payload);
      setOpenAiModel((current) => current || payload.model || '');
      setOpenaiTemp((current) => current || payload.generation.temperature.value || '');
      setOpenaiTopP((current) => current || payload.generation.topP.value || '');
      setOpenaiMaxTokens((current) => current || payload.generation.maxOutputTokens.value || '');
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchAiSettings();
    fetchGeminiDetail();
    fetchOpenaiDetail();
  }, [fetchAiSettings, fetchGeminiDetail, fetchOpenaiDetail]);

  const saveAiSettings = async () => {
    setAiSaving(true);
    setAiMessage(null);
    try {
      // Save active provider
      const providerResponse = await fetch('/api/admin/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activeProvider }),
        credentials: 'include',
      });
      if (!providerResponse.ok) {
        const payload = await providerResponse.json();
        throw new Error(payload.error || 'Failed to save active AI provider');
      }

      // Save Gemini settings
      const geminiBody: Record<string, string | undefined> = {};
      if (geminiKey.trim()) geminiBody.apiKey = geminiKey.trim();
      if (geminiModel.trim()) geminiBody.model = geminiModel.trim();
      if (geminiTemp.trim()) geminiBody.temperature = geminiTemp.trim();
      if (geminiTopP.trim()) geminiBody.topP = geminiTopP.trim();
      if (geminiTopK.trim()) geminiBody.topK = geminiTopK.trim();
      if (geminiSeed.trim()) geminiBody.seed = geminiSeed.trim();
      if (geminiMaxTokens.trim()) geminiBody.maxOutputTokens = geminiMaxTokens.trim();
      if (Object.keys(geminiBody).length > 0) {
        const geminiResponse = await fetch('/api/admin/ai-keys/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody),
          credentials: 'include',
        });
        if (!geminiResponse.ok) {
          const payload = await geminiResponse.json();
          throw new Error(payload.error || 'Failed to save Gemini settings');
        }
      }

      // Save OpenAI settings
      const openaiBody: Record<string, string | undefined> = {};
      if (openAiKey.trim()) openaiBody.apiKey = openAiKey.trim();
      if (openAiModel.trim()) openaiBody.model = openAiModel.trim();
      if (openaiTemp.trim()) openaiBody.temperature = openaiTemp.trim();
      if (openaiTopP.trim()) openaiBody.topP = openaiTopP.trim();
      if (openaiMaxTokens.trim()) openaiBody.maxOutputTokens = openaiMaxTokens.trim();
      if (Object.keys(openaiBody).length > 0) {
        const openaiResponse = await fetch('/api/admin/ai-keys/openai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(openaiBody),
          credentials: 'include',
        });
        if (!openaiResponse.ok) {
          const payload = await openaiResponse.json();
          throw new Error(payload.error || 'Failed to save OpenAI settings');
        }
      }

      setGeminiKey('');
      setOpenAiKey('');
      setAiMessage('AI settings saved.');
      await Promise.all([fetchAiSettings(), fetchGeminiDetail(), fetchOpenaiDetail()]);
    } catch (error: any) {
      setAiMessage(error.message || 'Failed to save AI settings');
    } finally {
      setAiSaving(false);
    }
  };

  const testGemini = async () => {
    setGeminiTesting(true);
    setAiMessage(null);
    try {
      const response = await fetch('/api/admin/ai-keys/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: geminiKey.trim() || undefined,
          model: geminiModel.trim() || undefined,
        }),
        credentials: 'include',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to test Gemini key');
      }
      setAiMessage(
        payload.ok
          ? `Gemini key validated with ${payload.model}. Tokens used: ${payload.usage?.totalTokens ?? 0}.`
          : `Gemini validation failed: ${payload.note || 'Unknown error'}`
      );
      await fetchGeminiDetail();
    } catch (error: any) {
      setAiMessage(error.message || 'Failed to test Gemini key');
    } finally {
      setGeminiTesting(false);
    }
  };

  const testOpenAi = async () => {
    setOpenaiTesting(true);
    setAiMessage(null);
    try {
      const response = await fetch('/api/admin/ai-keys/openai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: openAiKey.trim() || undefined,
          model: openAiModel.trim() || undefined,
        }),
        credentials: 'include',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to test OpenAI key');
      }
      setAiMessage(
        payload.ok
          ? `OpenAI key validated with ${payload.model}. Tokens used: ${payload.usage?.totalTokens ?? 0}.`
          : `OpenAI validation failed: ${payload.note || 'Unknown error'}`
      );
      await fetchOpenaiDetail();
    } catch (error: any) {
      setAiMessage(error.message || 'Failed to test OpenAI key');
    } finally {
      setOpenaiTesting(false);
    }
  };

  const sourceLabel = (source?: string) => source || 'unknown';

  return (
    <AppShell contentClassName="space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Settings</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Configure Mighty Mapper connections and preferences
              </p>
            </header>

            {/* Active Provider Selection */}
            <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-ai-provider">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Key className="w-5 h-5 text-primary" />
                  AI Provider
                </CardTitle>
                <CardDescription>
                  Choose which AI provider powers mapping, research, and validation prompts.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="aiProvider">Active Provider</Label>
                  <select
                    id="aiProvider"
                    value={activeProvider}
                    onChange={(event) => setActiveProvider(event.target.value as AiProvider)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    data-testid="select-ai-provider"
                  >
                    <option value="gemini">Gemini</option>
                    <option value="openai">ChatGPT / OpenAI</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Source: {sourceLabel(aiSettings?.providerSource)}.
                    Gemini: {aiSettings?.gemini.configured ? 'configured' : 'not set'}.
                    OpenAI: {aiSettings?.openai.configured ? 'configured' : 'not set'}.
                  </p>
                </div>
                <Button onClick={saveAiSettings} disabled={aiSaving} data-testid="button-save-ai-settings">
                  {aiSaving ? 'Saving...' : 'Save All AI Settings'}
                </Button>
                {aiMessage && (
                  <p className="text-xs text-muted-foreground">{aiMessage}</p>
                )}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Gemini Card */}
              <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-gemini-settings">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="w-5 h-5 text-primary" />
                    Gemini
                  </CardTitle>
                  <CardDescription>
                    Configure Google Gemini API key, model, and generation parameters.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="geminiKey">API Key</Label>
                    <Input
                      id="geminiKey"
                      type="password"
                      value={geminiKey}
                      onChange={(event) => setGeminiKey(event.target.value)}
                      placeholder="AIza..."
                      className="bg-background border-input"
                      data-testid="input-gemini-key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Status: {geminiDetail?.configured ? 'configured' : 'not set'} via {sourceLabel(geminiDetail?.source)}
                      {geminiDetail?.updatedAt ? `, updated ${new Date(geminiDetail.updatedAt).toLocaleString()}` : ''}.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="geminiModel">Model</Label>
                    <Input
                      id="geminiModel"
                      value={geminiModel}
                      onChange={(event) => setGeminiModel(event.target.value)}
                      placeholder="gemini-1.5-flash"
                      className="bg-background border-input font-mono text-sm"
                      data-testid="input-gemini-model"
                    />
                    <p className="text-xs text-muted-foreground">
                      Source: {sourceLabel(geminiDetail?.modelSource)}.
                    </p>
                  </div>

                  <Collapsible open={geminiAdvancedOpen} onOpenChange={setGeminiAdvancedOpen}>
                    <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {geminiAdvancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      Advanced Generation Settings
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="geminiTemp" className="text-xs">Temperature</Label>
                          <Input
                            id="geminiTemp"
                            value={geminiTemp}
                            onChange={(event) => setGeminiTemp(event.target.value)}
                            placeholder="0.1"
                            className="bg-background border-input font-mono text-sm h-8"
                          />
                          <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(geminiDetail?.generation.temperature.source)}</p>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="geminiTopP" className="text-xs">Top P</Label>
                          <Input
                            id="geminiTopP"
                            value={geminiTopP}
                            onChange={(event) => setGeminiTopP(event.target.value)}
                            placeholder="1"
                            className="bg-background border-input font-mono text-sm h-8"
                          />
                          <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(geminiDetail?.generation.topP.source)}</p>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="geminiTopK" className="text-xs">Top K</Label>
                          <Input
                            id="geminiTopK"
                            value={geminiTopK}
                            onChange={(event) => setGeminiTopK(event.target.value)}
                            placeholder="40"
                            className="bg-background border-input font-mono text-sm h-8"
                          />
                          <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(geminiDetail?.generation.topK.source)}</p>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="geminiSeed" className="text-xs">Seed</Label>
                          <Input
                            id="geminiSeed"
                            value={geminiSeed}
                            onChange={(event) => setGeminiSeed(event.target.value)}
                            placeholder="(none)"
                            className="bg-background border-input font-mono text-sm h-8"
                          />
                          <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(geminiDetail?.generation.seed.source)}</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="geminiMaxTokens" className="text-xs">Max Output Tokens</Label>
                        <Input
                          id="geminiMaxTokens"
                          value={geminiMaxTokens}
                          onChange={(event) => setGeminiMaxTokens(event.target.value)}
                          placeholder="(default)"
                          className="bg-background border-input font-mono text-sm h-8"
                        />
                        <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(geminiDetail?.generation.maxOutputTokens.source)}</p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Button variant="secondary" onClick={testGemini} disabled={geminiTesting} className="w-full" data-testid="button-test-gemini">
                    {geminiTesting ? 'Testing...' : 'Test Gemini'}
                  </Button>
                </CardContent>
              </Card>

              {/* OpenAI Card */}
              <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-openai-settings">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="w-5 h-5 text-primary" />
                    ChatGPT / OpenAI
                  </CardTitle>
                  <CardDescription>
                    Configure OpenAI API key, model, and generation parameters.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="openaiKey">API Key</Label>
                    <Input
                      id="openaiKey"
                      type="password"
                      value={openAiKey}
                      onChange={(event) => setOpenAiKey(event.target.value)}
                      placeholder="sk-..."
                      className="bg-background border-input"
                      data-testid="input-openai-key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Status: {openaiDetail?.configured ? 'configured' : 'not set'} via {sourceLabel(openaiDetail?.source)}
                      {openaiDetail?.updatedAt ? `, updated ${new Date(openaiDetail.updatedAt).toLocaleString()}` : ''}.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="openaiModel">Model</Label>
                    <Input
                      id="openaiModel"
                      value={openAiModel}
                      onChange={(event) => setOpenAiModel(event.target.value)}
                      placeholder="gpt-4o-mini"
                      className="bg-background border-input font-mono text-sm"
                      data-testid="input-openai-model"
                    />
                    <p className="text-xs text-muted-foreground">
                      Source: {sourceLabel(openaiDetail?.modelSource)}.
                    </p>
                  </div>

                  <Collapsible open={openaiAdvancedOpen} onOpenChange={setOpenaiAdvancedOpen}>
                    <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                      {openaiAdvancedOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      Advanced Generation Settings
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor="openaiTemp" className="text-xs">Temperature</Label>
                          <Input
                            id="openaiTemp"
                            value={openaiTemp}
                            onChange={(event) => setOpenaiTemp(event.target.value)}
                            placeholder="0.1"
                            className="bg-background border-input font-mono text-sm h-8"
                          />
                          <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(openaiDetail?.generation.temperature.source)}</p>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="openaiTopP" className="text-xs">Top P</Label>
                          <Input
                            id="openaiTopP"
                            value={openaiTopP}
                            onChange={(event) => setOpenaiTopP(event.target.value)}
                            placeholder="1"
                            className="bg-background border-input font-mono text-sm h-8"
                          />
                          <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(openaiDetail?.generation.topP.source)}</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="openaiMaxTokens" className="text-xs">Max Output Tokens</Label>
                        <Input
                          id="openaiMaxTokens"
                          value={openaiMaxTokens}
                          onChange={(event) => setOpenaiMaxTokens(event.target.value)}
                          placeholder="(default)"
                          className="bg-background border-input font-mono text-sm h-8"
                        />
                        <p className="text-[10px] text-muted-foreground">Source: {sourceLabel(openaiDetail?.generation.maxOutputTokens.source)}</p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <Button variant="secondary" onClick={testOpenAi} disabled={openaiTesting} className="w-full" data-testid="button-test-openai">
                    {openaiTesting ? 'Testing...' : 'Test OpenAI'}
                  </Button>
                </CardContent>
              </Card>

              {/* Workbench Card */}
              <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-workbench-settings">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="w-5 h-5 text-primary" />
                    ATT&CK Workbench API
                  </CardTitle>
                  <CardDescription>
                    Configure connection to MITRE ATT&CK Workbench REST API
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="workbenchUrl">Workbench URL</Label>
                    <Input
                      id="workbenchUrl"
                      defaultValue="http://localhost:3000/api"
                      className="bg-background border-input font-mono text-sm"
                      data-testid="input-workbench-url"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workbenchToken">API Token (optional)</Label>
                    <Input
                      id="workbenchToken"
                      type="password"
                      placeholder="Enter API token"
                      className="bg-background border-input"
                      data-testid="input-workbench-token"
                    />
                  </div>
                  <Button variant="secondary" className="w-full" data-testid="button-test-workbench">
                    Test Connection
                  </Button>
                </CardContent>
              </Card>

              {/* n8n Card */}
              <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-n8n-settings">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Webhook className="w-5 h-5 text-primary" />
                    n8n Webhook Configuration
                  </CardTitle>
                  <CardDescription>
                    Configure n8n webhook endpoints for AI processing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="n8nUrl">n8n Base URL</Label>
                    <Input
                      id="n8nUrl"
                      defaultValue="http://localhost:5678"
                      className="bg-background border-input font-mono text-sm"
                      data-testid="input-n8n-url"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webhookPath">Webhook Path</Label>
                    <Input
                      id="webhookPath"
                      defaultValue="/webhook/analyze-product"
                      className="bg-background border-input font-mono text-sm"
                      data-testid="input-webhook-path"
                    />
                  </div>
                  <Button variant="secondary" className="w-full" data-testid="button-test-n8n">
                    Test Webhook
                  </Button>
                </CardContent>
              </Card>

              {/* Preferences Card */}
              <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-preferences">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SettingsIcon className="w-5 h-5 text-primary" />
                    Preferences
                  </CardTitle>
                  <CardDescription>
                    Application display and behavior settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Auto-refresh Coverage</Label>
                      <p className="text-xs text-muted-foreground">Automatically update coverage data</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-auto-refresh" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Show Technique Details</Label>
                      <p className="text-xs text-muted-foreground">Display tooltips on hover</p>
                    </div>
                    <Switch defaultChecked data-testid="switch-show-details" />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Compact Matrix View</Label>
                      <p className="text-xs text-muted-foreground">Use smaller cells in matrix</p>
                    </div>
                    <Switch data-testid="switch-compact-view" />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="secondary" data-testid="button-reset-settings">
                Reset to Defaults
              </Button>
              <Button data-testid="button-save-settings">
                Save Settings
              </Button>
            </div>
    </AppShell>
  );
}
