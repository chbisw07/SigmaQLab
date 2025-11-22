import {
  Box,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography
} from "@mui/material";

import { useAppearance } from "../appearanceContext";
import type { AppThemeId } from "../theme";
import type { ChartThemeId } from "../chartThemes";

const APP_THEME_OPTIONS: { id: AppThemeId; label: string; description: string }[] =
  [
    {
      id: "darkBlue",
      label: "Dark – Deep Blue",
      description: "Existing SigmaQLab dark look with blue accents."
    },
    {
      id: "darkAmber",
      label: "Dark – Amber",
      description: "High-contrast dark theme with warm amber primary."
    },
    {
      id: "lightBlue",
      label: "Light – Blue",
      description: "Clean light theme with blue primary and white cards."
    },
    {
      id: "lightGray",
      label: "Light – Gray",
      description: "Soft light theme with grey/blue accents."
    }
  ];

const CHART_THEME_OPTIONS: { id: ChartThemeId; label: string; description: string }[] =
  [
    {
      id: "dark",
      label: "Dark",
      description: "Dark price background, teal/ red candles."
    },
    {
      id: "light",
      label: "Light",
      description: "Light background with darker candles and grid."
    },
    {
      id: "highContrast",
      label: "High contrast",
      description: "Black background with bright green/red candles."
    }
  ];

export const AppearancePage = () => {
  const { appThemeId, setAppThemeId, chartThemeId, setChartThemeId } =
    useAppearance();

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Appearance
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        Configure the overall application theme and default chart style for
        SigmaQLab.
      </Typography>

      <Box mt={3} display="flex" flexDirection={{ xs: "column", md: "row" }} gap={3}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Application theme
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              Choose how the main UI (sidebar, cards, tables) is coloured.
            </Typography>
            <FormControl component="fieldset">
              <RadioGroup
                value={appThemeId}
                onChange={(e) => setAppThemeId(e.target.value as AppThemeId)}
              >
                {APP_THEME_OPTIONS.map((opt) => (
                  <FormControlLabel
                    key={opt.id}
                    value={opt.id}
                    control={<Radio />}
                    label={
                      <Box>
                        <Typography variant="body2">{opt.label}</Typography>
                        <Typography
                          variant="caption"
                          color="textSecondary"
                          display="block"
                        >
                          {opt.description}
                        </Typography>
                      </Box>
                    }
                  />
                ))}
              </RadioGroup>
            </FormControl>
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Default chart theme
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              This is the default look for Data preview and Backtest charts.
              Individual backtests can still override their own chart theme in
              Backtest Settings.
            </Typography>
            <FormControl fullWidth margin="normal">
              <TextField
                select
                label="Chart theme"
                value={chartThemeId}
                onChange={(e) =>
                  setChartThemeId(e.target.value as ChartThemeId)
                }
              >
                {CHART_THEME_OPTIONS.map((opt) => (
                  <MenuItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </FormControl>
            <Typography variant="body2" color="textSecondary">
              Changes apply immediately to new charts. Existing Backtest Details
              will use their saved visual settings unless you override them in
              the Backtest Settings dialog.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};
