import { useEffect, useRef } from "react";
import {
  CandlestickData,
  HistogramData,
  IChartApi,
  ISeriesApi,
  LineData,
  createChart
} from "lightweight-charts";

import {
  INDICATORS,
  IndicatorDefinition
} from "../indicatorCatalog";
import type { PreviewWithIndicators } from "../../../pages/DataPage";

type DataPreviewChartProps = {
  data: PreviewWithIndicators[];
  selectedIndicatorIds: string[];
  height: number;
  showVolume?: boolean;
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
  showVolume = true
}: DataPreviewChartProps) => {
  const priceContainerRef = useRef<HTMLDivElement | null>(null);
  const oscContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!priceContainerRef.current || data.length === 0) {
      return;
    }

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
        vertLine: { color: "#888" },
        horzLine: { color: "#888" }
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
      wickDownColor: DOWN_COLOR
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

    const candleData: CandlestickData[] = data.map((bar) => ({
      time: toUtcSeconds(bar.timestamp),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close
    }));
    candles.setData(candleData);

    if (volumeSeries) {
      const volumeData: HistogramData[] = data.map((bar) => ({
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
          lineWidth: 1
        });
        const seriesData: LineData[] = data
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
          const seriesData: LineData[] = data
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
  }, [data, selectedIndicatorIds, height, showVolume]);

  return (
    <div>
      <div ref={priceContainerRef} />
      <div ref={oscContainerRef} />
    </div>
  );
};
