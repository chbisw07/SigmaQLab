import { CssBaseline, ThemeProvider } from "@mui/material";
import { Routes, Route } from "react-router-dom";

import { AppLayout } from "./components/AppLayout";
import { theme } from "./theme";
import { DashboardPage } from "./pages/DashboardPage";
import { StrategiesPage } from "./pages/StrategiesPage";
import { BacktestsPage } from "./pages/BacktestsPage";
import { DataPage } from "./pages/DataPage";
import { SettingsPage } from "./pages/SettingsPage";

export const App = () => {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppLayout>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/backtests" element={<BacktestsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </AppLayout>
    </ThemeProvider>
  );
};
