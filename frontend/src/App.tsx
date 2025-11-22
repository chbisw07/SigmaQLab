import { CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";

import { AppLayout } from "./components/AppLayout";
import { defaultAppThemeId, getAppTheme, type AppThemeId } from "./theme";
import { DashboardPage } from "./pages/DashboardPage";
import { StrategiesPage } from "./pages/StrategiesPage";
import { BacktestsPage } from "./pages/BacktestsPage";
import { DataPage } from "./pages/DataPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AppearanceContext } from "./appearanceContext";
import type { ChartThemeId } from "./chartThemes";
import { AppearancePage } from "./pages/AppearancePage";

export const App = () => {
  const [appThemeId, setAppThemeId] = useState<AppThemeId>(() => {
    const stored = window.localStorage.getItem("sigmaqlab_app_theme");
    return (stored as AppThemeId) || defaultAppThemeId;
  });

  const [chartThemeId, setChartThemeId] = useState<ChartThemeId>(() => {
    const stored = window.localStorage.getItem("sigmaqlab_chart_theme");
    return (stored as ChartThemeId) || "dark";
  });

  useEffect(() => {
    window.localStorage.setItem("sigmaqlab_app_theme", appThemeId);
  }, [appThemeId]);

  useEffect(() => {
    window.localStorage.setItem("sigmaqlab_chart_theme", chartThemeId);
  }, [chartThemeId]);

  const muiTheme = useMemo(() => getAppTheme(appThemeId), [appThemeId]);

  return (
    <AppearanceContext.Provider
      value={{
        appThemeId,
        setAppThemeId,
        chartThemeId,
        setChartThemeId
      }}
    >
      <ThemeProvider theme={muiTheme}>
        <CssBaseline />
        <AppLayout>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/data" element={<DataPage />} />
            <Route path="/strategies" element={<StrategiesPage />} />
            <Route path="/backtests" element={<BacktestsPage />} />
            <Route path="/appearance" element={<AppearancePage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </AppLayout>
      </ThemeProvider>
    </AppearanceContext.Provider>
  );
};
