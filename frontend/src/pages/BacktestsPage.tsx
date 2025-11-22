import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { FormEvent, useEffect, useState } from "react";
import { BacktestDetailChart } from "../features/backtests/components/BacktestDetailChart";
import { useAppearance } from "../appearanceContext";

type Strategy = {
  id: number;
  name: string;
  code: string;
};

type StrategyParameter = {
  id: number;
  strategy_id: number;
  label: string;
};

type BacktestMetrics = {
  final_value?: number;
  initial_capital?: number;
  pnl?: number;
  [key: string]: unknown;
};

type RiskConfig = {
  maxPositionSizePct?: number | null;
  perTradeRiskPct?: number | null;
  allowShortSelling?: boolean | null;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
};

type CostsConfig = {
  commissionType?: "flat" | "percent" | null;
  commissionValue?: number | null;
  slippagePerShare?: number | null;
  otherChargesPct?: number | null;
};

type VisualConfig = {
  showTradeMarkers?: boolean | null;
  showProjection?: boolean | null;
  showVolume?: boolean | null;
  showEquityCurve?: boolean | null;
};

type Backtest = {
  id: number;
  strategy_id: number;
  params_id: number | null;
  engine: string;
  label: string | null;
  notes: string | null;
  symbols_json: string[];
  timeframe: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  status: string;
  metrics: BacktestMetrics;
  data_source: string | null;
  risk_config?: RiskConfig | null;
  costs_config?: CostsConfig | null;
  visual_config?: VisualConfig | null;
  created_at: string;
  finished_at: string | null;
};

type EquityPoint = {
  timestamp: string;
  equity: number;
};

type Trade = {
  id: number;
  symbol: string;
  side: string;
  size: number;
  entry_timestamp: string;
  entry_price: number;
  exit_timestamp: string;
  exit_price: number;
  pnl: number;
  pnl_pct?: number | null;
  holding_period_bars?: number | null;
  max_theoretical_pnl?: number | null;
  max_theoretical_pnl_pct?: number | null;
  pnl_capture_ratio?: number | null;
};

type BacktestChartPriceBar = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type BacktestChartData = {
  backtest: Backtest;
  price_bars: BacktestChartPriceBar[];
  indicators: Record<string, { timestamp: string; value: number }[]>;
  equity_curve: EquityPoint[];
  projection_curve: EquityPoint[];
  trades: (Trade & {
    pnl_pct?: number | null;
    holding_period_bars?: number | null;
    max_theoretical_pnl?: number | null;
    max_theoretical_pnl_pct?: number | null;
    pnl_capture_ratio?: number | null;
  })[];
};

type StrategyParameterDetail = {
  id: number;
  strategy_id: number;
  label: string;
  params: Record<string, unknown>;
  notes: string | null;
  created_at: string;
};

type FetchState = "idle" | "loading" | "success" | "error";

type DataSummaryItem = {
  coverage_id: string;
  symbol: string;
  exchange?: string | null;
  timeframe: string;
  source?: string | null;
  start_timestamp: string;
  end_timestamp: string;
  bar_count: number;
};

const API_BASE = "http://127.0.0.1:8000";

