import { useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ThemeProvider } from "next-themes";
import { ParlayCartProvider } from "@/contexts/parlay-cart";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Bets from "@/pages/bets";
import MyBets from "@/pages/my-bets";
import LiveGames from "@/pages/live-games";
import LineHistory from "@/pages/line-history";
import Dashboard from "@/pages/dashboard";
import TrackRecord from "@/pages/track-record";
import TeamStatsPage from "@/pages/team-stats";
import BacktestPage from "@/pages/backtest";
import ParlayCorrelationPage from "@/pages/parlay-correlation";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  SidebarProvider,
  SidebarTrigger,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  Users,
  Target,
  RefreshCw,
  CloudDownload,
  AlertCircle,
  Tv,
  History,
  LayoutDashboard,
  Award,
  BarChart3,
  Wallet,
  FlaskConical,
  GitMerge,
  Zap,
} from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/bets" component={Bets} />
      <Route path="/my-bets" component={MyBets} />
      <Route path="/track-record" component={TrackRecord} />
      <Route path="/live" component={LiveGames} />
      <Route path="/line-history" component={LineHistory} />
      <Route path="/team-stats" component={TeamStatsPage} />
      <Route path="/backtest" component={BacktestPage} />
      <Route path="/parlay-correlations" component={ParlayCorrelationPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const navItems = [
  { title: "Dashboard",           url: "/dashboard",            icon: LayoutDashboard },
  { title: "Players",             url: "/",                     icon: Users },
  { title: "Team Stats",          url: "/team-stats",           icon: BarChart3 },
  { title: "Potential Bets",      url: "/bets",                 icon: Target },
  { title: "My Bets",             url: "/my-bets",              icon: Wallet },
  { title: "Track Record",        url: "/track-record",         icon: Award },
  { title: "Live Games",          url: "/live",                 icon: Tv },
  { title: "Line History",        url: "/line-history",         icon: History },
  { title: "Backtest Lab",        url: "/backtest",             icon: FlaskConical },
  { title: "Parlay Correlations", url: "/parlay-correlations",  icon: GitMerge },
];

/* Bottom nav shows the 5 most used routes on mobile */
const mobileNavItems = [
  { title: "Home",    url: "/dashboard",  icon: LayoutDashboard },
  { title: "Players", url: "/",           icon: Users },
  { title: "Bets",    url: "/bets",       icon: Target },
  { title: "My Bets", url: "/my-bets",    icon: Wallet },
  { title: "Live",    url: "/live",       icon: Tv },
];

function AppSidebar() {
  const [location] = useLocation();
  const { toast } = useToast();

  const { data: syncStatus } = useQuery<{ apiConfigured: boolean; message: string }>({
    queryKey: ["/api/sync/status"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/sync/players");
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Sync Complete", description: data.message });
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
    },
    onError: (error: Error) => {
      toast({ title: "Sync Failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Sidebar className="border-r border-sidebar-border/50">
      {/* Branding */}
      <SidebarHeader className="px-4 py-5 border-b border-sidebar-border/40">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative flex-shrink-0">
            <img
              src="/logo.png"
              alt="CourtSide Edge"
              className="w-9 h-9 rounded-xl shadow-md shadow-primary/30 group-hover:shadow-primary/50 transition-all duration-200"
            />
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-primary rounded-full border-2 border-sidebar" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-bold text-base leading-tight text-sidebar-foreground">CourtSide Edge</span>
            <span className="text-[11px] text-sidebar-foreground/50 font-medium uppercase tracking-wide">NBA Analytics</span>
          </div>
        </Link>
      </SidebarHeader>

      {/* Navigation */}
      <SidebarContent className="py-3 overflow-y-auto">
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35 px-4 mb-1">
            Menu
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 space-y-0.5">
              {navItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      className={`rounded-lg transition-all duration-150 h-9 ${
                        isActive
                          ? "bg-primary/15 text-primary font-semibold border-l-[3px] border-primary pl-[calc(0.75rem-3px)]"
                          : "text-sidebar-foreground/75 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                      }`}
                    >
                      <Link
                        href={item.url}
                        data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                        className="flex items-center gap-3 px-3"
                      >
                        <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? "text-primary" : ""}`} />
                        <span className="text-sm truncate">{item.title}</span>
                        {item.url === "/live" && (
                          <span className="ml-auto flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {/* Footer */}
      <SidebarFooter className="px-3 py-4 border-t border-sidebar-border/40 space-y-2">
        {syncStatus?.apiConfigured ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-lg border-sidebar-border/60 hover:border-primary/50 hover:bg-primary/8 transition-all group text-xs"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-players"
          >
            {syncMutation.isPending ? (
              <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin text-primary" />
            ) : (
              <CloudDownload className="w-3.5 h-3.5 mr-2 group-hover:text-primary transition-colors" />
            )}
            {syncMutation.isPending ? "Syncing…" : "Sync Data"}
          </Button>
        ) : (
          <div className="flex items-start gap-2 text-xs text-amber-400/80 p-2.5 rounded-xl bg-amber-500/8 border border-amber-500/20">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
            <span className="leading-tight">Add BALLDONTLIE_API_KEY for live data sync</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

/** Mobile bottom tab bar */
function MobileBottomNav() {
  const [location] = useLocation();
  return (
    <nav className="bottom-nav-mobile">
      {mobileNavItems.map((item) => {
        const isActive = location === item.url;
        return (
          <Link
            key={item.url}
            href={item.url}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl transition-all ${
              isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <div className={`relative p-1.5 rounded-xl transition-all ${isActive ? "bg-primary/15" : ""}`}>
              <item.icon className="w-5 h-5" />
              {item.url === "/live" && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-green-500 border border-card animate-pulse" />
              )}
            </div>
            <span className={`text-[10px] font-medium leading-none ${isActive ? "text-primary" : ""}`}>
              {item.title}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function App() {
  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        <ParlayCartProvider>
          <TooltipProvider>
            <SidebarProvider style={style as React.CSSProperties}>
              <div className="flex h-screen w-full overflow-hidden">
                {/* Sidebar — hidden on mobile, visible on md+ */}
                <div className="hidden md:flex">
                  <AppSidebar />
                </div>

                {/* Main content area */}
                <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
                  {/* Header */}
                  <header className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/60 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
                    <div className="flex items-center gap-2">
                      {/* Sidebar trigger on desktop */}
                      <SidebarTrigger
                        data-testid="button-sidebar-toggle"
                        className="hidden md:flex text-muted-foreground hover:text-foreground"
                      />
                      {/* Mobile: logo + brand */}
                      <div className="flex md:hidden items-center gap-2">
                        <img
                          src="/logo.png"
                          alt="CourtSide Edge"
                          className="w-7 h-7 rounded-lg shadow-sm shadow-primary/20"
                        />
                        <span className="font-bold text-sm text-foreground">CourtSide Edge</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Live indicator */}
                      <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground bg-card border border-border/60 px-2.5 py-1.5 rounded-full">
                        <Zap className="w-3 h-3 text-primary" />
                        <span>NBA Analytics</span>
                      </div>
                      <ThemeToggle />
                    </div>
                  </header>

                  {/* Page content — extra bottom padding on mobile for nav bar */}
                  <main className="flex-1 overflow-auto pb-[64px] md:pb-0">
                    <Router />
                  </main>
                </div>
              </div>

              {/* Mobile bottom navigation */}
              <MobileBottomNav />
            </SidebarProvider>
            <Toaster />
          </TooltipProvider>
        </ParlayCartProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
