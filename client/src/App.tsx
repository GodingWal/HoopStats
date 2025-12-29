import { useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Bets from "@/pages/bets";
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
import { Users, Target, TrendingUp, RefreshCw, CloudDownload, AlertCircle } from "lucide-react";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/bets" component={Bets} />
      <Route component={NotFound} />
    </Switch>
  );
}

const navItems = [
  {
    title: "Players",
    url: "/",
    icon: Users,
  },
  {
    title: "Potential Bets",
    url: "/bets",
    icon: Target,
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
    <Sidebar>
      <SidebarHeader className="p-4 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-primary" />
          <span className="font-bold text-lg">NBA Props</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    isActive={location === item.url}
                  >
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 border-t border-sidebar-border">
        {syncStatus?.apiConfigured ? (
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            data-testid="button-sync-players"
          >
            {syncMutation.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CloudDownload className="w-4 h-4 mr-2" />
            )}
            {syncMutation.isPending ? "Syncing..." : "Sync NBA Data"}
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span>Add BALLDONTLIE_API_KEY to sync live data</span>
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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center gap-2 p-2 border-b bg-background sticky top-0 z-50">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
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
  );
}

export default App;
