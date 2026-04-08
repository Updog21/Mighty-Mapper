import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/hooks/useAuth";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import AIMapper from "@/pages/AIMapper";
import Products from "@/pages/Products";
import Threats from "@/pages/Threats";
import Settings from "@/pages/Settings";
import AdminTasks from "@/pages/AdminTasks";
import DataComponents from "@/pages/DataComponents";
import DetectionStrategies from "@/pages/DetectionStrategies";
import Documentation from "@/pages/Documentation";
import Detections from "@/pages/Detections";
import Techniques from "@/pages/Techniques";
import TechniqueDetail from "@/pages/TechniqueDetail";
import PathBuilder from "@/pages/PathBuilder";
import UsersPage from "@/pages/Users";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ai-mapper" component={AIMapper} />
      <Route path="/products/:productId" component={Products} />
      <Route path="/products" component={Products} />
      <Route path="/data-components" component={DataComponents} />
      <Route path="/detection-strategies" component={DetectionStrategies} />
      <Route path="/detections" component={Detections} />
      <Route path="/path-builder" component={PathBuilder} />
      <Route path="/techniques/:techniqueId" component={TechniqueDetail} />
      <Route path="/techniques" component={Techniques} />
      <Route path="/documentation" component={Documentation} />
      <Route path="/threats" component={Threats} />
      <Route path="/settings" component={Settings} />
      <Route path="/admin" component={AdminTasks} />
      <Route path="/users" component={UsersPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <AuthGate />
      </ErrorBoundary>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
