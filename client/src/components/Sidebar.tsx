import { Link, useLocation } from 'wouter';
import {
  Shield,
  LayoutDashboard,
  Cpu,
  Settings,
  Activity,
  Database,
  ChevronLeft,
  ChevronRight,
  Wrench,
  Search,
  ExternalLink,
  Boxes,
  Sun,
  Moon,
  HelpCircle,
  Home,
  Layers,
  FileText,
  BookOpen
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useTheme } from '@/lib/theme';

type SidebarVariant = 'default' | 'dashboard';

const navItems = [
  { href: '/', label: 'Coverage Map', icon: LayoutDashboard },
  { href: '/ai-mapper', label: 'Auto Mapper', icon: Cpu },
  { href: '/products', label: 'Security Stack', icon: Database },
  { href: '/detections', label: 'Detections', icon: Boxes },
  { href: '/threats', label: 'Threat Groups', icon: Activity },
];

const docItems = [
  { href: '/admin', label: 'Admin Tasks', icon: Wrench },
];

const dashboardNavItems = [
  { icon: LayoutDashboard, label: 'Home', href: '/' },
  { icon: Home, label: 'Products', href: '/products' },
  { icon: Layers, label: 'Data Components', href: '/data-components' },
  { icon: FileText, label: 'Detection Strategies', href: '/detection-strategies' },
  { icon: Boxes, label: 'Detections', href: '/detections' },
  { icon: BookOpen, label: 'Documentation', href: '/documentation' },
  { icon: Cpu, label: 'Auto Mapper', href: '/ai-mapper' },
  { icon: Activity, label: 'Threat Groups', href: '/threats' },
  { icon: Wrench, label: 'Admin Tasks', href: '/admin' },
];

export function Sidebar({ variant = 'default' }: { variant?: SidebarVariant }) {
  if (variant === 'dashboard') {
    return <DashboardSidebar />;
  }

  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside 
      className={cn(
        "h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-64"
      )}
      data-testid="sidebar"
    >
      <div className="p-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-3" data-testid="link-logo">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center glow-primary">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">OpenTidal</h1>
              <p className="text-xs text-muted-foreground font-mono">v1.0.0</p>
            </div>
          )}
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group",
                isActive
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
              )} />
              {!collapsed && (
                <span className="font-medium text-sm">{item.label}</span>
              )}
            </Link>
          );
        })}

        {/* Documentation Section */}
        {!collapsed && (
          <div className="pt-4 pb-2">
            <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Documentation
            </p>
          </div>
        )}
        {collapsed && <div className="h-4" />}

        {docItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group",
                isActive
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <item.icon className={cn(
                "w-5 h-5 transition-colors",
                isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
              )} />
              {!collapsed && (
                <span className="font-medium text-sm">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <Link
          href="/settings"
          data-testid="link-settings"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Settings className="w-5 h-5" />
          {!collapsed && <span className="font-medium text-sm">Settings</span>}
        </Link>
        
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors mt-1"
          data-testid="button-collapse-sidebar"
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          {!collapsed && <span className="font-medium text-sm">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function DashboardSidebar() {
  const [location] = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <aside className="w-60 border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">OpenTidal</span>
        </div>
      </div>

      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="pl-8 h-9 text-sm bg-background"
            data-testid="input-sidebar-search"
          />
        </div>
      </div>

      <nav className="flex-1 px-3">
        <div className="space-y-1">
          {dashboardNavItems.map((item) => {
            const isActive = item.href ? location === item.href : item.active;
            const navClassName = `w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors ${
              isActive
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`;
            const content = (
              <>
                <item.icon className="w-4 h-4" />
                {item.label}
              </>
            );

            if (item.href) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={navClassName}
                  data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
                >
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={item.label}
                className={navClassName}
                data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                {content}
              </button>
            );
          })}
        </div>

        <div className="mt-6 pt-6 border-t border-border">
          <p className="px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
            Resources
          </p>
          <div className="space-y-1">
            <a
              href="https://attack.mitre.org"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-md"
            >
              <ExternalLink className="w-4 h-4" />
              MITRE ATT&CK
            </a>
            <a
              href="https://github.com/center-for-threat-informed-defense"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-md"
            >
              <Boxes className="w-4 h-4" />
              CTID GitHub
            </a>
          </div>
        </div>
      </nav>

      <div className="p-3 border-t border-border">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-md"
          data-testid="button-theme-toggle"
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-md">
          <Settings className="w-4 h-4" />
          Settings
        </button>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-md">
          <HelpCircle className="w-4 h-4" />
          Help
        </button>
      </div>
    </aside>
  );
}
