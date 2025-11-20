export type IndicatorCategory =
  | "moving_average"
  | "trend_bands"
  | "momentum"
  | "volume";

export type IndicatorKind = "overlay" | "oscillator";

export interface IndicatorDefinition {
  id: string;
  label: string;
  category: IndicatorCategory;
  kind: IndicatorKind;
  /**
   * Underlying field names on the preview data objects
   * (e.g. ["sma20"], ["bb_upper", "bb_lower"], ["macd", "macd_signal"]).
   */
  fields: string[];
  description?: string;
  defaultSelected?: boolean;
  color?: string;
  secondaryColor?: string;
}

export const INDICATORS: IndicatorDefinition[] = [
  // Moving averages
  {
    id: "sma_5",
    label: "SMA(5)",
    category: "moving_average",
    kind: "overlay",
    fields: ["sma5"],
    defaultSelected: true,
    color: "#ffb74d"
  },
  {
    id: "sma_20",
    label: "SMA(20)",
    category: "moving_average",
    kind: "overlay",
    fields: ["sma20"],
    defaultSelected: true,
    color: "#4db6ac"
  },
  {
    id: "ema_20",
    label: "EMA(20)",
    category: "moving_average",
    kind: "overlay",
    fields: ["ema20"],
    color: "#ce93d8"
  },
  {
    id: "wma_20",
    label: "WMA(20)",
    category: "moving_average",
    kind: "overlay",
    fields: ["wma20"],
    color: "#ffd54f"
  },
  {
    id: "hma_20",
    label: "Hull MA(20)",
    category: "moving_average",
    kind: "overlay",
    fields: ["hma20"],
    color: "#ba68c8"
  },

  // Trend / bands
  {
    id: "bb_20",
    label: "Bollinger(20)",
    category: "trend_bands",
    kind: "overlay",
    fields: ["bb_upper", "bb_lower"],
    color: "#ef5350",
    secondaryColor: "#42a5f5"
  },
  {
    id: "donchian_20",
    label: "Donchian(20)",
    category: "trend_bands",
    kind: "overlay",
    fields: ["donchian_high", "donchian_low"],
    color: "#ff8a65",
    secondaryColor: "#4dd0e1"
  },

  // Momentum / oscillators
  {
    id: "rsi_14",
    label: "RSI(14)",
    category: "momentum",
    kind: "oscillator",
    fields: ["rsi14"],
    color: "#81c784"
  },
  {
    id: "macd_12_26_9",
    label: "MACD(12,26,9)",
    category: "momentum",
    kind: "oscillator",
    fields: ["macd", "macd_signal"],
    color: "#ffb74d",
    secondaryColor: "#e57373"
  },
  {
    id: "momentum_10",
    label: "Momentum(10)",
    category: "momentum",
    kind: "oscillator",
    fields: ["momentum10"],
    color: "#ff8a65"
  },
  {
    id: "roc_10",
    label: "ROC(10)",
    category: "momentum",
    kind: "oscillator",
    fields: ["roc10"],
    color: "#9ccc65"
  },
  {
    id: "cci_20",
    label: "CCI(20)",
    category: "momentum",
    kind: "oscillator",
    fields: ["cci20"],
    color: "#4dd0e1"
  },

  // Volume / volatility
  {
    id: "obv",
    label: "OBV",
    category: "volume",
    kind: "oscillator",
    fields: ["obv"],
    color: "#64b5f6"
  },
  {
    id: "atr_14",
    label: "ATR(14)",
    category: "volume",
    kind: "oscillator",
    fields: ["atr14"],
    color: "#f06292"
  }
];

export const INDICATORS_BY_CATEGORY: Record<
  IndicatorCategory,
  IndicatorDefinition[]
> = {
  moving_average: INDICATORS.filter((i) => i.category === "moving_average"),
  trend_bands: INDICATORS.filter((i) => i.category === "trend_bands"),
  momentum: INDICATORS.filter((i) => i.category === "momentum"),
  volume: INDICATORS.filter((i) => i.category === "volume")
};
