/**
 * BetsSkeleton component - loading skeleton for bets
 */

import { Card, CardContent } from "@/components/ui/card";

export function BetsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} className="rounded-xl border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 rounded-lg shimmer" />
              <div className="w-8 h-4 rounded shimmer" />
              <div className="w-10 h-10 rounded-lg shimmer" />
            </div>
            <div className="mt-3 pt-3 border-t border-border/50 flex justify-between">
              <div className="w-16 h-4 rounded shimmer" />
              <div className="w-14 h-5 rounded shimmer" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
