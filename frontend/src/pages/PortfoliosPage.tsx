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

type FetchState = "idle" | "loading" | "success" | "error";

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

type Portfolio = {
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

export const PortfoliosPage = () => {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [groups, setGroups] = useState<StockGroup[]>([]);

  const [selectedPortfolioId, setSelectedPortfolioId] = useState<number | null>(
    null
  );
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(
    null
  );

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [baseCurrency, setBaseCurrency] = useState("INR");
  const [universeScope, setUniverseScope] = useState<string>("");
  const [allowedStrategyIds, setAllowedStrategyIds] = useState<number[]>([]);
  const [maxPosPct, setMaxPosPct] = useState("20");
  const [maxPositions, setMaxPositions] = useState("10");
  const [notes, setNotes] = useState("");

  const [formState, setFormState] = useState<FetchState>("idle");
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const [backtests, setBacktests] = useState<PortfolioBacktest[]>([]);
  const [selectedBacktestId, setSelectedBacktestId] = useState<number | null>(
    null
  );
  const [selectedBacktest, setSelectedBacktest] =
    useState<PortfolioBacktest | null>(null);

  const [btTimeframe, setBtTimeframe] = useState("1d");
  const [btStartDate, setBtStartDate] = useState("");
  const [btEndDate, setBtEndDate] = useState("");
  const [btInitialCapital, setBtInitialCapital] = useState("100000");
  const [btState, setBtState] = useState<FetchState>("idle");
  const [btMessage, setBtMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  useEffect(() => {
    const loadPortfolios = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/portfolios`);
        if (!res.ok) return;
        const data: Portfolio[] = await res.json();
        setPortfolios(data);
        if (data.length > 0 && !selectedPortfolioId) {
          handleSelectPortfolio(data[0]);
        }
      } catch {
        // ignore; page will show empty state
      }
    };

    const loadStrategies = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/strategies`);
        if (!res.ok) return;
        const data: Strategy[] = await res.json();
        setStrategies(data);
      } catch {
        // ignore
      }
    };

    const loadGroups = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/stock-groups`);
        if (!res.ok) return;
        const data: StockGroup[] = await res.json();
        setGroups(data);
      } catch {
        // ignore
      }
    };

    void loadPortfolios();
    void loadStrategies();
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForm = () => {
    setSelectedPortfolioId(null);
    setSelectedPortfolio(null);
    setCode("");
    setName("");
    setBaseCurrency("INR");
    setUniverseScope("");
    setAllowedStrategyIds([]);
    setMaxPosPct("20");
    setMaxPositions("10");
    setNotes("");
    setFormState("idle");
    setFormMessage(null);
    setBacktests([]);
    setSelectedBacktestId(null);
    setSelectedBacktest(null);
  };

  const handleSelectPortfolio = (p: Portfolio) => {
    setSelectedPortfolioId(p.id);
    setSelectedPortfolio(p);
    setCode(p.code);
    setName(p.name);
    setBaseCurrency(p.base_currency || "INR");
    setUniverseScope(p.universe_scope ?? "");
    const allowed = (p.allowed_strategies ?? []).filter(
      (v): v is number => typeof v === "number"
    );
    setAllowedStrategyIds(allowed);
    const risk = (p.risk_profile ?? {}) as {
      maxPositionSizePct?: number;
      maxConcurrentPositions?: number;
    };
    setMaxPosPct(
      risk.maxPositionSizePct != null ? String(risk.maxPositionSizePct) : "20"
    );
    setMaxPositions(
      risk.maxConcurrentPositions != null
        ? String(risk.maxConcurrentPositions)
        : "10"
    );
    setNotes(p.notes ?? "");
    void loadBacktestsForPortfolio(p.id);
  };

  const loadBacktestsForPortfolio = async (portfolioId: number) => {
    try {
      const res = await fetch(
        `${API_BASE}/api/portfolios/${portfolioId}/backtests`
      );
      if (!res.ok) return;
      const data: PortfolioBacktest[] = await res.json();
      setBacktests(data);
      if (data.length > 0) {
        setSelectedBacktestId(data[0].id);
        setSelectedBacktest(data[0]);
      } else {
        setSelectedBacktestId(null);
        setSelectedBacktest(null);
      }
    } catch {
      // ignore
    }
  };

  const handleSubmitPortfolioForm = async (event: FormEvent) => {
    event.preventDefault();
    setFormState("loading");
    setFormMessage(null);

    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();
    if (!trimmedCode || !trimmedName) {
      setFormState("error");
      setFormMessage("Code and Name are required.");
      return;
    }

    const risk_profile: Record<string, unknown> = {};
    const maxPos = Number(maxPosPct);
    const maxPosNum = Number.isFinite(maxPos) ? maxPos : 20;
    risk_profile.maxPositionSizePct = maxPosNum;

    const maxPosCount = Number(maxPositions);
    const maxPosCountNum = Number.isFinite(maxPosCount) ? maxPosCount : 10;
    risk_profile.maxConcurrentPositions = maxPosCountNum;

    const payload = {
      code: trimmedCode,
      name: trimmedName,
      base_currency: baseCurrency || "INR",
      universe_scope: universeScope || null,
      allowed_strategies: allowedStrategyIds,
      risk_profile,
      rebalance_policy: null,
      notes: notes.trim() || null
    };

    try {
      if (selectedPortfolioId == null) {
        const res = await fetch(`${API_BASE}/api/portfolios`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setFormState("error");
          setFormMessage(
            (err as { detail?: string }).detail ??
              "Failed to create portfolio."
          );
          return;
        }
        const created: Portfolio = await res.json();
        setPortfolios((prev) => [...prev, created]);
        setFormState("success");
        setFormMessage("Portfolio created.");
        handleSelectPortfolio(created);
      } else {
        const res = await fetch(
          `${API_BASE}/api/portfolios/${selectedPortfolioId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setFormState("error");
          setFormMessage(
            (err as { detail?: string }).detail ??
              "Failed to update portfolio."
          );
          return;
        }
        const updated: Portfolio = await res.json();
        setPortfolios((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p))
        );
        setFormState("success");
        setFormMessage("Portfolio updated.");
        handleSelectPortfolio(updated);
      }
    } catch (error) {
      setFormState("error");
      setFormMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const handleDeletePortfolio = async () => {
    if (!selectedPortfolioId) return;
    const current = portfolios.find((p) => p.id === selectedPortfolioId);
    if (
      !window.confirm(
        `Delete portfolio ${current?.code ?? selectedPortfolioId}? This cannot be undone.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/portfolios/${selectedPortfolioId}`,
        {
          method: "DELETE"
        }
      );
      if (!res.ok && res.status !== 204) {
        setFormState("error");
        setFormMessage("Failed to delete portfolio.");
        return;
      }
      setPortfolios((prev) =>
        prev.filter((p) => p.id !== selectedPortfolioId)
      );
      resetForm();
    } catch (error) {
      setFormState("error");
      setFormMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const handleRunBacktest = async () => {
    if (!selectedPortfolioId) {
      setBtState("error");
      setBtMessage("Select a portfolio first.");
      return;
    }
    if (!btStartDate || !btEndDate) {
      setBtState("error");
      setBtMessage("Start and end dates are required.");
      return;
    }

    setBtState("loading");
    setBtMessage(null);

    const startIso = `${btStartDate}T00:00:00`;
    const endIso = `${btEndDate}T23:59:00`;
    const capitalNum = Number(btInitialCapital) || 100000;

    const params = new URLSearchParams({
      timeframe: btTimeframe,
      start: startIso,
      end: endIso,
      initial_capital: String(capitalNum)
    });

    try {
      const res = await fetch(
        `${API_BASE}/api/portfolios/${selectedPortfolioId}/backtests?${params.toString()}`,
        {
          method: "POST"
        }
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
        `Portfolio backtest #${created.id} completed with final value ${(
          (created.metrics?.final_value as number | undefined) ?? 0
        ).toFixed(2)}.`
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

  const renderUniverseLabel = (scope: string | null) => {
    if (!scope) return "";
    if (scope.startsWith("group:")) {
      const id = Number(scope.split(":")[1] ?? "");
      const g = groups.find((gg) => gg.id === id);
      if (g) {
        return `${g.code} – ${g.name}`;
      }
    }
    return scope;
  };

  const renderPortfolioSummary = () => {
    if (!selectedBacktest || !selectedBacktest.metrics) return null;
    const m = selectedBacktest.metrics as Record<string, unknown>;
    const initial = (m.initial_capital as number | undefined) ?? 0;
    const finalVal = (m.final_value as number | undefined) ?? 0;
    const pnl = (m.pnl as number | undefined) ?? finalVal - initial;
    const pnlRealised = (m.pnl_realised as number | undefined) ?? 0;
    const pnlUnrealised = (m.pnl_unrealised as number | undefined) ?? pnl;
    const avgUtil = (m.avg_capital_utilisation as number | undefined) ?? 0;
    const maxUtil = (m.max_capital_utilisation as number | undefined) ?? 0;

    return (
      <Box>
        <Typography variant="subtitle1" gutterBottom>
          Backtest summary – #{selectedBacktest.id}
        </Typography>
        <Typography variant="body2">
          Interval: {selectedBacktest.timeframe} | Period:{" "}
          {formatDateTime(selectedBacktest.start_date)} –{" "}
          {formatDateTime(selectedBacktest.end_date)}
        </Typography>
        <Typography variant="body2">
          Initial capital: {initial.toFixed(2)} | Final value:{" "}
          {finalVal.toFixed(2)} | PnL: {pnl.toFixed(2)}
        </Typography>
        <Typography variant="body2">
          PnL breakdown: realised {pnlRealised.toFixed(2)} / unrealised{" "}
          {pnlUnrealised.toFixed(2)}
        </Typography>
        <Typography variant="body2">
          Capital utilisation (avg / max):{" "}
          {(avgUtil * 100).toFixed(1)}% / {(maxUtil * 100).toFixed(1)}%
        </Typography>
      </Box>
    );
  };

  const filteredPortfolios = portfolios.filter((p) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    );
  });

  const renderPerSymbolTable = () => {
    if (!selectedBacktest || !selectedBacktest.metrics) return null;
    const m = selectedBacktest.metrics as Record<string, unknown>;
    const perSymbol = m.per_symbol as
      | Record<string, { final_value?: number; pnl?: number }>
      | undefined;
    if (!perSymbol) return null;

    const entries = Object.entries(perSymbol);
    if (entries.length === 0) return null;

    return (
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Symbol</TableCell>
            <TableCell align="right">Final value</TableCell>
            <TableCell align="right">PnL</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map(([sym, info]) => (
            <TableRow key={sym}>
              <TableCell>{sym}</TableCell>
              <TableCell align="right">
                {((info.final_value as number | undefined) ?? 0).toFixed(2)}
              </TableCell>
              <TableCell align="right">
                {((info.pnl as number | undefined) ?? 0).toFixed(2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <Box>
      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Portfolio
              </Typography>
              <Box
                component="form"
                onSubmit={handleSubmitPortfolioForm}
                noValidate
                sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}
              >
                <TextField
                  label="Code"
                  size="small"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <TextField
                  label="Name"
                  size="small"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <TextField
                  label="Base currency"
                  size="small"
                  select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                >
                  <MenuItem value="INR">INR</MenuItem>
                  <MenuItem value="USD">USD</MenuItem>
                </TextField>
                <TextField
                  label="Universe"
                  size="small"
                  select
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
                <TextField
                  label="Allowed strategies"
                  size="small"
                  select
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
                >
                  {strategies.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Max position size (% of capital)"
                  size="small"
                  value={maxPosPct}
                  onChange={(e) => setMaxPosPct(e.target.value)}
                />
                <TextField
                  label="Max concurrent positions"
                  size="small"
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(e.target.value)}
                />
                <TextField
                  label="Notes"
                  size="small"
                  multiline
                  minRows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
                  <Button
                    type="submit"
                    variant="contained"
                    size="small"
                    disabled={formState === "loading"}
                  >
                    {selectedPortfolioId == null ? "Create" : "Save changes"}
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={resetForm}
                    disabled={formState === "loading"}
                  >
                    Reset
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    color="error"
                    onClick={handleDeletePortfolio}
                    disabled={selectedPortfolioId == null}
                  >
                    Delete
                  </Button>
                </Box>
                {formMessage && (
                  <Typography
                    variant="caption"
                    color={formState === "error" ? "error" : "textSecondary"}
                  >
                    {formMessage}
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={8}>
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Portfolios
                  </Typography>
                  <TextField
                    label="Search by code or name"
                    size="small"
                    fullWidth
                    margin="dense"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Code</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell>Universe</TableCell>
                        <TableCell>Base</TableCell>
                        <TableCell>Created</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredPortfolios.map((p) => (
                        <TableRow
                          key={p.id}
                          hover
                          selected={p.id === selectedPortfolioId}
                          onClick={() => handleSelectPortfolio(p)}
                          sx={{ cursor: "pointer" }}
                        >
                          <TableCell>{p.code}</TableCell>
                          <TableCell>{p.name}</TableCell>
                          <TableCell>
                            {renderUniverseLabel(p.universe_scope)}
                          </TableCell>
                          <TableCell>{p.base_currency}</TableCell>
                          <TableCell>
                            {formatDateTime(p.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Grid>
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom>
                    Portfolio backtests
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 1,
                      mb: 1
                    }}
                  >
                    <TextField
                      label="Interval"
                      size="small"
                      select
                      value={btTimeframe}
                      onChange={(e) => setBtTimeframe(e.target.value)}
                      sx={{ minWidth: 120 }}
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
                      sx={{ minWidth: 140 }}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleRunBacktest}
                      disabled={btState === "loading"}
                    >
                      Run backtest
                    </Button>
                  </Box>
                  {btMessage && (
                    <Typography
                      variant="caption"
                      color={btState === "error" ? "error" : "textSecondary"}
                    >
                      {btMessage}
                    </Typography>
                  )}
                  <Table size="small" sx={{ mt: 1 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>ID</TableCell>
                        <TableCell>Timeframe</TableCell>
                        <TableCell>Start</TableCell>
                        <TableCell>End</TableCell>
                        <TableCell align="right">Initial</TableCell>
                        <TableCell align="right">Final</TableCell>
                        <TableCell align="right">PnL</TableCell>
                        <TableCell>Status</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {backtests.map((bt) => {
                        const m = (bt.metrics ?? {}) as Record<string, unknown>;
                        const initial =
                          (m.initial_capital as number | undefined) ??
                          bt.initial_capital;
                        const finalVal =
                          (m.final_value as number | undefined) ?? initial;
                        const pnl =
                          (m.pnl as number | undefined) ??
                          finalVal - initial;
                        return (
                          <TableRow
                            key={bt.id}
                            hover
                            selected={bt.id === selectedBacktestId}
                            onClick={() => handleSelectBacktest(bt)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>{bt.id}</TableCell>
                            <TableCell>{bt.timeframe}</TableCell>
                            <TableCell>
                              {formatDateTime(bt.start_date)}
                            </TableCell>
                            <TableCell>
                              {formatDateTime(bt.end_date)}
                            </TableCell>
                            <TableCell align="right">
                              {initial.toFixed(2)}
                            </TableCell>
                            <TableCell align="right">
                              {finalVal.toFixed(2)}
                            </TableCell>
                            <TableCell align="right">
                              {pnl.toFixed(2)}
                            </TableCell>
                            <TableCell>{bt.status}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <Box sx={{ mt: 2 }}>
                    {renderPortfolioSummary()}
                    {renderPerSymbolTable()}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>
      </Grid>
    </Box>
  );
};
