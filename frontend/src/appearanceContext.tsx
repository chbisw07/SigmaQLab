import { createContext, useContext } from "react";

import type { AppThemeId } from "./theme";
import type { ChartThemeId } from "./chartThemes";

export type AppearanceState = {
  appThemeId: AppThemeId;
  setAppThemeId: (id: AppThemeId) => void;
  chartThemeId: ChartThemeId;
  setChartThemeId: (id: ChartThemeId) => void;
};

export const AppearanceContext = createContext<AppearanceState | undefined>(
  undefined
);

export const useAppearance = (): AppearanceState => {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error("useAppearance must be used within AppearanceContext.Provider");
  }
  return ctx;
};
