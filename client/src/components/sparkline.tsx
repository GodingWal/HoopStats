import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
}

export function Sparkline({ data, width = 80, height = 24, className }: SparklineProps) {
  const pathData = useMemo(() => {
    if (!data || data.length === 0) return null;
    
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    
    const points = data.map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 4) - 2;
      return { x, y };
    });
    
    const pathString = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
    
    return {
      path: pathString,
      lastPoint: points[points.length - 1],
    };
  }, [data, width, height]);

  if (!pathData) return null;

  return (
    <svg 
      width={width} 
      height={height} 
      className={className}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="sparklineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.5" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="1" />
        </linearGradient>
      </defs>
      <path
        d={pathData.path}
        fill="none"
        stroke="url(#sparklineGradient)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={pathData.lastPoint.x}
        cy={pathData.lastPoint.y}
        r="3"
        fill="hsl(var(--primary))"
      />
    </svg>
  );
}
