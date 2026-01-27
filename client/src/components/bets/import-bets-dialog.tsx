import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, AlertCircle, Upload, Loader2, Image as ImageIcon, FileText } from "lucide-react";
import { useParlayCart } from "@/contexts/parlay-cart";
import { parsePrizePicksLog } from "./utils";
import { apiRequest } from "@/lib/queryClient";

interface ImportBetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ImportBetsDialog({ open, onOpenChange }: ImportBetsDialogProps) {
  const [activeTab, setActiveTab] = useState<"text" | "image">("text");
  const [logText, setLogText] = useState("");
  const [parsedPicks, setParsedPicks] = useState<ReturnType<typeof parsePrizePicksLog>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { addMultiplePicks } = useParlayCart();

  const handleParseText = () => {
    try {
      const picks = parsePrizePicksLog(logText);
      if (picks.length === 0) {
        setError("Couldn't parse any bets. Make sure the format is correct.");
      } else {
        setParsedPicks(picks);
        setError(null);
      }
    } catch (e) {
      setError("Failed to parse transaction log. Check the format.");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setParsedPicks([]);

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;

        try {
          const res = await apiRequest("POST", "/api/bets/upload-screenshot", { image: base64String });
          const data = await res.json();

          if (Array.isArray(data)) {
            // Map the API result to our internal format
            // API returns: { playerName, line, stat, side }
            const picks = data.map((bet: any) => ({
              playerName: bet.playerName,
              line: bet.line,
              stat: bet.stat,
              statAbbr: bet.stat.toUpperCase(), // Simplistic mapping, user can verify
              side: (bet.side || "over").toLowerCase() as "over" | "under",
            }));

            if (picks.length === 0) {
              setError("No bets could be identified in the image.");
            } else {
              setParsedPicks(picks);
            }
          } else {
            setError("Unexpected response format from server.");
          }
        } catch (err) {
          console.error(err);
          setError("Failed to process image. Please try again.");
        } finally {
          setIsUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError("Error reading file.");
      setIsUploading(false);
    }
  };

  const handleImport = () => {
    const today = new Date().toISOString().split('T')[0];
    const cartPicks = parsedPicks.map(pick => ({
      playerId: pick.playerName.toLowerCase().replace(/\s+/g, '-'),
      playerName: pick.playerName,
      team: "",
      stat: pick.stat,
      statTypeAbbr: pick.statAbbr,
      line: pick.line,
      gameDate: today,
      imageUrl: undefined // Add this if we have it
    }));

    addMultiplePicks(cartPicks);

    // Reset state
    setLogText("");
    setParsedPicks([]);
    setActiveTab("text");
    onOpenChange(false);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Bets</DialogTitle>
          <DialogDescription>
            Import bets from text logs or screenshots
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "text" | "image")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="text" className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Text Log
            </TabsTrigger>
            <TabsTrigger value="image" className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Screenshot
            </TabsTrigger>
          </TabsList>

          <TabsContent value="text" className="space-y-4">
            <div>
              <Label htmlFor="log-text">Transaction Log</Label>
              <textarea
                id="log-text"
                className="w-full h-40 p-3 mt-1 rounded-lg border bg-background text-sm font-mono resize-none focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                placeholder={`Peyton Watson\nMore than 23.5 Points\nAl Horford\nMore than 10.5 Rebs+Asts\n...`}
                value={logText}
                onChange={(e) => {
                  setLogText(e.target.value);
                  setParsedPicks([]);
                  setError(null);
                }}
              />
            </div>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={handleParseText} disabled={!logText.trim()}>
                Parse Text
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="image" className="space-y-4">
            <div
              className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-all"
              onClick={triggerFileInput}
            >
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleFileUpload}
              />

              {isUploading ? (
                <div className="py-4">
                  <Loader2 className="w-10 h-10 text-primary animate-spin mb-3 mx-auto" />
                  <div className="font-medium">Analyzing screenshot...</div>
                  <div className="text-xs text-muted-foreground mt-1">This may take a few seconds</div>
                </div>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                    <Upload className="w-6 h-6 text-primary" />
                  </div>
                  <div className="font-medium text-lg mb-1">Upload Screenshot</div>
                  <div className="text-sm text-muted-foreground max-w-xs">
                    Upload a screenshot of your betting slip to automatically extract picks
                  </div>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <div className="text-sm text-destructive flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {parsedPicks.length > 0 && (
          <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
            <div className="text-sm font-medium text-muted-foreground flex items-center justify-between">
              <span>Found {parsedPicks.length} bets:</span>
            </div>
            <div className="max-h-40 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {parsedPicks.map((pick, i) => (
                <div key={i} className="flex items-center justify-between text-sm p-3 rounded-lg bg-muted/50 border border-border/50">
                  <span className="font-medium">{pick.playerName}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground uppercase">{pick.statAbbr}</span>
                    <span className={`font-mono font-bold ${pick.side === "over" ? "text-emerald-500" : "text-rose-500"}`}>
                      {pick.side === "over" ? ">" : "<"} {pick.line}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {parsedPicks.length > 0 && (
            <Button onClick={handleImport} className="ml-2 w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Import {parsedPicks.length} Bets
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
