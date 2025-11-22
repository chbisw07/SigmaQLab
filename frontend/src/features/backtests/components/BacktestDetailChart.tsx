import { useEffect, useRef } from "react";
import {
  CandlestickData,
  HistogramData,
  IChartApi,
  LineData,
  LineStyle,
  createChart
} from "lightweight-charts";

type BacktestChartPriceBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type EquityPoint = {
  timestamp: string;
  equity: number;
};

type Trade = {
  id: number;
  symbol: string;
  side: string;
  size: number;
  entry_timestamp: string;
  entry_price: number;
  exit_timestamp: string;
  exit_price: number;
  pnl: number;
};

type BacktestDetailChartProps = {
  priceBars: BacktestChartPriceBar[];
  equityCurve: EquityPoint[];
  projectionCurve: EquityPoint[];
  trades: Trade[];
  indicators?: Record<string, { timestamp: string; value: number }[]>;
  height: number;
  showTradeMarkers: boolean;
  showProjection: boolean;
  showVolume: boolean;
  chartTheme?: "dark" | "light" | "highContrast";
};

type ChartTheme = "dark" | "light" | "highContrast";

const THEME_CONFIG: Record<
  ChartTheme,
  {
    priceBg: string;
    gridColor: string;
    textColor: string;
    upColor: string;
    downColor: string;
    volumeUpColor: string;
    volumeDownColor: string;
  }
> = {
  dark: {
    priceBg: "#121212",
    gridColor: "#333",
    textColor: "#e0e0e0",
    upColor: "#26a69a",
    downColor: "#ef5350",
    volumeUpColor: "rgba(76, 175, 80, 0.4)",
    volumeDownColor: "rgba(244, 67, 54, 0.4)"
  },
  light: {
    priceBg: "#f5f5f5",
    gridColor: "#d0d0d0",
    textColor: "#212121",
    upColor: "#2e7d32",
    downColor: "#c62828",
    volumeUpColor: "rgba(46, 125, 50, 0.4)",
    volumeDownColor: "rgba(198, 40, 40, 0.4)"
  },
  highContrast: {
    priceBg: "#000000",
    gridColor: "#555555",
    textColor: "#ffffff",
    upColor: "#00e676",
    downColor: "#ff1744",
    volumeUpColor: "rgba(0, 230, 118, 0.5)",
    volumeDownColor: "rgba(255, 23, 68, 0.5)"
  }
};

const toUtcSeconds = (isoTimestamp: string): number =>
  Math.floor(new Date(isoTimestamp).getTime() / 1000);

