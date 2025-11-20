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
  height: number;
};

const PRICE_BG = "#121212";
const GRID_COLOR = "#333";
const TEXT_COLOR = "#e0e0e0";
const UP_COLOR = "#26a69a";
const DOWN_COLOR = "#ef5350";
const VOLUME_UP_COLOR = "rgba(76, 175, 80, 0.4)";
const VOLUME_DOWN_COLOR = "rgba(244, 67, 54, 0.4)";

const toUtcSeconds = (isoTimestamp: string): number =>
  Math.floor(new Date(isoTimestamp).getTime() / 1000);

export const BacktestDetailChart = ({
  priceBars,
  equityCurve,
  projectionCurve,
  trades,
  height
}: BacktestDetailChartProps) => {
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const equityContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!priceContainerRef.current || priceBars.length === 0) {
      return;
    }

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
        background: { color: PRICE_BG },
        textColor: TEXT_COLOR
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR }
      },
      crosshair: {
        vertLine: {
          color: "#aaaaaa",
          labelBackgroundColor: "#1e1e1e"
        },
        horzLine: {
          color: "#aaaaaa",
          labelBackgroundColor: "#1e1e1e"
        }
      },
      rightPriceScale: {
        borderColor: GRID_COLOR
      },
      timeScale: {
        borderColor: GRID_COLOR,
        timeVisible: true,
        secondsVisible: false
      }
    });

    const candles = priceChart.addCandlestickSeries({
      upColor: UP_COLOR,
      borderUpColor: UP_COLOR,
      wickUpColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderDownColor: DOWN_COLOR,
      wickDownColor: DOWN_COLOR,
      priceLineVisible: true,
      priceLineColor: "#90caf9",
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1
    });

    const volumeSeries = priceChart.addHistogramSeries({
      priceScaleId: "",
      scaleMargins: {
        top: 0.8,
        bottom: 0
      }
    });

    const candleData: CandlestickData[] = dedupedPriceBars.map((bar) => ({
      time: toUtcSeconds(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));
    candles.setData(candleData);

    const volumeData: HistogramData[] = dedupedPriceBars.map((bar) => ({
      time: toUtcSeconds(bar.timestamp),
      value: bar.volume ?? 0,
      color:
        bar.close >= bar.open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR
    }));
    volumeSeries.setData(volumeData);

    // Trade markers: entry/exit markers per trade.
    const markers: {
      time: number;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "arrowUp" | "arrowDown";
      text: string;
    }[] = [];

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
        color: isLong ? "#4caf50" : "#ef5350",
        shape: isLong ? "arrowDown" : "arrowUp",
        text: "X"
      });
    });

    if (markers.length > 0) {
      candles.setMarkers(markers);
    }

    let equityChart: IChartApi | undefined;

    if (equityContainerRef.current && equityNorm.length > 0) {
      equityChart = createChart(equityContainerRef.current, {
        height: equityHeight,
        layout: {
          background: { color: PRICE_BG },
          textColor: TEXT_COLOR
        },
        grid: {
          vertLines: { color: GRID_COLOR },
          horzLines: { color: GRID_COLOR }
        },
        rightPriceScale: { borderColor: GRID_COLOR },
        timeScale: {
          borderColor: GRID_COLOR,
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

      if (projectionNorm.length > 0) {
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
  }, [priceBars, equityCurve, projectionCurve, trades, height]);

  return (
    <div>
      <div ref={priceContainerRef} />
      <div ref={equityContainerRef} />
    </div>
  );
};
