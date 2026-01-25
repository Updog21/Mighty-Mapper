import { Sidebar } from '@/components/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BookOpen, Layers, Cpu, Shield, Wrench } from 'lucide-react';

export default function Documentation() {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar variant="dashboard" />

      <main className="flex-1 overflow-auto">
        <div className="grid-pattern min-h-full">
          <div className="p-6 space-y-6">
            <header>
              <h1 className="text-2xl font-bold text-foreground tracking-tight">Documentation</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Learn how OpenTidal works and how to use each feature.
              </p>
            </header>

            <Card className="bg-card/50 backdrop-blur border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-primary" />
                  Getting Started
                </CardTitle>
                <CardDescription>Core workflow for mapping products to ATT&CK</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>1. Start on the Home page to search for security products.</p>
                <p>2. Open a product to view coverage, techniques, and data components.</p>
                <p>3. Use Auto Mapper to create mappings for unmatched products.</p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-primary" />
                    Data Components
                  </CardTitle>
                  <CardDescription>What the Data Components page provides</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>Browse MITRE data components and the data sources they belong to.</p>
                  <p>Use the catalog to understand what telemetry a product can provide.</p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    Detection Strategies
                  </CardTitle>
                  <CardDescription>How strategies connect to ATT&CK techniques</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>Review MITRE detection strategies flattened for quick lookup.</p>
                  <p>Use these definitions to align analytics and coverage reporting.</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-primary" />
                    Auto Mapper
                  </CardTitle>
                  <CardDescription>Product mapping workflow</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>Create mappings for products that are not in the CTID dataset.</p>
                  <p>Review the details and run Auto Map to store the mapping.</p>
                </CardContent>
              </Card>

              <Card className="bg-card/50 backdrop-blur border-border">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="w-5 h-5 text-primary" />
                    Admin Tasks
                  </CardTitle>
                  <CardDescription>Keep local data synchronized</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>Run MITRE Data Sync to refresh definitions and sources.</p>
                  <p>Update Sigma rules and monitor system status in one place.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
