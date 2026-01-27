import { useState, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Camera,
  Upload,
  Clipboard,
  Loader2,
  Check,
  X,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Save,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface ParsedPick {
  playerName: string;
  team: string;
  position: string;
  jerseyNumber?: string;
  stat: string;
  statAbbr: string;
  line: number;
  side: "over" | "under";
  actualValue?: number;
  result?: "hit" | "miss" | "pending";
}

interface ParsedParlay {
  parlayType: string;
  entryAmount: number;
  potentialPayout: number;
  picks: ParsedPick[];
  games: Array<{
    awayTeam: string;
    homeTeam: string;
    awayScore?: number;
    homeScore?: number;
    status: string;
  }>;
  screenshotDate: string;
  platform: string;
  calculatedResult?: {
    result: "win" | "loss" | "push" | "pending";
    hitsNeeded: number;
    hits: number;
  };
}

interface ScreenshotUploadProps {
  onParlayAdded?: () => void;
}

export function ScreenshotUpload({ onParlayAdded }: ScreenshotUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedParlay | null>(null);
  const [showResultDialog, setShowResultDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse screenshot mutation
  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("screenshot", file);

      const response = await fetch("/api/screenshots/parse", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to parse screenshot");
      }

      return response.json();
    },
    onSuccess: (data) => {
      setParsedData(data.data);
      setShowResultDialog(true);
    },
  });

  // Save parlay mutation
  const saveMutation = useMutation({
    mutationFn: async (parsedParlay: ParsedParlay) => {
      const response = await apiRequest("POST", "/api/screenshots/save-parlay", {
        parsedParlay,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parlays"] });
      setShowResultDialog(false);
      setParsedData(null);
      setPreviewUrl(null);
      onParlayAdded?.();
    },
  });

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    // Create preview
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Parse the screenshot
    parseMutation.mutate(file);
  }, [parseMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);

  const handlePaste = useCallback(async () => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const file = new File([blob], "clipboard-image.png", { type });
            handleFile(file);
            return;
          }
        }
      }
      alert("No image found in clipboard");
    } catch (error) {
      console.error("Failed to read clipboard:", error);
      alert("Failed to read clipboard. Make sure you have an image copied.");
    }
  }, [handleFile]);

  const getResultColor = (result?: string) => {
    switch (result) {
      case "hit":
      case "win":
        return "text-emerald-400";
      case "miss":
      case "loss":
        return "text-rose-400";
      default:
        return "text-yellow-400";
    }
  };

  const getResultBadge = (result?: string) => {
    switch (result) {
      case "hit":
        return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">HIT</Badge>;
      case "miss":
        return <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30">MISS</Badge>;
      default:
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">PENDING</Badge>;
    }
  };

  return (
    <>
      <Card className="rounded-xl border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-primary" />
            Import from Screenshot
          </CardTitle>
          <CardDescription>
            Upload a PrizePicks screenshot to automatically add it to your tracker
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`
              relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
              ${isDragging
                ? "border-primary bg-primary/5"
                : "border-border/50 hover:border-primary/50 hover:bg-muted/30"
              }
              ${parseMutation.isPending ? "pointer-events-none opacity-50" : ""}
            `}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileInput}
            />

            {parseMutation.isPending ? (
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <p className="text-muted-foreground">Analyzing screenshot...</p>
              </div>
            ) : previewUrl ? (
              <div className="flex flex-col items-center gap-3">
                <img
                  src={previewUrl}
                  alt="Screenshot preview"
                  className="max-h-40 rounded-lg shadow-lg"
                />
                <p className="text-sm text-muted-foreground">Click or drop to upload a different screenshot</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <Upload className="w-10 h-10 text-muted-foreground" />
                <div>
                  <p className="font-medium">Drop your PrizePicks screenshot here</p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handlePaste}
              disabled={parseMutation.isPending}
            >
              <Clipboard className="w-4 h-4 mr-2" />
              Paste from Clipboard
            </Button>
          </div>

          {parseMutation.isError && (
            <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-rose-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">{parseMutation.error?.message || "Failed to parse screenshot"}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Result Dialog */}
      <Dialog open={showResultDialog} onOpenChange={setShowResultDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="w-5 h-5 text-emerald-400" />
              Screenshot Parsed Successfully
            </DialogTitle>
            <DialogDescription>
              Review the parsed bets below and save to your tracker
            </DialogDescription>
          </DialogHeader>

          {parsedData && (
            <div className="space-y-4">
              {/* Parlay Info */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                <div>
                  <div className="font-medium">{parsedData.parlayType}</div>
                  <div className="text-sm text-muted-foreground">
                    ${parsedData.entryAmount} to win ${parsedData.potentialPayout}
                  </div>
                </div>
                {parsedData.calculatedResult && (
                  <Badge
                    className={`${
                      parsedData.calculatedResult.result === "win"
                        ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                        : parsedData.calculatedResult.result === "loss"
                        ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                        : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                    }`}
                  >
                    {parsedData.calculatedResult.hits}/{parsedData.picks.length} Hits
                  </Badge>
                )}
              </div>

              {/* Games */}
              {parsedData.games.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-medium text-muted-foreground">Games</div>
                  {parsedData.games.map((game, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-2 rounded bg-muted/20 text-sm"
                    >
                      <span>
                        {game.awayTeam} {game.awayScore ?? ""} @ {game.homeTeam} {game.homeScore ?? ""}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {game.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}

              {/* Picks */}
              <div className="space-y-2">
                <div className="text-sm font-medium text-muted-foreground">
                  Picks ({parsedData.picks.length})
                </div>
                {parsedData.picks.map((pick, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-muted/30 border border-border/50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{pick.playerName}</div>
                        <div className="text-xs text-muted-foreground">
                          {pick.team} • {pick.position}
                          {pick.jerseyNumber && ` • #${pick.jerseyNumber}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-sm font-medium">
                            {pick.side === "over" ? (
                              <span className="flex items-center gap-1 text-emerald-400">
                                <TrendingUp className="w-3 h-3" />
                                O {pick.line}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-rose-400">
                                <TrendingDown className="w-3 h-3" />
                                U {pick.line}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{pick.stat}</div>
                        </div>
                        {getResultBadge(pick.result)}
                      </div>
                    </div>
                    {pick.actualValue !== undefined && (
                      <div className="mt-2 pt-2 border-t border-border/30">
                        <span className="text-sm">
                          Actual:{" "}
                          <span className={`font-mono font-bold ${getResultColor(pick.result)}`}>
                            {pick.actualValue}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowResultDialog(false);
                setParsedData(null);
                setPreviewUrl(null);
              }}
            >
              <X className="w-4 h-4 mr-2" />
              Discard
            </Button>
            <Button
              onClick={() => parsedData && saveMutation.mutate(parsedData)}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save to Tracker
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
