import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Settings as SettingsIcon, Server, Database, Webhook, Key } from 'lucide-react';

export default function Settings() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />
      
      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Settings</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Configure OpenTidal connections and preferences
              </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

              <Card className="bg-card/50 backdrop-blur border-border" data-testid="card-openai-settings">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Key className="w-5 h-5 text-primary" />
                    OpenAI Configuration
                  </CardTitle>
                  <CardDescription>
                    API key for AI-powered technique mapping (used by n8n)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="openaiKey">OpenAI API Key</Label>
                    <Input 
                      id="openaiKey"
                      type="password"
                      placeholder="sk-..."
                      className="bg-background border-input"
                      data-testid="input-openai-key"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="model">Model</Label>
                    <Input 
                      id="model"
                      defaultValue="gpt-4"
                      className="bg-background border-input font-mono text-sm"
                      data-testid="input-model"
                    />
                  </div>
                </CardContent>
              </Card>

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
          </div>
        </div>
      </main>
    </div>
  );
}
