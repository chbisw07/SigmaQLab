import { useEffect, useRef } from "react";
import {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  LineData,
  LineStyle,
  createChart
} from "lightweight-charts";

import {
  INDICATORS,
  IndicatorDefinition
} from "../indicatorCatalog";
import type { ChartThemeId } from "../../../chartThemes";
import { CHART_THEME_CONFIG } from "../../../chartThemes";
import type { PreviewWithIndicators } from "../../../pages/DataPage";

type RangePreset =
  | "all"
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "30m"
  | "60m"
  | "1d"
  | "1w"
  | "1M"
  | "3M"
  | "6M"
  | "1Y";

type DataPreviewChartProps = {
  data: PreviewWithIndicators[];
  selectedIndicatorIds: string[];
  height: number;
  showVolume?: boolean;
  rangePreset?: RangePreset;
  showLastPriceLine?: boolean;
  highlightLatestBar?: boolean;
  chartTheme?: ChartThemeId;
};

const toUtcSeconds = (isoTimestamp: string): number =>
  Math.floor(new Date(isoTimestamp).getTime() / 1000);

export const DataPreviewChart = ({
  data,
  selectedIndicatorIds,
  height,
  showVolume = true,
  rangePreset = "all",
  showLastPriceLine = true,
  highlightLatestBar = false,
  chartTheme = "dark"
}: DataPreviewChartProps) => {
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const oscContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!priceContainerRef.current || data.length === 0) {
      return;
    }

    const theme = CHART_THEME_CONFIG[chartTheme] ?? CHART_THEME_CONFIG.dark;

    const secondsMap: Partial<Record<RangePreset, number>> = {
      "1m": 60,
      "3m": 3 * 60,
      "5m": 5 * 60,
      "10m": 10 * 60,
      "30m": 30 * 60,
      "60m": 60 * 60,
      "1d": 24 * 60 * 60,
      "1w": 7 * 24 * 60 * 60,
      "1M": 30 * 24 * 60 * 60,
      "3M": 90 * 24 * 60 * 60,
      "6M": 180 * 24 * 60 * 60,
      "1Y": 365 * 24 * 60 * 60
    };

    const fullTimes = data.map((bar) => toUtcSeconds(bar.timestamp));
    let startIndex = 0;
    if (rangePreset && rangePreset !== "all") {
      const seconds = secondsMap[rangePreset];
      if (seconds) {
        const last = fullTimes[fullTimes.length - 1];
        const fromTs = last - seconds;
        const idx = fullTimes.findIndex((t) => t >= fromTs);
        startIndex = idx === -1 ? 0 : idx;
      }
    }

    const visibleData = data.slice(startIndex);

    const overlays = INDICATORS.filter(
      (i) =>
        i.kind === "overlay" && selectedIndicatorIds.includes(i.id)
    );
    const oscillators = INDICATORS.filter(
      (i) =>
        i.kind === "oscillator" && selectedIndicatorIds.includes(i.id)
    );

    const priceHeight = Math.round(height * 0.6);
    const oscHeight =
      oscillators.length > 0 ? Math.round(height * 0.25) : 0;
    const volHeight = Math.max(height - priceHeight - oscHeight, 80);

    const priceChart = createChart(priceContainerRef.current, {
      height: priceHeight + volHeight,
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
      priceLineVisible: showLastPriceLine,
      priceLineColor: "#90caf9",
      priceLineStyle: LineStyle.Dashed,
      priceLineWidth: 1
    });

    const volumeSeries = showVolume
      ? priceChart.addHistogramSeries({
          priceScaleId: "",
          scaleMargins: {
            top: (priceHeight - 10) / (priceHeight + volHeight),
            bottom: 0
          }
        })
      : null;

    const candleData: CandlestickData[] = visibleData.map((bar) => ({
      time: toUtcSeconds(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));
    candles.setData(candleData);

    if (highlightLatestBar && candleData.length > 0) {
      const last = candleData[candleData.length - 1];
      candles.setMarkers([
        {
          time: last.time,
          position: "aboveBar",
          color: "#ffb74d",
          shape: "circle",
          text: "●"
        }
      ]);
    } else {
      candles.setMarkers([]);
    }

    if (volumeSeries) {
      const volumeData: HistogramData[] = visibleData.map((bar) => ({
        time: toUtcSeconds(bar.timestamp),
        value: bar.volume ?? 0,
        color:
          bar.close >= bar.open
            ? theme.volumeUpColor
            : theme.volumeDownColor
      }));
      volumeSeries.setData(volumeData);
    }

    const overlaySeries: ISeriesApi<"Line">[] = [];

    overlays.forEach((def: IndicatorDefinition) => {
      const color = def.color ?? "#90caf9";
      def.fields.forEach((fieldName) => {
        const series = priceChart.addLineSeries({
          color,
          lineWidth: 2
        });
        const seriesData: LineData[] = visibleData
          .filter(
            (d) =>
              (d as unknown as Record<string, unknown>)[fieldName] !==
              undefined
          )
          .map((d) => ({
            time: toUtcSeconds(d.timestamp),
            value: (d as unknown as Record<string, number>)[fieldName]
          }));
        series.setData(seriesData);
        overlaySeries.push(series);
      });
    });

    priceChart.timeScale().fitContent();

    let oscChart: IChartApi | undefined;
    const oscSeries: ISeriesApi<"Line">[] = [];

    if (oscHeight > 0 && oscContainerRef.current) {
      oscChart = createChart(oscContainerRef.current, {
        height: oscHeight,
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

      oscillators.forEach((def) => {
        const color = def.color ?? "#ffb74d";
        def.fields.forEach((fieldName) => {
          const series = oscChart!.addLineSeries({
            color,
            lineWidth: 1
          });
          const seriesData: LineData[] = visibleData
            .filter(
              (d) =>
                (d as unknown as Record<string, unknown>)[fieldName] !==
                undefined
            )
            .map((d) => ({
              time: toUtcSeconds(d.timestamp),
              value: (d as unknown as Record<string, number>)[fieldName]
            }));
          series.setData(seriesData);
          oscSeries.push(series);
        });
      });

      const syncVisibleRange = () => {
        const range = priceChart.timeScale().getVisibleRange();
        if (range) {
          oscChart!.timeScale().setVisibleRange(range);
        }
      };

      priceChart.timeScale().subscribeVisibleTimeRangeChange(syncVisibleRange);

      // Also keep price and oscillator charts in sync if the user
      // pans/zooms inside the oscillator pane.
      oscChart.timeScale().subscribeVisibleTimeRangeChange((range) => {
        if (range) {
          priceChart.timeScale().setVisibleRange(range);
        }
      });

      // Ensure both charts start in the same range after initial render.
      syncVisibleRange();
    }

    const handleResize = () => {
      if (priceContainerRef.current) {
        const width = priceContainerRef.current.clientWidth;
        priceChart.applyOptions({ width });
        if (oscChart) {
          oscChart.applyOptions({ width });
        }
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      priceChart.remove();
      if (oscChart) {
        oscChart.remove();
      }
    };
  }, [
    data,
    selectedIndicatorIds,
    height,
    showVolume,
    rangePreset,
    showLastPriceLine,
    highlightLatestBar,
    chartTheme
  ]);

  return (
    <div>
      <div ref={priceContainerRef} />
      <div ref={oscContainerRef} />
    </div>
  );
};