export const BacktestsPage = () => {
  const { chartThemeId } = useAppearance();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(
    null
  );
  const [selectedParamsId, setSelectedParamsId] = useState<number | null>(null);

  const [symbol, setSymbol] = useState("");
  const [exchange, setExchange] = useState("NSE");
  const [timeframe, setTimeframe] = useState("1h");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("09:15");
  const [endTime, setEndTime] = useState("15:30");
  const [initialCapital, setInitialCapital] = useState("100000");
  const [priceSource, setPriceSource] = useState("kite");
  const [overrideJson, setOverrideJson] = useState("");

  const [runState, setRunState] = useState<FetchState>("idle");
  const [runMessage, setRunMessage] = useState<string | null>(null);

  const [backtests, setBacktests] = useState<Backtest[]>([]);
  const [selectedBacktestId, setSelectedBacktestId] = useState<number | null>(
    null
  );
  const [selectedBacktest, setSelectedBacktest] = useState<Backtest | null>(
    null
  );
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [paramDetail, setParamDetail] = useState<StrategyParameterDetail | null>(
    null
  );
  const [priceBars, setPriceBars] = useState<BacktestChartPriceBar[]>([]);
  const [projection, setProjection] = useState<EquityPoint[]>([]);
  const [detailState, setDetailState] = useState<FetchState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [indicators, setIndicators] = useState<
    Record<string, { timestamp: string; value: number }[]>
  >({});

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const [coverageSummary, setCoverageSummary] = useState<DataSummaryItem[]>([]);
  const [useExistingCoverage, setUseExistingCoverage] = useState(false);
  const [selectedCoverageId, setSelectedCoverageId] = useState<string>("");

  const [visualSettings, setVisualSettings] = useState<VisualConfig>({
    showTradeMarkers: true,
    showProjection: true,
    showVolume: true,
    showEquityCurve: true
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "inputs" | "risk" | "costs" | "visual" | "meta"
  >("inputs");
  const [settingsLabel, setSettingsLabel] = useState("");
  const [settingsNotes, setSettingsNotes] = useState("");
  const [riskConfig, setRiskConfig] = useState<RiskConfig>({});
  const [costsConfig, setCostsConfig] = useState<CostsConfig>({});
  const [settingsState, setSettingsState] = useState<FetchState>("idle");
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const resetRunFormDefaults = () => {
    setSelectedStrategyId(null);
    setSelectedParamsId(null);
    setUseExistingCoverage(false);
    setSymbol("");
    setExchange("NSE");
    setTimeframe("1h");
    const today = new Date();
    const endIso = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - 1);
    const startIso = start.toISOString().slice(0, 10);
    setStartDate(startIso);
    setEndDate(endIso);
    setStartTime("09:15");
    setEndTime("15:30");
    setInitialCapital("100000");
    setPriceSource("kite");
    setOverrideJson("");
    setRunState("idle");
    setRunMessage(null);
  };

  useEffect(() => {
    resetRunFormDefaults();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [strategiesRes, backtestsRes, coverageRes] = await Promise.all([
          fetch(`${API_BASE}/api/strategies`),
          fetch(`${API_BASE}/api/backtests`),
          fetch(`${API_BASE}/api/data/summary`)
        ]);

        if (strategiesRes.ok) {
          const strategyData: Strategy[] = await strategiesRes.json();
          setStrategies(strategyData);
        }

        if (backtestsRes.ok) {
          const backtestData: Backtest[] = await backtestsRes.json();
          setBacktests(backtestData);
          if (backtestData.length > 0) {
            const first = backtestData[0];
            setSelectedBacktestId(first.id);
            setSelectedBacktest(first);
            const vc = (first.visual_config ?? {}) as VisualConfig;
            setVisualSettings({
              showTradeMarkers: vc.showTradeMarkers ?? true,
              showProjection: vc.showProjection ?? true,
              showVolume: vc.showVolume ?? true
            });
            setPage(0);
          }
        }

        if (coverageRes.ok) {
          const data: DataSummaryItem[] = await coverageRes.json();
          setCoverageSummary(data);
          if (data.length > 0) {
            setSelectedCoverageId(data[0].coverage_id);
          }
        }
      } catch {
        // ignore; user can still interact with the page
      }
    };
    loadInitialData();
  }, []);

  useEffect(() => {
    // Clamp current page if the number of backtests or page size changes.
    const totalPages = Math.max(1, Math.ceil(backtests.length / pageSize));
    if (page > totalPages - 1) {
      setPage(totalPages - 1);
    }
  }, [backtests.length, pageSize, page]);

  useEffect(() => {
    const loadParams = async () => {
      if (!selectedStrategyId) {
        setSelectedParamsId(null);
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/api/strategies/${selectedStrategyId}/params`
        );
        if (!res.ok) return;
        const data: StrategyParameter[] = await res.json();
        if (data.length > 0) {
          // Prefer an explicit api_default label where present; otherwise
          // fall back to the first parameter for the strategy.
          const apiDefault = data.find((p) => p.label === "api_default");
          setSelectedParamsId((apiDefault ?? data[0]).id);
        } else {
          setSelectedParamsId(null);
        }
      } catch {
        // ignore; page will still allow manual configuration
      }
    };
    loadParams();
  }, [selectedStrategyId]);

  const handleRunBacktest = async (event: FormEvent) => {
    event.preventDefault();
    setRunState("loading");
    setRunMessage(null);

    if (!selectedStrategyId) {
      setRunState("error");
      setRunMessage("Select a strategy first.");
      return;
    }

    let overrides: Record<string, unknown> | null = null;
    if (overrideJson.trim()) {
      try {
        overrides = JSON.parse(overrideJson) as Record<string, unknown>;
      } catch (error) {
        setRunState("error");
        setRunMessage(
          error instanceof Error
            ? error.message
            : "Invalid JSON for override params"
        );
        return;
      }
    }

    // Determine effective symbol/timeframe/date range, either from a selected
    // coverage row or from the manual form inputs.
    let effectiveSymbol = symbol.trim().toUpperCase();
    let effectiveTimeframe = timeframe;
    let effectiveStartDate = startDate;
    let effectiveEndDate = endDate;
    let effectiveStartTime = startTime || "09:15";
    let effectiveEndTime = endTime || "15:30";
    let effectivePriceSource = priceSource || null;

    if (useExistingCoverage) {
      const cov = coverageSummary.find(
        (c) => c.coverage_id === selectedCoverageId
      );
      if (!cov) {
        setRunState("error");
        setRunMessage("Select a coverage ID or switch to fresh data.");
        return;
      }

      effectiveSymbol = cov.symbol;
      effectiveTimeframe = cov.timeframe;
      effectiveStartDate = cov.start_timestamp.slice(0, 10);
      effectiveEndDate = cov.end_timestamp.slice(0, 10);
      // For existing coverage, rely on backend defaults for session times.
      effectiveStartTime = "";
      effectiveEndTime = "";
      effectivePriceSource = cov.source ?? priceSource ?? null;
    } else {
      // When fetching fresh data, ensure required fields are present.
      if (!symbol.trim() || !timeframe || !startDate || !endDate) {
        setRunState("error");
        setRunMessage(
          "Provide symbol, interval, and date range when fetching fresh data."
        );
        return;
      }

      // Trigger a fresh data fetch so the prices DB is up-to-date for this
      // backtest. The Data page will also reflect the updated coverage.
      try {
        const fetchPayload = {
          symbol: symbol.trim().toUpperCase(),
          timeframe,
          start_date: startDate,
          end_date: endDate,
          source: priceSource === "kite" || priceSource === "yfinance"
            ? (priceSource as "kite" | "yfinance")
            : "kite",
          csv_path: null,
          exchange
        };
        const fetchRes = await fetch(`${API_BASE}/api/data/fetch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fetchPayload)
        });
        if (!fetchRes.ok) {
          const err = await fetchRes.json().catch(() => ({}));
          setRunState("error");
          setRunMessage(err.detail ?? "Failed to fetch fresh data for backtest");
          return;
        }
        // Reload coverage summary so the new/updated coverage is available.
        const coverageRes = await fetch(`${API_BASE}/api/data/summary`);
        if (coverageRes.ok) {
          const data: DataSummaryItem[] = await coverageRes.json();
          setCoverageSummary(data);
        }
      } catch (error) {
        setRunState("error");
        setRunMessage(
          error instanceof Error
            ? error.message
            : "Unexpected error while fetching fresh data"
        );
        return;
      }
    }

    const payload: Record<string, unknown> = {
      strategy_id: selectedStrategyId,
      params_id: selectedParamsId,
      symbol: effectiveSymbol,
      timeframe: effectiveTimeframe,
      start_date: effectiveStartDate,
      end_date: effectiveEndDate,
      // Optional intraday times; when omitted the backend will default
      // to the standard India cash session of 09:15–15:30.
      ...(effectiveStartTime && { start_time: effectiveStartTime }),
      ...(effectiveEndTime && { end_time: effectiveEndTime }),
      initial_capital: Number(initialCapital) || 0,
      price_source: effectivePriceSource,
      params: overrides
    };

    try {
      const res = await fetch(`${API_BASE}/api/backtests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRunState("error");
        setRunMessage(err.detail ?? "Backtest run failed");
        return;
      }

      const created: Backtest = await res.json();
      setBacktests((prev) => [created, ...prev]);
      setPage(0);
      // Load detail for the newly created backtest.
      void handleSelectBacktest(created);
      setRunState("success");

      const metrics = created.metrics;
      const pnl =
        typeof metrics.pnl === "number" ? metrics.pnl.toFixed(2) : undefined;
      const finalValue =
        typeof metrics.final_value === "number"
          ? metrics.final_value.toFixed(2)
          : undefined;

      let summary = `Backtest ${created.id} completed.`;
      if (pnl !== undefined) {
        summary += ` PnL: ${pnl}.`;
      }
      if (finalValue !== undefined) {
        summary += ` Final value: ${finalValue}.`;
      }
      setRunMessage(summary);
      resetRunFormDefaults();
    } catch (error) {
      setRunState("error");
      setRunMessage(
        error instanceof Error ? error.message : "Unexpected error occurred"
      );
    }
  };

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

  const getStrategyLabel = (strategyId: number) => {
    const strategy = strategies.find((s) => s.id === strategyId);
    if (!strategy) return String(strategyId);
    return `${strategy.code} – ${strategy.name}`;
  };

  const renderSymbols = (symbols: string[]) => {
    if (symbols.length === 0) return "";
    if (symbols.length === 1) return symbols[0];
    return `${symbols[0]} +${symbols.length - 1}`;
  };

  const renderPnL = (metrics: BacktestMetrics) => {
    if (typeof metrics.pnl !== "number") return "";
    const value = metrics.pnl;
    const formatted = value.toFixed(2);
    return value >= 0 ? `+${formatted}` : formatted;
  };

  const hasStrategies = strategies.length > 0;
  const totalPages =
    backtests.length === 0 ? 1 : Math.max(1, Math.ceil(backtests.length / pageSize));
  const pagedBacktests = backtests.slice(
    page * pageSize,
    page * pageSize + pageSize
  );

  const handleSelectBacktest = async (backtest: Backtest) => {
    setSelectedBacktestId(backtest.id);
    setSelectedBacktest(backtest);
    setDetailState("loading");
    setDetailError(null);
    setEquity([]);
    setTrades([]);
    setParamDetail(null);

    try {
      const chartRes = await fetch(
        `${API_BASE}/api/backtests/${backtest.id}/chart-data`
      );
      if (chartRes.ok) {
        const chart: BacktestChartData = await chartRes.json();
        setPriceBars(chart.price_bars);
        setEquity(chart.equity_curve);
        setProjection(chart.projection_curve);
        setTrades(chart.trades);
        setIndicators(chart.indicators ?? {});
        const b = chart.backtest;
        setSelectedBacktest(b);
        const vc = (b.visual_config ?? {}) as VisualConfig;
        setVisualSettings({
          showTradeMarkers: vc.showTradeMarkers ?? true,
          showProjection: vc.showProjection ?? true,
          showVolume: vc.showVolume ?? true
        });
      }

      if (backtest.params_id != null) {
        const paramRes = await fetch(
          `${API_BASE}/api/params/${backtest.params_id}`
        );
        if (paramRes.ok) {
          const detail: StrategyParameterDetail = await paramRes.json();
          setParamDetail(detail);
        }
      }

      setDetailState("success");
    } catch (error) {
      setDetailState("error");
      setDetailError(
        error instanceof Error ? error.message : "Failed to load backtest detail"
      );
    }
  };

  const formatPercent = (value: unknown) => {
    if (typeof value !== "number") return "";
    return `${(value * 100).toFixed(2)}%`;
  };

  const formatNumber = (value: unknown) => {
    if (typeof value !== "number") return "";
    return value.toFixed(2);
  };

  const [selectedBacktestIds, setSelectedBacktestIds] = useState<Set<number>>(
    () => new Set()
  );

  const handleToggleBacktestSelection = (id: number) => {
    setSelectedBacktestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAllBacktestsOnPage = () => {
    const idsOnPage = pagedBacktests.map((b) => b.id);
    setSelectedBacktestIds((prev) => {
      const next = new Set(prev);
      idsOnPage.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleDeleteSelectedBacktests = async () => {
    if (selectedBacktestIds.size === 0) {
      return;
    }
    if (
      !window.confirm(
        `Delete ${selectedBacktestIds.size} backtest(s)? This cannot be undone.`
      )
    ) {
      return;
    }

    const ids = Array.from(selectedBacktestIds);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const resp = await fetch(`${API_BASE}/api/backtests/${id}`, {
        method: "DELETE"
      });
      if (!resp.ok && resp.status !== 404) {
        // Stop on first unexpected error.
        // eslint-disable-next-line no-alert
        window.alert(`Failed to delete backtest ${id}: HTTP ${resp.status}`);
        break;
      }
    }

    setBacktests((prev) => prev.filter((b) => !selectedBacktestIds.has(b.id)));
    setSelectedBacktestIds(new Set());
    if (selectedBacktest && selectedBacktestIds.has(selectedBacktest.id)) {
      setSelectedBacktestId(null);
      setSelectedBacktest(null);
    }
  };

  const tradesWithCumulative = (() => {
    let cum = 0;
    const equityByTimestamp: Record<string, number> = {};
    equity.forEach((pt) => {
      equityByTimestamp[pt.timestamp] = pt.equity;
    });
    return trades.map((t) => {
      cum += t.pnl;
      return {
        ...t,
        cum_pnl: cum,
        equity_at_exit: equityByTimestamp[t.exit_timestamp]
      };
    });
  })();

  const [showTradesTable, setShowTradesTable] = useState(false);
  const [chartFullscreenOpen, setChartFullscreenOpen] = useState(false);

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Backtests
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card
            sx={{
              height: 460,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <CardContent sx={{ flex: 1, overflowY: "auto" }}>
              <Typography variant="h6" gutterBottom>
                Run Backtest
              </Typography>
              {!hasStrategies ? (
                <Typography variant="body2" color="textSecondary">
                  No strategies found. Create at least one strategy and parameter
                  set in the Strategy Library before running backtests.
                </Typography>
              ) : (
                <Box component="form" onSubmit={handleRunBacktest} noValidate>
                  <TextField
                    select
                    fullWidth
                    margin="normal"
                    label="Strategy"
                    value={selectedStrategyId ?? ""}
                    onChange={(e) =>
                      setSelectedStrategyId(
                        e.target.value === ""
                          ? null
                          : Number.parseInt(e.target.value, 10)
                      )
                    }
                    helperText="Select a strategy to run (required)"
                  >
                    <MenuItem value="">None</MenuItem>
                    {strategies.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.code} – {s.name}
                      </MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    select
                    fullWidth
                    margin="normal"
                    label="Data mode"
                    helperText="Use existing coverage (ID) or fetch fresh data"
                    value={useExistingCoverage ? "existing" : "fresh"}
                    onChange={(e) =>
                      setUseExistingCoverage(e.target.value === "existing")
                    }
                  >
                    <MenuItem value="existing">Use existing coverage</MenuItem>
                    <MenuItem value="fresh">Fetch fresh data</MenuItem>
                  </TextField>

                  {useExistingCoverage ? (
                    <>
                      <TextField
                        select
                        fullWidth
                        margin="normal"
                        label="Coverage ID"
                        value={selectedCoverageId}
                        onChange={(e) => setSelectedCoverageId(e.target.value)}
                      >
                        {coverageSummary.map((c) => (
                          <MenuItem key={c.coverage_id} value={c.coverage_id}>
                            {c.coverage_id} – {c.symbol} {c.timeframe}{" "}
                            {c.source ?? ""}
                          </MenuItem>
                        ))}
                      </TextField>
                    </>
                  ) : (
                    <>
                      <TextField
                        fullWidth
                        margin="normal"
                        label="Symbol"
                        value={symbol}
                        onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                      />

                      <TextField
                        select
                        fullWidth
                        margin="normal"
                        label="Exchange"
                        value={exchange}
                        onChange={(e) => setExchange(e.target.value)}
                      >
                        <MenuItem value="NSE">NSE</MenuItem>
                        <MenuItem value="BSE">BSE</MenuItem>
                        <MenuItem value="US">US</MenuItem>
                        <MenuItem value="CRYPTO">CRYPTO</MenuItem>
                      </TextField>

                      <TextField
                        select
                        fullWidth
                        margin="normal"
                        label="Interval"
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value)}
                      >
                        <MenuItem value="1m">1 minute</MenuItem>
                        <MenuItem value="3m">3 minutes</MenuItem>
                        <MenuItem value="5m">5 minutes</MenuItem>
                        <MenuItem value="15m">15 minutes</MenuItem>
                        <MenuItem value="30m">30 minutes</MenuItem>
                        <MenuItem value="1h">1 hour</MenuItem>
                        <MenuItem value="1d">1 day</MenuItem>
                      </TextField>

                      <Grid container spacing={2}>
                        <Grid item xs={6}>
                          <TextField
                            fullWidth
                            margin="normal"
                            label="Start date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                          />
                          <TextField
                            fullWidth
                            margin="normal"
                            label="Start time"
                            type="time"
                            InputLabelProps={{ shrink: true }}
                            value={startTime}
                            onChange={(e) => setStartTime(e.target.value)}
                          />
                        </Grid>
                        <Grid item xs={6}>
                          <TextField
                            fullWidth
                            margin="normal"
                            label="End date"
                            type="date"
                            InputLabelProps={{ shrink: true }}
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                          />
                          <TextField
                            fullWidth
                            margin="normal"
                            label="End time"
                            type="time"
                            InputLabelProps={{ shrink: true }}
                            value={endTime}
                            onChange={(e) => setEndTime(e.target.value)}
                          />
                        </Grid>
                      </Grid>
                    </>
                  )}

                  <TextField
                    fullWidth
                    margin="normal"
                    label="Initial capital"
                    type="number"
                    value={initialCapital}
                    onChange={(e) => setInitialCapital(e.target.value)}
                  />

                  <TextField
                    select
                    fullWidth
                    margin="normal"
                    label="Price source label"
                    helperText="Optional label to track which data source was used"
                    value={priceSource}
                    onChange={(e) => setPriceSource(e.target.value)}
                  >
                    <MenuItem value="prices_db">prices_db</MenuItem>
                    <MenuItem value="kite">kite</MenuItem>
                    <MenuItem value="yfinance">yfinance</MenuItem>
                    <MenuItem value="synthetic">synthetic</MenuItem>
                    <MenuItem value="csv">csv</MenuItem>
                  </TextField>

                  <TextField
                    fullWidth
                    margin="normal"
                    label="Override params JSON (optional)"
                    multiline
                    minRows={3}
                    value={overrideJson}
                    onChange={(e) => setOverrideJson(e.target.value)}
                  />

                  <Box mt={2}>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={runState === "loading"}
                    >
                      {runState === "loading" ? "Running..." : "Run backtest"}
                    </Button>
                  </Box>
                  {runMessage && (
                    <Typography
                      variant="body2"
                      color={runState === "error" ? "error" : "textSecondary"}
                      mt={1}
                    >
                      {runMessage}
                    </Typography>
                  )}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={7}>
          <Card
            sx={{
              height: 460,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <CardContent
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                overflow: "hidden"
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1
                }}
              >
                <Typography variant="h6">Recent Backtests</Typography>
                {backtests.length > 0 && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleSelectAllBacktestsOnPage}
                    >
                      Select page
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      disabled={selectedBacktestIds.size === 0}
                      onClick={handleDeleteSelectedBacktests}
                    >
                      Delete selected
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setPage(0)}
                      disabled={page === 0}
                    >
                      {"<<"}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                    >
                      {"<"}
                    </Button>
                    <TextField
                      label="Page size"
                      type="number"
                      size="small"
                      value={pageSize}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10);
                        setPageSize(Number.isNaN(n) || n <= 0 ? 10 : n);
                        setPage(0);
                      }}
                      sx={{ width: 90 }}
                      InputProps={{ inputProps: { min: 1 } }}
                    />
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() =>
                        setPage((p) => Math.min(totalPages - 1, p + 1))
                      }
                      disabled={page >= totalPages - 1}
                    >
                      {">"}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setPage(totalPages - 1)}
                      disabled={page >= totalPages - 1}
                    >
                      {">>"}
                    </Button>
                  </Box>
                )}
              </Box>
              {backtests.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No backtests have been run yet. Submit a backtest to see it
                  listed here.
                </Typography>
              ) : (
                <Box sx={{ flex: 1, overflowY: "auto" }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell />
                        <TableCell>ID</TableCell>
                        <TableCell>Strategy</TableCell>
                        <TableCell>Symbol(s)</TableCell>
                        <TableCell>Timeframe</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell align="right">PnL</TableCell>
                        <TableCell align="right">Final value</TableCell>
                        <TableCell>Created</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {pagedBacktests.map((b) => (
                        <TableRow
                          key={b.id}
                          hover
                          selected={selectedBacktestId === b.id}
                          onClick={() => handleSelectBacktest(b)}
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell padding="checkbox">
                            <input
                              type="checkbox"
                              checked={selectedBacktestIds.has(b.id)}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleToggleBacktestSelection(b.id);
                              }}
                            />
                          </TableCell>
                          <TableCell>{b.id}</TableCell>
                          <TableCell>
                            {getStrategyLabel(b.strategy_id)}
                          </TableCell>
                          <TableCell>
                            {renderSymbols(b.symbols_json ?? [])}
                          </TableCell>
                          <TableCell>{b.timeframe}</TableCell>
                          <TableCell>{b.status}</TableCell>
                          <TableCell align="right">
                            {renderPnL(b.metrics)}
                          </TableCell>
                          <TableCell align="right">
                            {typeof b.metrics.final_value === "number"
                              ? b.metrics.final_value.toFixed(2)
                              : ""}
                          </TableCell>
                          <TableCell>{formatDateTime(b.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {selectedBacktest && (
        <Box mt={3}>
          <Card>
            <CardContent>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1
                }}
              >
                <Typography variant="h6">
                  Backtest Details – #{selectedBacktest.id}
                </Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setChartFullscreenOpen(true)}
                  >
                    Fullscreen chart
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      if (!selectedBacktest) return;
                      setSettingsError(null);
                      setSettingsState("idle");
                      setSettingsTab("inputs");
                      setSettingsLabel(selectedBacktest.label ?? "");
                      setSettingsNotes(selectedBacktest.notes ?? "");
                      const rc = (selectedBacktest.risk_config ??
                        {}) as RiskConfig;
                      const cc = (selectedBacktest.costs_config ??
                        {}) as CostsConfig;
                      setRiskConfig(rc);
                      setCostsConfig(cc);
                      const vc = (selectedBacktest.visual_config ??
                        {}) as VisualConfig;
                      setVisualSettings({
                        showTradeMarkers: vc.showTradeMarkers ?? true,
                        showProjection: vc.showProjection ?? true,
                        showVolume: vc.showVolume ?? true,
                        showEquityCurve: vc.showEquityCurve ?? true
                      });
                      setSettingsOpen(true);
                    }}
                  >
                    Settings
                  </Button>
                </Box>
              </Box>
              <Grid container spacing={3}>
                <Grid item xs={12} md={3}>
                  <Typography variant="subtitle2" gutterBottom>
                    Summary
                  </Typography>
                  <Typography variant="body2">
                    Strategy: {getStrategyLabel(selectedBacktest.strategy_id)}
                  </Typography>
                  <Typography variant="body2">
                    Symbol(s): {renderSymbols(selectedBacktest.symbols_json ?? [])}
                  </Typography>
                  <Typography variant="body2">
                    Interval: {selectedBacktest.timeframe}
                  </Typography>
                  <Typography variant="body2">
                    Period:{" "}
                    {`${formatDateTime(selectedBacktest.start_date)} → ${formatDateTime(
                      selectedBacktest.end_date
                    )}`}
                  </Typography>
                  <Typography variant="body2">
                    Status: {selectedBacktest.status}
                  </Typography>
                  <Typography variant="body2">
                    Initial capital:{" "}
                    {formatNumber(selectedBacktest.metrics.initial_capital)}
                  </Typography>
                  <Typography variant="body2">
                    Final value: {formatNumber(selectedBacktest.metrics.final_value)}
                  </Typography>
                  <Typography variant="body2">
                    PnL: {formatNumber(selectedBacktest.metrics.pnl)}
                  </Typography>
                  <Typography variant="body2">
                    Total return: {formatPercent(selectedBacktest.metrics.total_return)}
                  </Typography>
                  <Typography variant="body2">
                    Max drawdown:{" "}
                    {formatPercent(selectedBacktest.metrics.max_drawdown)}
                  </Typography>
                  <Typography variant="body2">
                    Trade count: {formatNumber(selectedBacktest.metrics.trade_count)}
                  </Typography>
                  <Typography variant="body2">
                    Win rate: {formatPercent(selectedBacktest.metrics.win_rate)}
                  </Typography>
                  <Typography variant="body2">
                    Avg win: {formatNumber(selectedBacktest.metrics.avg_win)}
                  </Typography>
                  <Typography variant="body2">
                    Avg loss: {formatNumber(selectedBacktest.metrics.avg_loss)}
                  </Typography>
                  {paramDetail && (
                    <Box mt={2}>
                      <Typography variant="subtitle2" gutterBottom>
                        Parameters – {paramDetail.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        component="pre"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          backgroundColor: "rgba(255,255,255,0.02)",
                          p: 1,
                          borderRadius: 1
                        }}
                      >
                        {JSON.stringify(paramDetail.params, null, 2)}
                      </Typography>
                    </Box>
                  )}
                  {detailState === "error" && detailError && (
                    <Typography variant="body2" color="error" mt={1}>
                      {detailError}
                    </Typography>
                  )}
                </Grid>

                <Grid item xs={12} md={9}>
                  <Typography variant="subtitle2" gutterBottom>
                    Price & Trades
                  </Typography>
                  {priceBars.length === 0 ? (
                    <Typography variant="body2" color="textSecondary">
                      No chart data available for this backtest.
                    </Typography>
                  ) : (
                    <Box sx={{ height: 640 }}>
                      <BacktestDetailChart
                        priceBars={priceBars}
                        equityCurve={equity}
                        projectionCurve={projection}
                        trades={trades}
                        indicators={indicators}
                        height={620}
                        showTradeMarkers={
                          visualSettings.showTradeMarkers ?? true
                        }
                        showProjection={visualSettings.showProjection ?? true}
                        showVolume={visualSettings.showVolume ?? true}
                        chartTheme={chartThemeId}
                        showEquityCurve={visualSettings.showEquityCurve ?? true}
                      />
                    </Box>
                  )}

                  <Box mt={3}>
                    <Typography variant="subtitle2" gutterBottom>
                      Trades
                    </Typography>
                    <Box mb={1}>
                      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            if (!selectedBacktest) return;
                            window.open(
                              `${API_BASE}/api/backtests/${selectedBacktest.id}/trades/export`,
                              "_blank"
                            );
                          }}
                        >
                          Export CSV
                        </Button>
                        {trades.length > 0 && (
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setShowTradesTable((prev) => !prev)}
                          >
                            {showTradesTable ? "Hide trades table" : "Show trades table"}
                          </Button>
                        )}
                      </Box>
                    </Box>
                    {trades.length === 0 ? (
                      <Typography variant="body2" color="textSecondary">
                        No trades recorded for this backtest.
                      </Typography>
                    ) : showTradesTable ? (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>ID</TableCell>
                            <TableCell>Symbol</TableCell>
                            <TableCell>Side</TableCell>
                            <TableCell align="right">Size</TableCell>
                            <TableCell>Entry</TableCell>
                            <TableCell align="right">Entry price</TableCell>
                            <TableCell>Exit</TableCell>
                            <TableCell align="right">Exit price</TableCell>
                            <TableCell align="right">PnL</TableCell>
                            <TableCell align="right">PnL %</TableCell>
                            <TableCell align="right">Equity</TableCell>
                            <TableCell align="right">What-if PnL</TableCell>
                            <TableCell align="right">Capture</TableCell>
                            <TableCell align="right">Cum PnL</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {tradesWithCumulative.map((t) => (
                            <TableRow key={t.id}>
                              <TableCell>{t.id}</TableCell>
                              <TableCell>{t.symbol}</TableCell>
                              <TableCell>{t.side}</TableCell>
                              <TableCell align="right">
                                {t.size.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                {formatDateTime(t.entry_timestamp)}
                              </TableCell>
                              <TableCell align="right">
                                {t.entry_price.toFixed(2)}
                              </TableCell>
                              <TableCell>
                                {formatDateTime(t.exit_timestamp)}
                              </TableCell>
                              <TableCell align="right">
                                {t.exit_price.toFixed(2)}
                              </TableCell>
                              <TableCell align="right">
                                {t.pnl.toFixed(2)}
                              </TableCell>
                              <TableCell align="right">
                                {typeof t.pnl_pct === "number"
                                  ? (t.pnl_pct * 100).toFixed(2)
                                  : ""}
                              </TableCell>
                              <TableCell align="right">
                                {typeof t.equity_at_exit === "number"
                                  ? t.equity_at_exit.toFixed(2)
                                  : ""}
                              </TableCell>
                              <TableCell align="right">
                                {typeof t.max_theoretical_pnl === "number"
                                  ? t.max_theoretical_pnl.toFixed(2)
                                  : ""}
                              </TableCell>
                              <TableCell align="right">
                                {typeof t.pnl_capture_ratio === "number"
                                  ? (t.pnl_capture_ratio * 100).toFixed(2)
                                  : ""}
                              </TableCell>
                              <TableCell align="right">
                                {t.cum_pnl.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : null}
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Box>
      )}

      {selectedBacktest && chartFullscreenOpen && (
        <Dialog
          open={chartFullscreenOpen}
          onClose={() => setChartFullscreenOpen(false)}
          fullScreen
        >
          <DialogTitle>
            Backtest Chart – #{selectedBacktest.id} (
            {renderSymbols(selectedBacktest.symbols_json ?? [])}{" "}
            {selectedBacktest.timeframe})
          </DialogTitle>
          <DialogContent dividers>
            {priceBars.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                No chart data available for this backtest.
              </Typography>
            ) : (
              <Box sx={{ height: 720 }}>
                <BacktestDetailChart
                  priceBars={priceBars}
                  equityCurve={equity}
                  projectionCurve={projection}
                  trades={trades}
                  indicators={indicators}
                  height={700}
                  showTradeMarkers={visualSettings.showTradeMarkers ?? true}
                  showProjection={visualSettings.showProjection ?? true}
                  showVolume={visualSettings.showVolume ?? true}
                  chartTheme={chartThemeId}
                  showEquityCurve={visualSettings.showEquityCurve ?? true}
                />
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setChartFullscreenOpen(false)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {selectedBacktest && (
        <Dialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle>
            Backtest Settings – #{selectedBacktest.id}
          </DialogTitle>
          <DialogContent dividers>
            <Tabs
              value={settingsTab}
              onChange={(_, value) =>
                setSettingsTab(value as typeof settingsTab)
              }
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab label="Inputs" value="inputs" />
              <Tab label="Risk" value="risk" />
              <Tab label="Costs" value="costs" />
              <Tab label="Visualization" value="visual" />
              <Tab label="Meta / Notes" value="meta" />
            </Tabs>
            <Box mt={2}>
              {settingsTab === "inputs" && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Strategy inputs
                  </Typography>
                  {paramDetail ? (
                    <>
                      <Typography variant="body2" gutterBottom>
                        Parameter label: {paramDetail.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        component="pre"
                        sx={{
                          fontFamily: "monospace",
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          backgroundColor: "rgba(255,255,255,0.02)",
                          p: 1,
                          borderRadius: 1
                        }}
                      >
                        {JSON.stringify(paramDetail.params, null, 2)}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="textSecondary"
                        mt={1}
                      >
                        Inputs are currently read-only; parameter overrides per
                        backtest can be added in a later sprint.
                      </Typography>
                    </>
                  ) : (
                    <Typography variant="body2" color="textSecondary">
                      No parameter detail available for this backtest.
                    </Typography>
                  )}
                </Box>
              )}

              {settingsTab === "risk" && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Risk settings (stored metadata)
                  </Typography>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Max position size (% of capital)"
                    type="number"
                    value={riskConfig.maxPositionSizePct ?? ""}
                    onChange={(e) =>
                      setRiskConfig((prev) => ({
                        ...prev,
                        maxPositionSizePct:
                          e.target.value === ""
                            ? null
                            : Number.parseFloat(e.target.value)
                      }))
                    }
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Per-trade risk (% of capital)"
                    type="number"
                    value={riskConfig.perTradeRiskPct ?? ""}
                    onChange={(e) =>
                      setRiskConfig((prev) => ({
                        ...prev,
                        perTradeRiskPct:
                          e.target.value === ""
                            ? null
                            : Number.parseFloat(e.target.value)
                      }))
                    }
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(riskConfig.allowShortSelling)}
                        onChange={(e) =>
                          setRiskConfig((prev) => ({
                            ...prev,
                            allowShortSelling: e.target.checked
                          }))
                        }
                      />
                    }
                    label="Allow short selling"
                  />
                  <Grid container spacing={2} mt={1}>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        margin="normal"
                        label="Default stop-loss (%)"
                        type="number"
                        value={riskConfig.stopLossPct ?? ""}
                        onChange={(e) =>
                          setRiskConfig((prev) => ({
                            ...prev,
                            stopLossPct:
                              e.target.value === ""
                                ? null
                                : Number.parseFloat(e.target.value)
                          }))
                        }
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        margin="normal"
                        label="Default take-profit (%)"
                        type="number"
                        value={riskConfig.takeProfitPct ?? ""}
                        onChange={(e) =>
                          setRiskConfig((prev) => ({
                            ...prev,
                            takeProfitPct:
                              e.target.value === ""
                                ? null
                                : Number.parseFloat(e.target.value)
                          }))
                        }
                      />
                    </Grid>
                  </Grid>
                </Box>
              )}

              {settingsTab === "costs" && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Costs & fees (stored metadata)
                  </Typography>
                  <TextField
                    select
                    fullWidth
                    margin="normal"
                    label="Commission type"
                    value={costsConfig.commissionType ?? ""}
                    onChange={(e) =>
                      setCostsConfig((prev) => ({
                        ...prev,
                        commissionType:
                          (e.target.value as "flat" | "percent" | "") || null
                      }))
                    }
                  >
                    <MenuItem value="">None</MenuItem>
                    <MenuItem value="flat">Flat per trade</MenuItem>
                    <MenuItem value="percent">Percent of notional</MenuItem>
                  </TextField>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Commission value"
                    type="number"
                    value={costsConfig.commissionValue ?? ""}
                    onChange={(e) =>
                      setCostsConfig((prev) => ({
                        ...prev,
                        commissionValue:
                          e.target.value === ""
                            ? null
                            : Number.parseFloat(e.target.value)
                      }))
                    }
                  />
                  <Grid container spacing={2}>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        margin="normal"
                        label="Slippage per share"
                        type="number"
                        value={costsConfig.slippagePerShare ?? ""}
                        onChange={(e) =>
                          setCostsConfig((prev) => ({
                            ...prev,
                            slippagePerShare:
                              e.target.value === ""
                                ? null
                                : Number.parseFloat(e.target.value)
                          }))
                        }
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <TextField
                        fullWidth
                        margin="normal"
                        label="Other charges (%)"
                        type="number"
                        value={costsConfig.otherChargesPct ?? ""}
                        onChange={(e) =>
                          setCostsConfig((prev) => ({
                            ...prev,
                            otherChargesPct:
                              e.target.value === ""
                                ? null
                                : Number.parseFloat(e.target.value)
                          }))
                        }
                      />
                    </Grid>
                  </Grid>
                </Box>
              )}

              {settingsTab === "visual" && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Visualization
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(visualSettings.showEquityCurve ?? true)}
                        onChange={(e) =>
                          setVisualSettings((prev) => ({
                            ...prev,
                            showEquityCurve: e.target.checked
                          }))
                        }
                      />
                    }
                    label="Show equity curve"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(visualSettings.showTradeMarkers ?? true)}
                        onChange={(e) =>
                          setVisualSettings((prev) => ({
                            ...prev,
                            showTradeMarkers: e.target.checked
                          }))
                        }
                      />
                    }
                    label="Show trade markers (entries/exits)"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(visualSettings.showProjection ?? true)}
                        onChange={(e) =>
                          setVisualSettings((prev) => ({
                            ...prev,
                            showProjection: e.target.checked
                          }))
                        }
                      />
                    }
                    label="Show unrealised projection curve"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(visualSettings.showVolume ?? true)}
                        onChange={(e) =>
                          setVisualSettings((prev) => ({
                            ...prev,
                            showVolume: e.target.checked
                          }))
                        }
                      />
                    }
                    label="Show volume histogram"
                  />
                </Box>
              )}

              {settingsTab === "meta" && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Meta & notes
                  </Typography>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Backtest label"
                    value={settingsLabel}
                    onChange={(e) => setSettingsLabel(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Notes"
                    multiline
                    minRows={3}
                    value={settingsNotes}
                    onChange={(e) => setSettingsNotes(e.target.value)}
                  />
                </Box>
              )}

              {settingsState === "error" && settingsError && (
                <Typography variant="body2" color="error" mt={2}>
                  {settingsError}
                </Typography>
              )}
              {settingsState === "success" && (
                <Typography variant="body2" color="textSecondary" mt={2}>
                  Settings updated for this backtest.
                </Typography>
              )}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSettingsOpen(false)}>Close</Button>
            <Button
              variant="contained"
              disabled={settingsState === "loading"}
              onClick={async () => {
                if (!selectedBacktest) return;
                setSettingsState("loading");
                setSettingsError(null);
                try {
                  const payload: Record<string, unknown> = {
                    label: settingsLabel || null,
                    notes: settingsNotes || null,
                    risk_config: riskConfig,
                    costs_config: costsConfig,
                    visual_config: visualSettings
                  };
                  const res = await fetch(
                    `${API_BASE}/api/backtests/${selectedBacktest.id}/settings`,
                    {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload)
                    }
                  );
                  if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    setSettingsState("error");
                    setSettingsError(
                      (err as { detail?: string }).detail ??
                        "Failed to update settings"
                    );
                    return;
                  }
                  const updated: Backtest = await res.json();
                  setSelectedBacktest(updated);
                  setBacktests((prev) =>
                    prev.map((b) => (b.id === updated.id ? updated : b))
                  );
                  const vc = (updated.visual_config ?? {}) as VisualConfig;
                  setVisualSettings({
                    showTradeMarkers: vc.showTradeMarkers ?? true,
                    showProjection: vc.showProjection ?? true,
                    showVolume: vc.showVolume ?? true
                  });
                  setSettingsState("success");
                } catch (error) {
                  setSettingsState("error");
                  setSettingsError(
                    error instanceof Error
                      ? error.message
                      : "Unexpected error while saving settings"
                  );
                }
              }}
            >
              Save
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};
