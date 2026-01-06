import { useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Bets from "@/pages/bets";
import LiveGames from "@/pages/live-games";
import LiveOdds from "@/pages/live-odds";
import ProjectionsPage from "@/pages/projections";
import Dashboard from "@/pages/dashboard";
import TrackRecord from "@/pages/track-record";
import TeamStatsPage from "@/pages/team-stats";
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
import { Users, Target, TrendingUp, RefreshCw, CloudDownload, AlertCircle, Tv, BrainCircuit, DollarSign, LayoutDashboard, Award, BarChart3 } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/bets" component={Bets} />
      <Route path="/track-record" component={TrackRecord} />
      <Route path="/live" component={LiveGames} />
      <Route path="/odds" component={LiveOdds} />
      <Route path="/projections" component={ProjectionsPage} />
      <Route path="/team-stats" component={TeamStatsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const navItems = [
  {
    title: "Dashboard",
    url: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Players",
    url: "/",
    icon: Users,
  },
  {
    title: "Team Stats",
    url: "/team-stats",
    icon: BarChart3,
  },
  {
    title: "Potential Bets",
    url: "/bets",
    icon: Target,
  },
  {
    title: "Track Record",
    url: "/track-record",
    icon: Award,
  },
  {
    title: "Live Games",
    url: "/live",
    icon: Tv,
  },
  {
    title: "Live Odds",
    url: "/odds",
    icon: DollarSign,
  },
  {
    title: "AI Projections",
    url: "/projections",
    icon: BrainCircuit,
  },
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
      toast({
        title: "Sync Complete",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/players"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bets"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Sidebar className="border-r-0">
      <SidebarHeader className="p-4 border-b border-sidebar-border/50">
        <Link href="/" className="flex items-center gap-3 group">
          <img src="/logo.png" alt="CourtSide Edge" className="w-10 h-10 rounded-xl shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-all" />
          <div>
            <span className="font-bold text-lg block">CourtSide Edge</span>
            <span className="text-xs text-muted-foreground">NBA Analytics</span>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent className="py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground/70 px-4 mb-2">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="px-2 space-y-1">
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    className={`rounded-lg transition-all duration-200 ${location === item.url
                      ? 'bg-primary/10 text-primary border-l-2 border-primary shadow-sm'
                      : 'hover:bg-muted/50 hover:translate-x-1'
                      }`}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className={`w-4 h-4 ${location === item.url ? 'text-primary' : ''}`} />
                      <span className="font-medium">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-sidebar-border/50">
        {syncStatus?.apiConfigured ? (
          <Button
            variant="outline"
            className="w-full rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all group"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-players"
          >
            {syncMutation.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin text-primary" />
            ) : (
              <CloudDownload className="w-4 h-4 mr-2 group-hover:text-primary transition-colors" />
            )}
            {syncMutation.isPending ? "Syncing..." : "Sync Data"}
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <span>Add BALLDONTLIE_API_KEY for live data sync</span>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function App() {
  const style = {
    "--sidebar-width": "14rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0">
                <header className="flex items-center justify-between gap-2 p-2 border-b bg-background sticky top-0 z-50">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <ThemeToggle />
                </header>
                <main className="flex-1 overflow-auto">
                  <Router />
                </main>
              </div>
            </div>
          </SidebarProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;