export const BacktestDetailChart = ({
  priceBars,
  equityCurve,
  projectionCurve,
  trades,
  indicators,
  height,
  showTradeMarkers,
  showProjection,
  showVolume,
  chartTheme = "dark"
}: BacktestDetailChartProps) => {
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const equityContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!priceContainerRef.current || priceBars.length === 0) {
      return;
    }

    const theme = THEME_CONFIG[chartTheme] ?? THEME_CONFIG.dark;

    // Normalise input series: sort by time and drop duplicate timestamps so
    // lightweight-charts always receives strictly increasing time values.
    const sortedPriceBars = [...priceBars].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const dedupedPriceBars: BacktestChartPriceBar[] = [];
    const seenPriceTimes = new Set<number>();
    sortedPriceBars.forEach((bar) => {
      const t = toUtcSeconds(bar.timestamp);
      if (seenPriceTimes.has(t)) {
        return;
      }
      seenPriceTimes.add(t);
      dedupedPriceBars.push(bar);
    });

    const normaliseEquity = (points: EquityPoint[]): EquityPoint[] => {
      const sorted = [...points].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      const out: EquityPoint[] = [];
      let lastTime = Number.NEGATIVE_INFINITY;
      sorted.forEach((pt) => {
        const t = toUtcSeconds(pt.timestamp);
        if (t <= lastTime) {
          if (t === lastTime) {
            // Replace the previous point with the latest one.
            out[out.length - 1] = pt;
          }
          return;
        }
        lastTime = t;
        out.push(pt);
      });
      return out;
    };

    const equityNorm = normaliseEquity(equityCurve);
    const projectionNorm = normaliseEquity(projectionCurve);

    const priceHeight = Math.round(height * 0.6);
    const equityHeight = Math.max(height - priceHeight, 120);

    const priceChart = createChart(priceContainerRef.current, {
      height: priceHeight,
      layout: {
        background: { color: theme.priceBg },
        textColor: theme.textColor
      },
      grid: {
        vertLines: { color: theme.gridColor },
        horzLines: { color: theme.gridColor }
      },
      crosshair: {
        vertLine: {
          color: "#aaaaaa",
          labelBackgroundColor: theme.priceBg
        },
        horzLine: {
          color: "#aaaaaa",
          labelBackgroundColor: theme.priceBg
        }
      },
      rightPriceScale: {
        borderColor: theme.gridColor
      },
      timeScale: {
        borderColor: theme.gridColor,
        timeVisible: true,
        secondsVisible: false
      }
    });

    const candles = priceChart.addCandlestickSeries({
      upColor: theme.upColor,
      borderUpColor: theme.upColor,
      wickUpColor: theme.upColor,
      downColor: theme.downColor,
      borderDownColor: theme.downColor,
      wickDownColor: theme.downColor,
      priceLineVisible: true,
      priceLineColor: "#90caf9",
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1
    });

    const volumeSeries = showVolume
      ? priceChart.addHistogramSeries({
          priceScaleId: "",
          scaleMargins: {
            top: 0.8,
            bottom: 0
          }
        })
      : undefined;

    const candleData: CandlestickData[] = dedupedPriceBars.map((bar) => ({
      time: toUtcSeconds(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));
    candles.setData(candleData);

    // Zero Lag band overlays (if present in indicators).
    if (indicators) {
      const basis = indicators.zl_basis;
      const upper = indicators.zl_upper;
      const lower = indicators.zl_lower;

      const makeLineData = (
        series: { timestamp: string; value: number }[] | undefined
      ): LineData[] =>
        (series ?? []).map((pt) => ({
          time: toUtcSeconds(pt.timestamp),
          value: pt.value
        }));

      if (basis && basis.length > 0) {
        const basisSeries = priceChart.addLineSeries({
          color: "#80cbc4",
          lineWidth: 2
        });
        basisSeries.setData(makeLineData(basis));
      }

      if (upper && upper.length > 0) {
        const upperSeries = priceChart.addLineSeries({
          color: "rgba(244,67,54,0.4)",
          lineWidth: 1
        });
        upperSeries.setData(makeLineData(upper));
      }

      if (lower && lower.length > 0) {
        const lowerSeries = priceChart.addLineSeries({
          color: "rgba(0,255,187,0.4)",
          lineWidth: 1
        });
        lowerSeries.setData(makeLineData(lower));
      }
    }

    if (volumeSeries) {
      const volumeData: HistogramData[] = dedupedPriceBars.map((bar) => ({
        time: toUtcSeconds(bar.timestamp),
        value: bar.volume ?? 0,
          color:
          bar.close >= bar.open
            ? theme.volumeUpColor
            : theme.volumeDownColor
      }));
      volumeSeries.setData(volumeData);
    }

    // Trade markers: entry/exit markers per trade.
    const markers: {
      time: number;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowUp" | "arrowDown";
      text: string;
    }[] = [];

    if (showTradeMarkers) {
      trades.forEach((trade) => {
        const isLong = trade.side.toLowerCase() === "long";
        const entryTime = toUtcSeconds(trade.entry_timestamp);
        const exitTime = toUtcSeconds(trade.exit_timestamp);

        markers.push({
          time: entryTime,
          position: isLong ? "belowBar" : "aboveBar",
          color: isLong ? "#4caf50" : "#ef5350",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: "E"
        });
        markers.push({
          time: exitTime,
          position: isLong ? "aboveBar" : "belowBar",
          // Exits are shown in the opposite colour so they
          // stand out clearly from entries.
          color: isLong ? "#ef5350" : "#4caf50",
          shape: isLong ? "arrowDown" : "arrowUp",
          text: "X"
        });
      });
    }

    if (markers.length > 0) {
      candles.setMarkers(markers);
    }

    let equityChart: IChartApi | undefined;

    if (equityContainerRef.current && equityNorm.length > 0) {
      equityChart = createChart(equityContainerRef.current, {
        height: equityHeight,
        layout: {
          background: { color: theme.priceBg },
          textColor: theme.textColor
        },
        grid: {
          vertLines: { color: theme.gridColor },
          horzLines: { color: theme.gridColor }
        },
        rightPriceScale: { borderColor: theme.gridColor },
        timeScale: {
          borderColor: theme.gridColor,
          timeVisible: true,
          secondsVisible: false
        }
      });

      const eqSeries = equityChart.addLineSeries({
        color: "#90caf9",
        lineWidth: 2
      });
      const eqData: LineData[] = equityNorm.map((pt) => ({
        time: toUtcSeconds(pt.timestamp),
        value: pt.equity
      }));
      eqSeries.setData(eqData);

      if (showProjection && projectionNorm.length > 0) {
        const projSeries = equityChart.addLineSeries({
          color: "#ffb74d",
          lineWidth: 1,
          lineStyle: LineStyle.Dotted
        });
        const projData: LineData[] = projectionNorm.map((pt) => ({
          time: toUtcSeconds(pt.timestamp),
          value: pt.equity
        }));
        projSeries.setData(projData);
      }

      const syncVisibleRange = () => {
        const range = priceChart.timeScale().getVisibleRange();
        if (range) {
          equityChart!.timeScale().setVisibleRange(range);
        }
      };

      priceChart.timeScale().subscribeVisibleTimeRangeChange(syncVisibleRange);
      equityChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (range) {
          priceChart.timeScale().setVisibleRange(range);
        }
      });

      syncVisibleRange();
    }

    const handleResize = () => {
      if (priceContainerRef.current) {
        const width = priceContainerRef.current.clientWidth;
        priceChart.applyOptions({ width });
        if (equityChart) {
          equityChart.applyOptions({ width });
        }
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      priceChart.remove();
      if (equityChart) {
        equityChart.remove();
      }
    };
  }, [
    priceBars,
    equityCurve,
    projectionCurve,
    trades,
    indicators,
    height,
    showTradeMarkers,
    showProjection,
    showVolume,
    chartTheme
  ]);

  return (
    <div>
      <div ref={priceContainerRef} />
      <div ref={equityContainerRef} />
    </div>
  );
};
