import { Link, useLocation } from 'wouter';
import {
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
  BookOpen,
  Target,
  GitBranch,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useTheme } from '@/lib/theme';

function AntikytheraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      {/* Main gear teeth */}
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="11" cy="11" r="7.5" />
        {/* Teeth */}
        <line x1="11" y1="1" x2="11" y2="3" />
        <line x1="11" y1="19" x2="11" y2="21" />
        <line x1="1" y1="11" x2="3" y2="11" />
        <line x1="19" y1="11" x2="21" y2="11" />
        <line x1="3.93" y1="3.93" x2="5.34" y2="5.34" />
        <line x1="16.66" y1="16.66" x2="18.07" y2="18.07" />
        <line x1="3.93" y1="18.07" x2="5.34" y2="16.66" />
        <line x1="16.66" y1="5.34" x2="18.07" y2="3.93" />
      </g>
      {/* Inner ring */}
      <circle cx="11" cy="11" r="4.5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {/* Dial hands */}
      <line x1="11" y1="11" x2="11" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform="rotate(-30 11 11)" />
      <line x1="11" y1="11" x2="11" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" transform="rotate(80 11 11)" />
      {/* Center dot */}
      <circle cx="11" cy="11" r="1.5" fill="currentColor" />
      {/* Small secondary gear */}
      <circle cx="19" cy="19" r="3" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="19" cy="19" r="1" fill="currentColor" />
      <line x1="19" y1="15.5" x2="19" y2="16.5" stroke="currentColor" strokeWidth="1" />
      <line x1="19" y1="21.5" x2="19" y2="22.5" stroke="currentColor" strokeWidth="1" />
      <line x1="15.5" y1="19" x2="16.5" y2="19" stroke="currentColor" strokeWidth="1" />
      <line x1="21.5" y1="19" x2="22.5" y2="19" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

type SidebarVariant = 'default' | 'dashboard';

const navItems = [
  { href: '/', label: 'Coverage Map', icon: LayoutDashboard },
  { href: '/ai-mapper', label: 'Auto Mapper', icon: Cpu },
  { href: '/products', label: 'Security Stack', icon: Database },
  { href: '/path-builder', label: 'Path Builder', icon: GitBranch },
  { href: '/techniques', label: 'Techniques', icon: Target },
  { href: '/detections', label: 'Detections', icon: Boxes },
  { href: '/threats', label: 'Threat Groups', icon: Activity },
];

const docItems = [
  { href: '/admin', label: 'Admin Tasks', icon: Wrench },
];

const dashboardNavItems = [
  { icon: LayoutDashboard, label: 'Home', href: '/' },
  { icon: Home, label: 'Products', href: '/products' },
  { icon: GitBranch, label: 'Path Builder', href: '/path-builder' },
  { icon: Layers, label: 'Data Components', href: '/data-components' },
  { icon: Target, label: 'Techniques', href: '/techniques' },
  { icon: FileText, label: 'Detection Strategies', href: '/detection-strategies' },
  { icon: Boxes, label: 'Detections', href: '/detections' },
  { icon: BookOpen, label: 'Documentation', href: '/documentation' },
  { icon: Cpu, label: 'Auto Mapper', href: '/ai-mapper' },
  { icon: Activity, label: 'Threat Groups', href: '/threats' },
  { icon: Wrench, label: 'Admin Tasks', href: '/admin' },
];

function isActivePath(currentPath: string, href: string) {
  if (href === '/') return currentPath === '/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

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
            <AntikytheraIcon className="w-6 h-6 text-primary" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">Antikythera</h1>
              <p className="text-xs text-muted-foreground font-mono">v1.0.0</p>
            </div>
          )}
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = isActivePath(location, item.href);
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
          const isActive = isActivePath(location, item.href);
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
    <aside className="w-60 h-full border-r border-border bg-sidebar flex-shrink-0 flex flex-col">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <AntikytheraIcon className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-foreground">Antikythera</span>
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
            const isActive = item.href ? isActivePath(location, item.href) : (item as any).active;
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
        <Link
          href="/settings"
          className={cn(
            "w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors",
            isActivePath(location, "/settings")
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          data-testid="link-dashboard-settings"
        >
          <Settings className="w-4 h-4" />
          Settings
        </Link>
        <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground rounded-md">
          <HelpCircle className="w-4 h-4" />
          Help
        </button>
      </div>
    </aside>
  );
}
