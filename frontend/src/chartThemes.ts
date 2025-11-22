export type ChartThemeId = "dark" | "light" | "highContrast";

export type ChartThemeConfig = {
  priceBg: string;
  gridColor: string;
  textColor: string;
  upColor: string;
  downColor: string;
  volumeUpColor: string;
  volumeDownColor: string;
};

export const CHART_THEME_CONFIG: Record<ChartThemeId, ChartThemeConfig> = {
  dark: {
    priceBg: "#121212",
    gridColor: "#333333",
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
