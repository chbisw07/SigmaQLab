import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams
} from "@mui/x-data-grid";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";
import { useEffect, useMemo, useState, FormEvent, SyntheticEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

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

type Strategy = {
  id: number;
  name: string;
};

type StockGroup = {
  id: number;
  code: string;
  name: string;
  stock_count: number;
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

type TradeRow = {
  id: number;
  date: string;
  symbol: string;
  strategy: string;
  side: string;
  quantity: number;
  price: number;
  notional: number;
  fees: number;
  realisedPnl: number;
  unrealisedPnl: number;
};

type HoldingRow = {
  id: number;
  symbol: string;
  quantity: number;
  avgCost: number;
  marketPrice: number;
  marketValue: number;
  unrealisedPnl: number;
  weightPct: number;
};

const API_BASE = "http://127.0.0.1:8000";

const formatDateTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch {
    return iso;
  }
};

const formatUniverseLabel = (
  scope: string | null,
  groups: StockGroup[]
): string => {
  if (!scope) return "";
  if (scope.startsWith("group:")) {
    const id = Number(scope.split(":")[1] ?? "");
    const group = groups.find((g) => g.id === id);
    if (group) {
      return `${group.code} – ${group.name} (${group.stock_count} stocks)`;
    }
  }
  return scope;
};

export const PortfolioDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === "new";

  const [tab, setTab] = useState<
    "overview" | "settings" | "backtests" | "trades" | "analytics"
  >(isNew ? "settings" : "overview");

  const [portfolio, setPortfolio] = useState<PortfolioDto | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [loadState, setLoadState] = useState<FetchState>("idle");

  const [backtests, setBacktests] = useState<PortfolioBacktest[]>([]);
  const [backtestsState, setBacktestsState] = useState<FetchState>("idle");
  const [selectedBacktestId, setSelectedBacktestId] = useState<number | null>(
    null
  );
  const [selectedBacktest, setSelectedBacktest] =
    useState<PortfolioBacktest | null>(null);

  // Settings tab state
  const [name, setName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [universeScope, setUniverseScope] = useState<string>("");
  const [allowedStrategyIds, setAllowedStrategyIds] = useState<number[]>([]);
  const [maxPosPct, setMaxPosPct] = useState("20");
  const [maxPositions, setMaxPositions] = useState("10");
  const [ddTolerance, setDdTolerance] = useState("0");
  const [productType, setProductType] =
    useState<"delivery" | "intraday" | "hybrid">("delivery");
  const [rebalanceFrequency, setRebalanceFrequency] = useState("monthly");
  const [driftTrigger, setDriftTrigger] = useState("5");
  const [deRiskingEnabled, setDeRiskingEnabled] = useState(false);
  const [settingsState, setSettingsState] = useState<FetchState>("idle");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);

  // Backtests tab form state
  const [btTimeframe, setBtTimeframe] = useState("1d");
  const [btStartDate, setBtStartDate] = useState("");
  const [btEndDate, setBtEndDate] = useState("");
  const [btInitialCapital, setBtInitialCapital] = useState("100000");
  const [btState, setBtState] = useState<FetchState>("idle");
  const [btMessage, setBtMessage] = useState<string | null>(null);

  // Trades & holdings skeleton state
  const [tradesOrHoldings, setTradesOrHoldings] = useState<"trades" | "holdings">(
    "trades"
  );

  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [snackbarSeverity, setSnackbarSeverity] = useState<
    "success" | "error" | "info"
  >("info");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoadState("loading");
      try {
        const [stratRes, grpRes] = await Promise.all([
          fetch(`${API_BASE}/api/strategies`),
          fetch(`${API_BASE}/api/stock-groups`)
        ]);

        if (stratRes.ok) {
          const sData: Strategy[] = await stratRes.json();
          setStrategies(sData);
        }
        if (grpRes.ok) {
          const gData: StockGroup[] = await grpRes.json();
          setGroups(gData);
        }

        if (isNew) {
          // New portfolio: use defaults and skip backend load.
          setPortfolio(null);
          setName("");
          setBaseCurrency("INR");
          setUniverseScope("");
          setAllowedStrategyIds([]);
          setMaxPosPct("20");
          setMaxPositions("10");
          setDdTolerance("0");
          setProductType("delivery");
          setBacktests([]);
          setSelectedBacktestId(null);
          setSelectedBacktest(null);
          setBacktestsState("idle");
          setLoadState("success");
          return;
        }

        const [pfRes, btRes] = await Promise.all([
          fetch(`${API_BASE}/api/portfolios/${id}`),
          fetch(`${API_BASE}/api/portfolios/${id}/backtests`)
        ]);

        if (!pfRes.ok) {
          setLoadState("error");
          setBacktestsState("error");
          return;
        }

        const pfData: PortfolioDto = await pfRes.json();
        setPortfolio(pfData);
        setName(pfData.name);
        setBaseCurrency(pfData.base_currency || "INR");
        setUniverseScope(pfData.universe_scope ?? "");
        const allowedIds = (pfData.allowed_strategies ?? []).filter(
          (v): v is number => typeof v === "number"
        );
        setAllowedStrategyIds(allowedIds);
        const risk = (pfData.risk_profile ?? {}) as {
          maxPositionSizePct?: number;
          maxConcurrentPositions?: number;
          drawdownTolerancePct?: number;
          productType?: string;
        };
        setMaxPosPct(
          risk.maxPositionSizePct != null ? String(risk.maxPositionSizePct) : "20"
        );
        setMaxPositions(
          risk.maxConcurrentPositions != null
            ? String(risk.maxConcurrentPositions)
            : "10"
        );
        setDdTolerance(
          risk.drawdownTolerancePct != null
            ? String(risk.drawdownTolerancePct)
            : "0"
        );
        if (risk.productType === "intraday") {
          setProductType("intraday");
        } else if (risk.productType === "hybrid") {
          setProductType("hybrid");
        } else {
          setProductType("delivery");
        }

        if (btRes.ok) {
          const btData: PortfolioBacktest[] = await btRes.json();
          setBacktests(btData);
          if (btData.length > 0) {
            setBacktestsState("success");
            setSelectedBacktestId(btData[0].id);
            setSelectedBacktest(btData[0]);
          } else {
            setBacktestsState("idle");
          }
        } else {
          setBacktestsState("error");
        }

        setLoadState("success");
      } catch {
        setLoadState("error");
        setBacktestsState("error");
      }
    };
    void load();
  }, [id, isNew]);

  const handleTabChange = (
    _event: SyntheticEvent,
    value: "overview" | "settings" | "backtests" | "trades" | "analytics"
  ) => {
    setTab(value);
  };

  const strategyNameById = useMemo(() => {
    const map: Record<number, string> = {};
    strategies.forEach((s) => {
      map[s.id] = s.name;
    });
    return map;
  }, [strategies]);

  const equitySeries = useMemo(() => {
    if (!selectedBacktest || !selectedBacktest.metrics) return [];
    const m = selectedBacktest.metrics as Record<string, unknown>;
    const curve = (m.equity_curve as
      | { timestamp: string; equity: number }[]
      | undefined) ?? [];
    return curve.map((pt) => ({
      time: pt.timestamp,
      equity: pt.equity
    }));
  }, [selectedBacktest]);

  const handleSaveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setSettingsState("error");
      setSettingsMessage("Name is required.");
      return;
    }
    setSettingsState("loading");
    setSettingsMessage(null);

    const risk_profile: Record<string, unknown> = {};
    const maxPos = Number(maxPosPct);
    const maxPosNum = Number.isFinite(maxPos) ? maxPos : 20;
    risk_profile.maxPositionSizePct = maxPosNum;

    const maxPosCount = Number(maxPositions);
    const maxPosCountNum = Number.isFinite(maxPosCount) ? maxPosCount : 10;
    risk_profile.maxConcurrentPositions = maxPosCountNum;

    const ddTolNum = Number(ddTolerance);
    if (Number.isFinite(ddTolNum) && ddTolNum > 0) {
      risk_profile.drawdownTolerancePct = ddTolNum;
    }
    risk_profile.productType = productType;

    const payload: Record<string, unknown> = {
      name: name.trim(),
      base_currency: baseCurrency || "INR",
      universe_scope: universeScope || null,
      allowed_strategies: allowedStrategyIds,
      risk_profile
    };

    try {
      let res: Response;
      if (isNew) {
        // Creating a new portfolio; generate a simple code from the name.
        const generatedCode =
          name
            .trim()
            .toUpperCase()
            .replace(/\s+/g, "_")
            .slice(0, 12) || "PORTFOLIO";
        payload.code = generatedCode;
        res = await fetch(`${API_BASE}/api/portfolios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else if (portfolio) {
        res = await fetch(`${API_BASE}/api/portfolios/${portfolio.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        setSettingsState("error");
        setSettingsMessage("Missing portfolio context.");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setSettingsState("error");
        setSettingsMessage(
          (err as { detail?: string }).detail ??
            "Failed to update portfolio settings."
        );
        return;
      }
      const updated: PortfolioDto = await res.json();
      setPortfolio(updated);
      setSettingsState("success");
      setSettingsMessage(isNew ? "Portfolio created." : "Settings saved.");
      setSnackbarSeverity("success");
      setSnackbarMessage(
        isNew ? "Portfolio created." : "Portfolio settings updated."
      );
      if (isNew) {
        navigate(`/portfolios/${updated.id}`);
      }
    } catch (error) {
      setSettingsState("error");
      setSettingsMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
      setSnackbarSeverity("error");
      setSnackbarMessage("Failed to update portfolio settings.");
    }
  };

  const handleCancelSettings = () => {
    if (!portfolio) return;
    setName(portfolio.name);
    setBaseCurrency(portfolio.base_currency || "INR");
    setUniverseScope(portfolio.universe_scope ?? "");
    const allowedIds = (portfolio.allowed_strategies ?? []).filter(
      (v): v is number => typeof v === "number"
    );
    setAllowedStrategyIds(allowedIds);
    const risk = (portfolio.risk_profile ?? {}) as {
      maxPositionSizePct?: number;
      maxConcurrentPositions?: number;
      drawdownTolerancePct?: number;
      productType?: string;
    };
    setMaxPosPct(
      risk.maxPositionSizePct != null ? String(risk.maxPositionSizePct) : "20"
    );
    setMaxPositions(
      risk.maxConcurrentPositions != null
        ? String(risk.maxConcurrentPositions)
        : "10"
    );
    setDdTolerance(
      risk.drawdownTolerancePct != null
        ? String(risk.drawdownTolerancePct)
        : "0"
    );
    if (risk.productType === "intraday") {
      setProductType("intraday");
    } else if (risk.productType === "hybrid") {
      setProductType("hybrid");
    } else {
      setProductType("delivery");
    }
    setSettingsState("idle");
    setSettingsMessage(null);
  };

  const handleRunBacktest = async () => {
    if (!portfolio) return;
    if (!btStartDate || !btEndDate) {
      setBtState("error");
      setBtMessage("Start and end dates are required.");
      return;
    }
    setBtState("loading");
    setBtMessage(null);
    const params = new URLSearchParams({
      timeframe: btTimeframe,
      start: `${btStartDate}T00:00:00`,
      end: `${btEndDate}T23:59:00`,
      initial_capital: String(Number(btInitialCapital) || 100000)
    });
    try {
      const res = await fetch(
        `${API_BASE}/api/portfolios/${portfolio.id}/backtests?${params.toString()}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setBtState("error");
        setBtMessage(
          (err as { detail?: string }).detail ??
            "Failed to run portfolio backtest."
        );
        return;
      }
      const created: PortfolioBacktest = await res.json();
      setBacktests((prev) => [created, ...prev]);
      setSelectedBacktestId(created.id);
      setSelectedBacktest(created);
      setBtState("success");
      setBtMessage(
        `Portfolio backtest #${created.id} completed with status ${created.status}.`
      );
    } catch (error) {
      setBtState("error");
      setBtMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const handleSelectBacktest = (bt: PortfolioBacktest) => {
    setSelectedBacktestId(bt.id);
    setSelectedBacktest(bt);
  };

  const tradesColumns: GridColDef<TradeRow>[] = [
    { field: "date", headerName: "Date", flex: 1, minWidth: 130 },
    { field: "symbol", headerName: "Symbol", flex: 0.7, minWidth: 80 },
    { field: "strategy", headerName: "Strategy", flex: 1, minWidth: 120 },
    { field: "side", headerName: "Side", flex: 0.5, minWidth: 80 },
    {
      field: "quantity",
      headerName: "Qty",
      type: "number",
      flex: 0.6,
      minWidth: 80
    },
    {
      field: "price",
      headerName: "Price",
      type: "number",
      flex: 0.8,
      minWidth: 90
    },
    {
      field: "notional",
      headerName: "Notional",
      type: "number",
      flex: 1,
      minWidth: 120
    },
    {
      field: "fees",
      headerName: "Fees",
      type: "number",
      flex: 0.8,
      minWidth: 90
    },
    {
      field: "realisedPnl",
      headerName: "Realised PnL",
      type: "number",
      flex: 1,
      minWidth: 120
    },
    {
      field: "unrealisedPnl",
      headerName: "Unrealised PnL",
      type: "number",
      flex: 1,
      minWidth: 130
    }
  ];

  const holdingsColumns: GridColDef<HoldingRow>[] = [
    { field: "symbol", headerName: "Symbol", flex: 0.7, minWidth: 80 },
    {
      field: "quantity",
      headerName: "Qty",
      type: "number",
      flex: 0.6,
      minWidth: 80
    },
    {
      field: "avgCost",
      headerName: "Avg cost",
      type: "number",
      flex: 0.8,
      minWidth: 90
    },
    {
      field: "marketPrice",
      headerName: "Market price",
      type: "number",
      flex: 0.8,
      minWidth: 110
    },
    {
      field: "marketValue",
      headerName: "Market value",
      type: "number",
      flex: 1,
      minWidth: 120
    },
    {
      field: "unrealisedPnl",
      headerName: "Unrealised PnL",
      type: "number",
      flex: 1,
      minWidth: 130
    },
    {
      field: "weightPct",
      headerName: "Weight %",
      type: "number",
      flex: 0.7,
      minWidth: 90,
      renderCell: (params: GridRenderCellParams<HoldingRow, number>) => {
        const v = params.value ?? 0;
        return <Typography variant="body2">{v.toFixed(2)}%</Typography>;
      }
    }
  ];

  if (!id) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">Portfolio not found</Typography>
      </Box>
    );
  }

  if (loadState === "loading" && !portfolio) {
    return (
      <Box sx={{ p: 3, display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading portfolio…</Typography>
      </Box>
    );
  }

  if (loadState === "error" && !portfolio && !isNew) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          Failed to load portfolio.
        </Typography>
      </Box>
    );
  }

  const universeLabel = formatUniverseLabel(
    portfolio?.universe_scope ?? universeScope ?? null,
    groups
  );

  const allowedStrategyNames = allowedStrategyIds
    .map((idNum) => strategyNameById[idNum])
    .filter((name) => Boolean(name));

  const renderOverviewTab = () => {
    const metrics = (selectedBacktest?.metrics ??
      {}) as Record<string, unknown>;
    const initial =
      (metrics.initial_capital as number | undefined) ??
      selectedBacktest?.initial_capital ??
      0;
    const finalVal =
      (metrics.final_value as number | undefined) ?? initial ?? 0;
    const pnl =
      (metrics.pnl as number | undefined) ?? finalVal - (initial ?? 0);
    const maxDd = (metrics.max_drawdown as number | undefined) ?? 0;
    const sharpe =
      (metrics.sharpe_ratio as number | undefined) ??
      (metrics.sharpe as number | undefined) ??
      0;
    const vol =
      (metrics.volatility as number | undefined) ??
      (metrics.annual_volatility as number | undefined) ??
      0;

    return (
      <Box sx={{ mt: 2 }}>
        {/* Backtest selector */}
        <Box sx={{ mb: 2, display: "flex", gap: 2, alignItems: "center" }}>
          <Typography variant="subtitle1">Backtest:</Typography>
          <TextField
            select
            size="small"
            value={selectedBacktestId ?? ""}
            onChange={(e) => {
              const nextId = Number(e.target.value);
              const bt = backtests.find((b) => b.id === nextId) ?? null;
              setSelectedBacktestId(nextId || null);
              setSelectedBacktest(bt);
            }}
            sx={{ minWidth: 220 }}
          >
            {backtests.map((bt) => (
              <MenuItem key={bt.id} value={bt.id}>
                #{bt.id} – {bt.timeframe} –{" "}
                {new Date(bt.start_date).toLocaleDateString("en-IN")} →{" "}
                {new Date(bt.end_date).toLocaleDateString("en-IN")}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {/* Summary cards */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">
                  Final value
                </Typography>
                <Typography variant="h6">
                  {finalVal.toFixed(2)} {portfolio?.base_currency ?? ""}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">
                  PnL %
                </Typography>
                <Typography
                  variant="h6"
                  sx={{
                    color:
                      pnl > 0
                        ? "success.main"
                        : pnl < 0
                        ? "error.main"
                        : "text.primary"
                  }}
                >
                  {initial !== 0
                    ? ((pnl / initial) * 100).toFixed(2)
                    : "0.00"}
                  %
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">
                  Max drawdown
                </Typography>
                <Typography variant="h6">{maxDd.toFixed(2)}%</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={3}>
            <Card>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary">
                  Sharpe / Vol
                </Typography>
                <Typography variant="h6">
                  {sharpe.toFixed(2)} / {vol.toFixed(4)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Equity chart and allocation/contribution placeholders */}
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2, height: 320 }}>
              <Typography variant="subtitle1" gutterBottom>
                Equity curve
              </Typography>
              {equitySeries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Run a portfolio backtest to see equity and drawdown charts.
                </Typography>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equitySeries}>
                    <XAxis dataKey="time" hide />
                    <YAxis />
                    <RechartsTooltip />
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke="#42a5f5"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Paper>
          </Grid>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2, height: 320 }}>
              <Typography variant="subtitle1" gutterBottom>
                Allocation &amp; contribution
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Future iterations will show sector/strategy allocations and
                per-symbol contribution tables here. For now, this card serves
                as a placeholder aligned with the PRD.
              </Typography>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    );
  };

  const renderSettingsTab = () => {
    return (
      <Box sx={{ mt: 2 }}>
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            Portfolio definition
          </Typography>
          <Box
            component="form"
            onSubmit={handleSaveSettings}
            noValidate
            sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          >
            <Grid container spacing={2}>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Code"
                  size="small"
                  value={portfolio?.code ?? ""}
                  InputProps={{ readOnly: true }}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Name"
                  size="small"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Base currency"
                  size="small"
                  select
                  fullWidth
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                >
                  <MenuItem value="INR">INR</MenuItem>
                  <MenuItem value="USD">USD</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} md={8}>
                <TextField
                  label="Universe"
                  size="small"
                  select
                  fullWidth
                  value={universeScope}
                  onChange={(e) => setUniverseScope(e.target.value)}
                >
                  <MenuItem value="">(none)</MenuItem>
                  {groups.map((g) => (
                    <MenuItem key={g.id} value={`group:${g.id}`}>
                      {g.code} – {g.name} ({g.stock_count} stocks)
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>

              {/* Allowed strategies & weights */}
              <Grid item xs={12} md={6}>
                <TextField
                  label="Allowed strategies"
                  size="small"
                  select
                  fullWidth
                  SelectProps={{ multiple: true }}
                  value={allowedStrategyIds}
                  onChange={(e) =>
                    setAllowedStrategyIds(
                      typeof e.target.value === "string"
                        ? e.target.value
                            .split(",")
                            .map((v) => Number(v.trim()))
                            .filter((v) => !Number.isNaN(v))
                        : (e.target.value as number[])
                    )
                  }
                  helperText="Select which strategies may generate trades for this portfolio."
                >
                  {strategies.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                <Typography variant="caption" color="text.secondary">
                  Strategy weights will be supported in later iterations. For
                  now, all allowed strategies are treated equally.
                </Typography>
              </Grid>

              {/* Risk profile */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Risk profile
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Max position size (% of capital)"
                  size="small"
                  fullWidth
                  value={maxPosPct}
                  onChange={(e) => setMaxPosPct(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Max concurrent positions"
                  size="small"
                  fullWidth
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Drawdown tolerance (%)"
                  size="small"
                  fullWidth
                  value={ddTolerance}
                  onChange={(e) => setDdTolerance(e.target.value)}
                />
              </Grid>

              {/* Product constraints */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Product constraints
                </Typography>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField
                  label="Product type"
                  size="small"
                  select
                  fullWidth
                  value={productType}
                  onChange={(e) =>
                    setProductType(
                      e.target.value as "delivery" | "intraday" | "hybrid"
                    )
                  }
                  helperText="Delivery: CNC longs only. Intraday: MIS trades only. Hybrid: mix of both as per strategy rules."
                >
                  <MenuItem value="delivery">Delivery only (CNC)</MenuItem>
                  <MenuItem value="intraday">Intraday only (MIS)</MenuItem>
                  <MenuItem value="hybrid">Hybrid</MenuItem>
                </TextField>
              </Grid>

              {/* Rebalancing settings */}
              <Grid item xs={12}>
                <Typography variant="subtitle2" gutterBottom>
                  Rebalancing settings
                </Typography>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Rebalance frequency"
                  size="small"
                  select
                  fullWidth
                  value={rebalanceFrequency}
                  onChange={(e) => setRebalanceFrequency(e.target.value)}
                >
                  <MenuItem value="daily">Daily</MenuItem>
                  <MenuItem value="weekly">Weekly</MenuItem>
                  <MenuItem value="monthly">Monthly</MenuItem>
                  <MenuItem value="quarterly">Quarterly</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={12} md={4}>
                <TextField
                  label="Drift trigger (%)"
                  size="small"
                  fullWidth
                  value={driftTrigger}
                  onChange={(e) => setDriftTrigger(e.target.value)}
                  helperText="Rebalance when weight drifts by more than this threshold."
                />
              </Grid>
              <Grid item xs={12} md={4}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={deRiskingEnabled}
                      onChange={(e) => setDeRiskingEnabled(e.target.checked)}
                    />
                  }
                  label="Enable DD de-risking (details in engine PRD)"
                />
              </Grid>
            </Grid>

            <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
              <Button
                type="submit"
                variant="contained"
                size="small"
                disabled={settingsState === "loading"}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="outlined"
                size="small"
                onClick={handleCancelSettings}
                disabled={settingsState === "loading"}
              >
                Cancel
              </Button>
              {settingsMessage && (
                <Typography
                  variant="caption"
                  color={settingsState === "error" ? "error" : "textSecondary"}
                  sx={{ ml: 1 }}
                >
                  {settingsMessage}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>
      </Box>
    );
  };

  const renderBacktestsTab = () => {
    return (
      <Box sx={{ mt: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Run portfolio backtest
              </Typography>
              <Stack spacing={1.5}>
                <TextField
                  label="Interval"
                  size="small"
                  select
                  value={btTimeframe}
                  onChange={(e) => setBtTimeframe(e.target.value)}
                >
                  <MenuItem value="1d">1 day</MenuItem>
                  <MenuItem value="1h">1 hour</MenuItem>
                  <MenuItem value="30m">30 minutes</MenuItem>
                </TextField>
                <TextField
                  label="Start date"
                  type="date"
                  size="small"
                  value={btStartDate}
                  onChange={(e) => setBtStartDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="End date"
                  type="date"
                  size="small"
                  value={btEndDate}
                  onChange={(e) => setBtEndDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  label="Initial capital"
                  size="small"
                  value={btInitialCapital}
                  onChange={(e) => setBtInitialCapital(e.target.value)}
                />
                {/* Benchmark and cost model selectors can be wired later */}
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleRunBacktest}
                  disabled={btState === "loading"}
                >
                  Run backtest
                </Button>
                {btMessage && (
                  <Typography
                    variant="caption"
                    color={btState === "error" ? "error" : "textSecondary"}
                  >
                    {btMessage}
                  </Typography>
                )}
              </Stack>
            </Paper>
          </Grid>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Backtest runs
              </Typography>
              <TableBacktests
                backtests={backtests}
                selectedBacktestId={selectedBacktestId}
                onSelect={handleSelectBacktest}
              />
            </Paper>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Inline preview
              </Typography>
              {equitySeries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Select a backtest to see a mini equity preview.
                </Typography>
              ) : (
                <Box sx={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equitySeries}>
                      <XAxis dataKey="time" hide />
                      <YAxis />
                      <RechartsTooltip />
                      <Line
                        type="monotone"
                        dataKey="equity"
                        stroke="#66bb6a"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </Paper>
          </Grid>
        </Grid>
      </Box>
    );
  };

  const renderTradesHoldingsTab = () => {
    const tradesRows: TradeRow[] = [];
    const holdingsRows: HoldingRow[] = [];

    const rowsToUse =
      tradesOrHoldings === "trades" ? tradesRows : holdingsRows;
    const columnsToUse =
      tradesOrHoldings === "trades" ? tradesColumns : holdingsColumns;

    return (
      <Box sx={{ mt: 2 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1
          }}
        >
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant={tradesOrHoldings === "trades" ? "contained" : "outlined"}
              onClick={() => setTradesOrHoldings("trades")}
            >
              Trades
            </Button>
            <Button
              size="small"
              variant={
                tradesOrHoldings === "holdings" ? "contained" : "outlined"
              }
              onClick={() => setTradesOrHoldings("holdings")}
            >
              Holdings
            </Button>
          </Stack>
          <Button
            size="small"
            variant="outlined"
            disabled={rowsToUse.length === 0}
          >
            Export CSV
          </Button>
        </Box>

        <Paper sx={{ p: 1 }}>
          <div style={{ width: "100%", height: 420 }}>
            <DataGrid
              rows={rowsToUse}
              columns={columnsToUse}
              density="compact"
              pageSizeOptions={[10, 25, 50]}
              paginationModel={{ pageSize: 10, page: 0 }}
              getRowId={(row) => row.id}
            />
          </div>
        </Paper>
        {rowsToUse.length === 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1 }}
          >
            Trades and holdings for portfolio backtests will appear here once
            portfolio-level trade capture is implemented.
          </Typography>
        )}
      </Box>
    );
  };

  const renderAnalyticsTab = () => {
    const metrics = (selectedBacktest?.metrics ??
      {}) as Record<string, unknown>;
    const vol =
      (metrics.volatility as number | undefined) ??
      (metrics.annual_volatility as number | undefined) ??
      0;
    const sharpe =
      (metrics.sharpe_ratio as number | undefined) ??
      (metrics.sharpe as number | undefined) ??
      0;
    const sortino =
      (metrics.sortino_ratio as number | undefined) ??
      (metrics.sortino as number | undefined) ??
      0;
    const maxDd = (metrics.max_drawdown as number | undefined) ?? 0;

    return (
      <Box sx={{ mt: 2 }}>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Risk metrics
              </Typography>
              <Typography variant="body2">
                Volatility: {vol.toFixed(4)}
              </Typography>
              <Typography variant="body2">
                Sharpe: {sharpe.toFixed(3)}
              </Typography>
              <Typography variant="body2">
                Sortino: {sortino.toFixed(3)}
              </Typography>
              <Typography variant="body2">
                Max drawdown: {maxDd.toFixed(2)}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Future iterations will extend this panel with VaR-like metrics
                and rolling statistics.
              </Typography>
            </Paper>
          </Grid>
          <Grid item xs={12} md={8}>
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Equity &amp; drawdown
              </Typography>
              {equitySeries.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Run and select a portfolio backtest to explore analytics.
                </Typography>
              ) : (
                <Box sx={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equitySeries}>
                      <XAxis dataKey="time" hide />
                      <YAxis />
                      <RechartsTooltip />
                      <Line
                        type="monotone"
                        dataKey="equity"
                        stroke="#ff9800"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </Box>
              )}
            </Paper>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                Allocation &amp; exposures
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Sector/industry and per-strategy allocation charts will be
                plugged in here as portfolio allocation data becomes available.
              </Typography>
            </Paper>
          </Grid>
        </Grid>
      </Box>
    );
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 1
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="small"
            startIcon={<ArrowBackIcon />}
            onClick={() => navigate("/portfolios")}
          >
            Portfolios
          </Button>
          <Box>
            <Typography variant="h6">
              {isNew ? "New portfolio" : portfolio?.name ?? "Portfolio"}
              {!isNew && portfolio ? ` (${portfolio.code})` : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {universeLabel || "No universe selected yet."}
            </Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1}>
          {allowedStrategyNames.map((name) => (
            <Chip key={name} label={name} size="small" />
          ))}
        </Stack>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={handleTabChange}
        textColor="inherit"
        indicatorColor="primary"
        sx={{ borderBottom: 1, borderColor: "divider", mb: 1 }}
      >
        <Tab label="Overview" value="overview" />
        <Tab label="Settings" value="settings" />
        <Tab label="Backtests" value="backtests" />
        <Tab label="Trades & Holdings" value="trades" />
        <Tab label="Analytics" value="analytics" />
      </Tabs>

      {tab === "overview" && renderOverviewTab()}
      {tab === "settings" && renderSettingsTab()}
      {tab === "backtests" && renderBacktestsTab()}
      {tab === "trades" && renderTradesHoldingsTab()}
      {tab === "analytics" && renderAnalyticsTab()}

      <Snackbar
        open={Boolean(snackbarMessage)}
        autoHideDuration={6000}
        onClose={() => setSnackbarMessage(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {snackbarMessage ? (
          <Alert
            onClose={() => setSnackbarMessage(null)}
            severity={snackbarSeverity}
            variant="filled"
            sx={{ width: "100%" }}
          >
            {snackbarMessage}
          </Alert>
        ) : null}
      </Snackbar>
    </Box>
  );
};

type BacktestsTableProps = {
  backtests: PortfolioBacktest[];
  selectedBacktestId: number | null;
  onSelect: (bt: PortfolioBacktest) => void;
};

const TableBacktests = ({
  backtests,
  selectedBacktestId,
  onSelect
}: BacktestsTableProps) => {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Recent portfolio backtests.
      </Typography>
      <Box sx={{ width: "100%", maxHeight: 260, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>ID</th>
              <th style={{ textAlign: "left" }}>Timeframe</th>
              <th style={{ textAlign: "left" }}>Start</th>
              <th style={{ textAlign: "left" }}>End</th>
              <th style={{ textAlign: "right" }}>Initial</th>
              <th style={{ textAlign: "right" }}>Final</th>
              <th style={{ textAlign: "right" }}>PnL %</th>
              <th style={{ textAlign: "left" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {backtests.map((bt) => {
              const metrics = (bt.metrics ?? {}) as Record<string, unknown>;
              const initial =
                (metrics.initial_capital as number | undefined) ??
                bt.initial_capital;
              const finalVal =
                (metrics.final_value as number | undefined) ?? initial;
              const pnl =
                (metrics.pnl as number | undefined) ?? finalVal - initial;
              const pnlPct =
                initial !== 0 ? ((pnl / initial) * 100).toFixed(2) : "0.00";

              const selected = bt.id === selectedBacktestId;

              return (
                <tr
                  key={bt.id}
                  style={{
                    cursor: "pointer",
                    backgroundColor: selected ? "rgba(25,118,210,0.08)" : "inherit"
                  }}
                  onClick={() => onSelect(bt)}
                >
                  <td>#{bt.id}</td>
                  <td>{bt.timeframe}</td>
                  <td>{formatDateTime(bt.start_date)}</td>
                  <td>{formatDateTime(bt.end_date)}</td>
                  <td style={{ textAlign: "right" }}>{initial.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{finalVal.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{pnlPct}%</td>
                  <td>{bt.status}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {backtests.length === 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 1 }}
          >
            No portfolio backtests yet. Use the configuration panel to run one.
          </Typography>
        )}
      </Box>
    </Box>
  );
};
