import { createTheme, Theme } from "@mui/material/styles";

export type AppThemeId = "darkBlue" | "darkAmber" | "lightBlue" | "lightGray";

const buildTheme = (options: Parameters<typeof createTheme>[0]): Theme =>
  createTheme(options);

const darkBlue = buildTheme({
  palette: {
    mode: "dark",
    primary: { main: "#90caf9" },
    background: { default: "#050816", paper: "#0b1020" }
  }
});

const darkAmber = buildTheme({
  palette: {
    mode: "dark",
    primary: { main: "#ffb74d" },
    background: { default: "#121212", paper: "#1e1e1e" }
  }
});

const lightBlue = buildTheme({
  palette: {
    mode: "light",
    primary: { main: "#1976d2" },
    background: { default: "#f5f5f5", paper: "#ffffff" }
  }
});

const lightGray = buildTheme({
  palette: {
    mode: "light",
    primary: { main: "#546e7a" },
    background: { default: "#eceff1", paper: "#ffffff" }
  }
});

const APP_THEMES: Record<AppThemeId, Theme> = {
  darkBlue,
  darkAmber,
  lightBlue,
  lightGray
};

export const defaultAppThemeId: AppThemeId = "darkBlue";

export const getAppTheme = (id: AppThemeId): Theme =>
  APP_THEMES[id] ?? APP_THEMES[defaultAppThemeId];

// Backwards-compatible default theme export for existing imports.
export const theme = getAppTheme(defaultAppThemeId);
