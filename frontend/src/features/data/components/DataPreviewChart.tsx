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

export const DataPreviewChart = ({
  data,
  selectedIndicatorIds,
  height,
  showVolume = true,
  rangePreset = "all",
  showLastPriceLine = true,
  highlightLatestBar = false
}: DataPreviewChartProps) => {
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const oscContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!priceContainerRef.current || data.length === 0) {
      return;
    }

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
          bar.close >= bar.open ? VOLUME_UP_COLOR : VOLUME_DOWN_COLOR
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
  }, [data, selectedIndicatorIds, height, showVolume, rangePreset, showLastPriceLine, highlightLatestBar]);

  return (
    <div>
      <div ref={priceContainerRef} />
      <div ref={oscContainerRef} />
    </div>
  );
};
