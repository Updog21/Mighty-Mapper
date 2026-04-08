import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  Cpu,
  FileText,
  GitBranch,
  Layers,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  Shield,
  Target,
  Users,
  Wrench,
  LogOut,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/", label: "Coverage Map", icon: LayoutDashboard },
      { href: "/products", label: "Security Stack", icon: Shield },
      { href: "/ai-mapper", label: "Auto Mapper", icon: Cpu },
      { href: "/path-builder", label: "Path Builder", icon: GitBranch },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/techniques", label: "Techniques", icon: Target },
      { href: "/data-components", label: "Data Components", icon: Layers },
      { href: "/detection-strategies", label: "Strategies", icon: FileText },
      { href: "/detections", label: "Detections", icon: Boxes },
      { href: "/threats", label: "Threat Groups", icon: Activity },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/admin", label: "Admin Tasks", icon: Wrench },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/users", label: "Users", icon: Users },
    ],
  },
  {
    label: "Reference",
    items: [
      { href: "/documentation", label: "Documentation", icon: BookOpen },
    ],
  },
];

const initialSectionState: Record<string, boolean> = {
  Workspace: true,
  Intelligence: true,
  Admin: true,
  Reference: false,
};

const routeLabels: Array<{ match: (path: string) => boolean; label: string }> = [
  { match: (path) => path === "/", label: "Coverage Map" },
  { match: (path) => path.startsWith("/products"), label: "Security Stack" },
  { match: (path) => path.startsWith("/users"), label: "Users" },
  { match: (path) => path.startsWith("/path-builder"), label: "Path Builder" },
  { match: (path) => path.startsWith("/techniques"), label: "Techniques" },
  { match: (path) => path.startsWith("/data-components"), label: "Data Components" },
  { match: (path) => path.startsWith("/detection-strategies"), label: "Detection Strategies" },
  { match: (path) => path.startsWith("/detections"), label: "Detections" },
  { match: (path) => path.startsWith("/documentation"), label: "Documentation" },
  { match: (path) => path.startsWith("/ai-mapper"), label: "Auto Mapper" },
  { match: (path) => path.startsWith("/threats"), label: "Threat Groups" },
  { match: (path) => path.startsWith("/admin"), label: "Admin Tasks" },
  { match: (path) => path.startsWith("/settings"), label: "Settings" },
];

function isActivePath(currentPath: string, href: string) {
  if (href === "/") {
    return currentPath === "/";
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function getCurrentLabel(path: string) {
  return routeLabels.find((entry) => entry.match(path))?.label ?? "Workspace";
}

function MapperMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className}>
      <path
        d="M4.5 7.5 12 4l7.5 3.5v9L12 20l-7.5-3.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 4v16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.5 7.5 12 11l7.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="12" cy="11" r="1.75" fill="currentColor" />
    </svg>
  );
}

function ShellSidebar({ currentPath }: { currentPath: string }) {
  const [openSections, setOpenSections] = useState(initialSectionState);

  const toggleSection = (label: string) => {
    setOpenSections((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <Link href="/">
          <div className="flex cursor-pointer items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-secondary text-primary">
              <MapperMark className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Mighty Mapper</h1>
              <p className="text-xs text-muted-foreground">ATT&amp;CK coverage workspace</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {navSections.map((section, sectionIdx) => (
          <div key={section.label}>
            <button
              type="button"
              onClick={() => toggleSection(section.label)}
              className={cn(
                "mb-2 flex w-full items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground",
                sectionIdx > 0 && "mt-2"
              )}
            >
              {section.label}
              {openSections[section.label] ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>

            {openSections[section.label] &&
              section.items.map((item) => {
                const isActive = isActivePath(currentPath, item.href);

                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "group flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "border-border bg-secondary text-foreground"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-secondary hover:text-foreground"
                      )}
                    >
                      <item.icon
                        className={cn(
                          "h-4 w-4 transition-colors",
                          isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                        )}
                      />
                      {item.label}
                    </div>
                  </Link>
                );
              })}
          </div>
        ))}
      </div>

      <div className="space-y-2 border-t border-border p-4">
        <SidebarLogout />
      </div>
    </div>
  );
}

function SidebarLogout() {
  const { logout } = useAuth();

  return (
    <button
      type="button"
      onClick={() => logout()}
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
    >
      <LogOut className="h-4 w-4" />
      Sign Out
    </button>
  );
}

type AppShellProps = {
  children: ReactNode;
  contentClassName?: string;
};

export function AppShell({ children, contentClassName }: AppShellProps) {
  const [location] = useLocation();
  const currentLabel = getCurrentLabel(location);

  return (
    <div className="flex min-h-screen bg-background font-sans text-foreground selection:bg-primary/30 selection:text-primary-foreground">
      <aside className="sticky top-0 z-20 hidden h-screen w-64 md:block">
        <ShellSidebar currentPath={location} />
      </aside>

      <main className="flex min-h-screen min-w-0 flex-1 flex-col overflow-hidden">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4 md:px-6">
          <div className="flex items-center gap-4 md:hidden">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="border-r border-border bg-background p-0">
                <ShellSidebar currentPath={location} />
              </SheetContent>
            </Sheet>
            <span className="font-semibold">Mighty Mapper</span>
          </div>

          <div className="hidden items-center gap-2 text-sm text-muted-foreground md:flex">
            <span className="text-foreground">Mighty Mapper</span>
            <span>/</span>
            <span>{currentLabel}</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search products, techniques, detections..."
                className="h-9 w-80 rounded-md border-border bg-card pl-9 text-sm focus-visible:ring-primary/50"
              />
            </div>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5 text-muted-foreground" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className={cn("min-w-0", contentClassName)}>{children}</div>
        </div>
      </main>
    </div>
  );
}
