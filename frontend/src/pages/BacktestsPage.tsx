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
        }
      } catch {
        // ignore; user can still interact with the page
      }
    };
    loadInitialData();
  }, []);

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
      return new Date(iso).toLocaleString();
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

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Backtests
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
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
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recent Backtests
              </Typography>
              {backtests.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No backtests have been run yet. Submit a backtest to see it
                  listed here.
                </Typography>
              ) : (
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
                    {backtests.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{b.id}</TableCell>
                        <TableCell>{getStrategyLabel(b.strategy_id)}</TableCell>
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
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
