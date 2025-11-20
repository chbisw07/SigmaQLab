import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid
} from "recharts";
import { FormEvent, useEffect, useState } from "react";

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

type Backtest = {
  id: number;
  strategy_id: number;
  params_id: number | null;
  engine: string;
  symbols_json: string[];
  timeframe: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  status: string;
  metrics: BacktestMetrics;
  data_source: string | null;
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

const API_BASE = "http://127.0.0.1:8000";

export const BacktestsPage = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(
    null
  );
  const [params, setParams] = useState<StrategyParameter[]>([]);
  const [selectedParamsId, setSelectedParamsId] = useState<number | null>(null);

  const [symbol, setSymbol] = useState("TESTBT");
  const [timeframe, setTimeframe] = useState("1d");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [initialCapital, setInitialCapital] = useState("100000");
  const [priceSource, setPriceSource] = useState("prices_db");
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
  const [detailState, setDetailState] = useState<FetchState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    setStartDate(iso);
    setEndDate(iso);
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [strategiesRes, backtestsRes] = await Promise.all([
          fetch(`${API_BASE}/api/strategies`),
          fetch(`${API_BASE}/api/backtests`)
        ]);

        if (strategiesRes.ok) {
          const strategyData: Strategy[] = await strategiesRes.json();
          setStrategies(strategyData);
          if (strategyData.length > 0) {
            setSelectedStrategyId(strategyData[0].id);
          }
        }

        if (backtestsRes.ok) {
          const backtestData: Backtest[] = await backtestsRes.json();
          setBacktests(backtestData);
          if (backtestData.length > 0) {
            setSelectedBacktestId(backtestData[0].id);
            setSelectedBacktest(backtestData[0]);
            setPage(0);
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
        setParams([]);
        setSelectedParamsId(null);
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/api/strategies/${selectedStrategyId}/params`
        );
        if (!res.ok) return;
        const data: StrategyParameter[] = await res.json();
        setParams(data);
        if (data.length > 0) {
          setSelectedParamsId(data[0].id);
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
      setRunMessage("Select a strategy first (Strategy Library).");
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

    const payload: Record<string, unknown> = {
      strategy_id: selectedStrategyId,
      params_id: selectedParamsId,
      symbol: symbol.trim().toUpperCase(),
      timeframe,
      start_date: startDate,
      end_date: endDate,
      initial_capital: Number(initialCapital) || 0,
      price_source: priceSource || null,
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
        timeZone: "Asia/Kolkata"
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
      const equityPromise = fetch(
        `${API_BASE}/api/backtests/${backtest.id}/equity`
      );
      const tradesPromise = fetch(
        `${API_BASE}/api/backtests/${backtest.id}/trades`
      );

      const [equityRes, tradesRes] = await Promise.all([
        equityPromise,
        tradesPromise
      ]);

      if (equityRes.ok) {
        const eqData: EquityPoint[] = await equityRes.json();
        setEquity(eqData);
      }

      if (tradesRes.ok) {
        const trData: Trade[] = await tradesRes.json();
        setTrades(trData);
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

  const tradesWithCumulative = (() => {
    let cum = 0;
    return trades.map((t) => {
      cum += t.pnl;
      return { ...t, cum_pnl: cum };
    });
  })();

  const tradeExitByTimestamp: Record<string, number> = {};
  trades.forEach((t) => {
    tradeExitByTimestamp[t.exit_timestamp] = t.pnl;
  });

  const equityWithDelta = equity.map((pt, idx) => {
    const prevEquity = idx === 0 ? pt.equity : equity[idx - 1].equity;
    const delta = pt.equity - prevEquity;
    const deltaPct = prevEquity !== 0 ? (delta / prevEquity) * 100 : 0;
    const tradePnl = tradeExitByTimestamp[pt.timestamp];
    return {
      ...pt,
      delta,
      deltaPct,
      tradePnl
    };
  });

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
                  >
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
                    label="Parameter set (optional)"
                    value={selectedParamsId ?? ""}
                    onChange={(e) =>
                      setSelectedParamsId(
                        e.target.value === ""
                          ? null
                          : Number.parseInt(e.target.value, 10)
                      )
                    }
                  >
                    <MenuItem value="">None</MenuItem>
                    {params.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </TextField>

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
                    label="Timeframe"
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                  >
                    <MenuItem value="1m">1 minute</MenuItem>
                    <MenuItem value="5m">5 minutes</MenuItem>
                    <MenuItem value="15m">15 minutes</MenuItem>
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
                    </Grid>
                  </Grid>

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
              <Typography variant="h6" gutterBottom>
                Backtest Details – #{selectedBacktest.id}
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
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
                    Timeframe: {selectedBacktest.timeframe}
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

                <Grid item xs={12} md={8}>
                  <Typography variant="subtitle2" gutterBottom>
                    Equity Curve (net return %)
                  </Typography>
                  {equity.length === 0 ? (
                    <Typography variant="body2" color="textSecondary">
                      No equity data available for this backtest.
                    </Typography>
                  ) : (
                    <Box sx={{ height: 260 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={equityWithDelta.map((pt) => {
                            const init =
                              typeof selectedBacktest.metrics.initial_capital ===
                                "number" &&
                              selectedBacktest.metrics.initial_capital > 0
                                ? selectedBacktest.metrics.initial_capital
                                : selectedBacktest.initial_capital;
                            const pct =
                              init > 0 ? (pt.equity / init - 1) * 100 : 0;
                            return {
                              ...pt,
                              equity_pct: pct
                            };
                          })}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="timestamp" tick={false} />
                          <YAxis
                            tickFormatter={(v) =>
                              `${(v as number).toFixed(2)}%`
                            }
                            domain={["auto", "auto"]}
                          />
                          <Tooltip
                            labelFormatter={(value) =>
                              new Date(value as string).toLocaleString()
                            }
                            formatter={(value: number) =>
                              [`${value.toFixed(2)}%`, "Equity"]
                            }
                          />
                          <Line
                            type="monotone"
                            dataKey="equity_pct"
                            stroke="#90caf9"
                            dot={(props) => {
                              const { cx, cy, payload } = props as {
                                cx: number;
                                cy: number;
                                payload: { tradePnl?: number };
                              };
                              const pnl = payload.tradePnl;
                              if (pnl === undefined) {
                                return null;
                              }
                              const fill = pnl >= 0 ? "#4caf50" : "#ef5350";
                              return (
                                <circle
                                  cx={cx}
                                  cy={cy}
                                  r={4}
                                  fill={fill}
                                  stroke="#000"
                                  strokeWidth={1}
                                />
                              );
                            }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </Box>
                  )}

                  <Box mt={3}>
                    <Typography variant="subtitle2" gutterBottom>
                      Trades
                    </Typography>
                    {trades.length === 0 ? (
                      <Typography variant="body2" color="textSecondary">
                        No trades recorded for this backtest.
                      </Typography>
                    ) : (
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
                                {t.cum_pnl.toFixed(2)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Box>

                  <Box mt={3}>
                    <Typography variant="subtitle2" gutterBottom>
                      Equity Data (last 50 bars)
                    </Typography>
                    {equityWithDelta.length === 0 ? (
                      <Typography variant="body2" color="textSecondary">
                        No equity data available.
                      </Typography>
                    ) : (
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Time</TableCell>
                            <TableCell align="right">Equity</TableCell>
                            <TableCell align="right">Δ Equity</TableCell>
                            <TableCell align="right">Δ %</TableCell>
                            <TableCell align="right">Trade PnL</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {equityWithDelta.slice(-50).map((pt) => (
                            <TableRow key={pt.timestamp}>
                              <TableCell>
                                {formatDateTime(pt.timestamp)}
                              </TableCell>
                              <TableCell align="right">
                                {pt.equity.toFixed(2)}
                              </TableCell>
                              <TableCell align="right">
                                {pt.delta.toFixed(2)}
                              </TableCell>
                              <TableCell align="right">
                                {pt.deltaPct.toFixed(2)}%
                              </TableCell>
                              <TableCell align="right">
                                {pt.tradePnl !== undefined
                                  ? pt.tradePnl.toFixed(2)
                                  : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Box>
      )}
    </Box>
  );
};
