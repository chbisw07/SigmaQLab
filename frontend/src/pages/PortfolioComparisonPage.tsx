import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import {
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";
import { useEffect, useMemo, useState, FormEvent } from "react";

type FetchState = "idle" | "loading" | "success" | "error";

type PortfolioDto = {
  id: number;
  code: string;
  name: string;
  base_currency: string;
  universe_scope: string | null;
  allowed_strategies: (number | string)[] | null;
  risk_profile: Record<string, unknown> | null;
  rebalance_policy: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type PortfolioBacktest = {
  id: number;
  portfolio_id: number;
  start_date: string;
  end_date: string;
  timeframe: string;
  initial_capital: number;
  status: string;
  metrics: Record<string, unknown> | null;
  created_at: string;
  finished_at: string | null;
};

type ComparisonSeriesPoint = {
  time: string;
  // additional keys per portfolio label at runtime
  [label: string]: string | number;
};

type MetricsRow = {
  label: string;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  utilisationPct: number;
};

const API_BASE = "http://127.0.0.1:8000";

export const PortfolioComparisonPage = () => {
  const [portfolios, setPortfolios] = useState<PortfolioDto[]>([]);
  const [loadState, setLoadState] = useState<FetchState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [benchmark, setBenchmark] = useState<"none" | "nifty50">("none");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [applyState, setApplyState] = useState<FetchState>("idle");
  const [applyError, setApplyError] = useState<string | null>(null);

  const [series, setSeries] = useState<ComparisonSeriesPoint[]>([]);
  const [metricsRows, setMetricsRows] = useState<MetricsRow[]>([]);

  useEffect(() => {
    const loadPortfolios = async () => {
      setLoadState("loading");
      setLoadError(null);
      try {
        const res = await fetch(`${API_BASE}/api/portfolios`);
        if (!res.ok) {
          throw new Error("Failed to load portfolios.");
        }
        const data: PortfolioDto[] = await res.json();
        setPortfolios(data);
        setLoadState("success");
      } catch (error) {
        setLoadState("error");
        setLoadError(
          error instanceof Error ? error.message : "Unexpected error occurred."
        );
      }
    };

    void loadPortfolios();
  }, []);

  const handleUpdateComparison = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedIds.length) {
      setApplyState("error");
      setApplyError("Select at least one portfolio to compare.");
      setSeries([]);
      setMetricsRows([]);
      return;
    }

    setApplyState("loading");
    setApplyError(null);

    try {
      const selectedPortfolios = portfolios.filter((p) =>
        selectedIds.includes(p.id)
      );

      const backtestResponses = await Promise.all(
        selectedPortfolios.map(async (p) => {
          const res = await fetch(
            `${API_BASE}/api/portfolios/${p.id}/backtests?limit=1`
          );
          if (!res.ok) {
            return { portfolio: p, backtest: null as PortfolioBacktest | null };
          }
          const data: PortfolioBacktest[] = await res.json();
          const bt = data.find((b) => b.status === "completed") ?? data[0] ?? null;
          return { portfolio: p, backtest: bt };
        })
      );

      const messages: string[] = [];
      const timeMap = new Map<string, ComparisonSeriesPoint>();
      const metricsList: MetricsRow[] = [];

      for (const { portfolio, backtest } of backtestResponses) {
        if (!backtest || !backtest.metrics) {
          messages.push(
            `No completed portfolio backtest found for ${portfolio.code}.`
          );
          continue;
        }
        const metrics = backtest.metrics as Record<string, unknown>;
        const curve = (metrics.equity_curve as
          | { timestamp: string; equity: number }[]
          | undefined) ?? [];
        if (!curve.length) {
          messages.push(
            `Backtest #${backtest.id} for ${portfolio.code} has no equity curve.`
          );
          continue;
        }

        const label = `${portfolio.code} – ${portfolio.name}`;

        // Optional date filtering.
        const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
        const end = endDate ? new Date(`${endDate}T23:59:59`) : null;

        const firstPoint =
          curve.find((pt) => {
            const ts = new Date(pt.timestamp);
            if (start && ts < start) return false;
            if (end && ts > end) return false;
            return true;
          }) ?? curve[0];
        const baseEquity = firstPoint.equity || 1;

        curve.forEach((pt) => {
          const ts = new Date(pt.timestamp);
          if (start && ts < start) return;
          if (end && ts > end) return;

          const key = pt.timestamp;
          const normalised = (pt.equity / baseEquity) * 100;

          let row = timeMap.get(key);
          if (!row) {
            row = { time: key };
            timeMap.set(key, row);
          }
          row[label] = normalised;
        });

        const cagr =
          (metrics.annual_return as number | undefined) ??
          (metrics.total_return as number | undefined) ??
          0;
        const maxDd =
          (metrics.max_drawdown as number | undefined) ??
          (metrics.max_drawdown_pct as number | undefined) ??
          0;
        const sharpe =
          (metrics.sharpe as number | undefined) ??
          (metrics.sharpe_ratio as number | undefined) ??
          0;
        const utilisation =
          (metrics.avg_capital_utilisation as number | undefined) ?? 0;

        metricsList.push({
          label,
          cagrPct: cagr * 100,
          maxDrawdownPct: maxDd * 100,
          sharpe,
          utilisationPct: utilisation * 100
        });
      }

      const sortedSeries = Array.from(timeMap.values()).sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );

      setSeries(sortedSeries);
      setMetricsRows(metricsList);
      setApplyState("success");
      setApplyError(
        messages.length ? messages.join(" ") : null
      );
    } catch (error) {
      setApplyState("error");
      setSeries([]);
      setMetricsRows([]);
      setApplyError(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const portfolioOptions = useMemo(
    () =>
      portfolios.map((p) => ({
        id: p.id,
        label: `${p.code} – ${p.name}`
      })),
    [portfolios]
  );

  const seriesKeys = useMemo(() => {
    if (!series.length) return [] as string[];
    const keys = new Set<string>();
    series.forEach((row) => {
      Object.keys(row).forEach((k) => {
        if (k !== "time") {
          keys.add(k);
        }
      });
    });
    return Array.from(keys);
  }, [series]);

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2
        }}
      >
        <Box>
          <Typography variant="h5" gutterBottom>
            Portfolio comparison
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Compare equity curves and key risk/return metrics across portfolios
            versus an optional benchmark.
          </Typography>
        </Box>
      </Box>

      {/* Controls */}
      <Paper
        elevation={1}
        sx={{ p: 2, mb: 2 }}
        component="form"
        onSubmit={handleUpdateComparison}
      >
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={5}>
            <TextField
              select
              label="Portfolios"
              size="small"
              fullWidth
              SelectProps={{
                multiple: true,
                value: selectedIds,
                onChange: (e) => {
                  const value = e.target.value;
                  const next =
                    typeof value === "string"
                      ? value
                          .split(",")
                          .map((v) => Number(v.trim()))
                          .filter((v) => !Number.isNaN(v))
                      : (value as number[]);
                  setSelectedIds(next);
                },
                renderValue: (ids) => {
                  const labels = portfolioOptions
                    .filter((opt) => (ids as number[]).includes(opt.id))
                    .map((opt) => opt.label);
                  return labels.join(", ");
                }
              }}
            >
              {portfolioOptions.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              select
              label="Benchmark"
              size="small"
              fullWidth
              value={benchmark}
              onChange={(e) =>
                setBenchmark(e.target.value as "none" | "nifty50")
              }
            >
              <MenuItem value="none">None</MenuItem>
              <MenuItem value="nifty50">NIFTY 50 (placeholder)</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="Start date"
              type="date"
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="End date"
              type="date"
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={1}>
            <Button
              type="submit"
              variant="contained"
              fullWidth
              disabled={applyState === "loading" || loadState === "loading"}
            >
              Update
            </Button>
          </Grid>
        </Grid>
        {loadError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {loadError}
          </Alert>
        )}
        {applyError && (
          <Alert
            severity={applyState === "error" ? "error" : "info"}
            sx={{ mt: 2 }}
          >
            {applyError}
          </Alert>
        )}
        {benchmark !== "none" && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Benchmark curves and metrics for {benchmark.toUpperCase()} will be
            integrated in a future iteration. For now, comparison focuses on
            selected portfolios.
          </Alert>
        )}
      </Paper>

      {/* Chart + metrics */}
      <Grid container spacing={2}>
        <Grid item xs={12} md={8}>
          <Card sx={{ height: 380 }}>
            <CardContent sx={{ height: "100%" }}>
              <Typography variant="subtitle1" gutterBottom>
                Equity curves (normalised to 100)
              </Typography>
              {applyState === "loading" ? (
                <Typography variant="body2" color="text.secondary">
                  Loading comparison data…
                </Typography>
              ) : !series.length || !seriesKeys.length ? (
                <Typography variant="body2" color="text.secondary">
                  Select portfolios and click &quot;Update&quot; to see
                  comparison curves.
                </Typography>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series}>
                    <XAxis dataKey="time" hide />
                    <YAxis />
                    <RechartsTooltip />
                    <Legend />
                    {seriesKeys.map((key, idx) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        dot={false}
                        strokeWidth={2}
                        stroke={
                          ["#42a5f5", "#ef5350", "#66bb6a", "#ab47bc", "#ffa726"][
                            idx % 5
                          ]
                        }
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card sx={{ height: 380 }}>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>
                Headline metrics
              </Typography>
              {!metricsRows.length ? (
                <Typography variant="body2" color="text.secondary">
                  Metrics will appear here once comparison has been run.
                </Typography>
              ) : (
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {metricsRows.map((row) => (
                    <Paper
                      key={row.label}
                      variant="outlined"
                      sx={{ p: 1.5 }}
                    >
                      <Typography variant="subtitle2">{row.label}</Typography>
                      <Typography variant="body2">
                        CAGR: {row.cagrPct.toFixed(2)}%
                      </Typography>
                      <Typography variant="body2">
                        Max drawdown: {row.maxDrawdownPct.toFixed(2)}%
                      </Typography>
                      <Typography variant="body2">
                        Sharpe: {row.sharpe.toFixed(2)}
                      </Typography>
                      <Typography variant="body2">
                        Avg capital utilisation:{" "}
                        {row.utilisationPct.toFixed(1)}%
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
