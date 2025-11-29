import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
  Snackbar
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import {
  DataGrid,
  type GridColDef,
  type GridRenderCellParams
} from "@mui/x-data-grid";
import { useEffect, useMemo, useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";

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

type PortfolioRow = {
  id: number;
  code: string;
  name: string;
  universeLabel: string;
  strategyNames: string[];
  lastPnlPct: number | null;
  sharpe: number | null;
  status: "active" | "archived";
};

const API_BASE = "http://127.0.0.1:8000";

const formatUniverseLabel = (
  scope: string | null,
  groups: StockGroup[]
): string => {
  if (!scope) return "";
  if (scope.startsWith("group:")) {
    const id = Number(scope.split(":")[1] ?? "");
    const group = groups.find((g) => g.id === id);
    if (group) {
      return `${group.code} – ${group.name}`;
    }
  }
  return scope;
};

export const PortfolioListPage = () => {
  const navigate = useNavigate();

  const [portfolios, setPortfolios] = useState<PortfolioDto[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [loadState, setLoadState] = useState<FetchState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [universeFilter, setUniverseFilter] = useState<string>("all");
  const [strategyFilter, setStrategyFilter] = useState<number | "all">("all");
  const [riskFilter, setRiskFilter] = useState<
    "all" | "conservative" | "balanced" | "aggressive"
  >("all");
  const [showArchived, setShowArchived] = useState(false);

  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runTargetId, setRunTargetId] = useState<number | null>(null);
  const [runDateMode, setRunDateMode] = useState<"relative" | "custom">(
    "relative"
  );
  const [runDuration, setRunDuration] = useState<
    "1d" | "5d" | "1m" | "3m" | "6m" | "1y" | "2y" | "3y"
  >("1y");
  const [runStartDate, setRunStartDate] = useState("");
  const [runEndDate, setRunEndDate] = useState("");
  const [runInterval, setRunInterval] = useState("1d");
  const [runInitialCapital, setRunInitialCapital] = useState("100000");
  const [runStartTime, setRunStartTime] = useState("09:15");
  const [runEndTime, setRunEndTime] = useState("15:30");
  const [runBenchmark, setRunBenchmark] = useState("none");
  const [runCostModel, setRunCostModel] = useState("zerodha_default");
  const [runDataSourceMode, setRunDataSourceMode] = useState("auto");
  const [runState, setRunState] = useState<FetchState>("idle");
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);
  const [snackbarSeverity, setSnackbarSeverity] = useState<
    "success" | "error" | "info"
  >("info");

  useEffect(() => {
    const loadAll = async () => {
      setLoadState("loading");
      setLoadError(null);
      try {
        const [pfRes, stratRes, grpRes] = await Promise.all([
          fetch(`${API_BASE}/api/portfolios`),
          fetch(`${API_BASE}/api/strategies`),
          fetch(`${API_BASE}/api/stock-groups`)
        ]);

        if (!pfRes.ok) {
          throw new Error("Failed to load portfolios.");
        }
        const pfData: PortfolioDto[] = await pfRes.json();
        setPortfolios(pfData);

        if (stratRes.ok) {
          const sData: Strategy[] = await stratRes.json();
          setStrategies(sData);
        }
        if (grpRes.ok) {
          const gData: StockGroup[] = await grpRes.json();
          setGroups(gData);
        }
        setLoadState("success");
      } catch (error) {
        setLoadState("error");
        setLoadError(
          error instanceof Error
            ? error.message
            : "Unexpected error loading portfolios."
        );
      }
    };

    void loadAll();
  }, []);

  const strategyNameById = useMemo(() => {
    const map: Record<number, string> = {};
    strategies.forEach((s) => {
      map[s.id] = s.name;
    });
    return map;
  }, [strategies]);

  const rows: PortfolioRow[] = useMemo(() => {
    return portfolios.map((p) => {
      const allowedIds = (p.allowed_strategies ?? []).filter(
        (v): v is number => typeof v === "number"
      );
      const strategyNames = allowedIds
        .map((id) => strategyNameById[id])
        .filter((name) => Boolean(name));

      const status: "active" | "archived" = "active";

      return {
        id: p.id,
        code: p.code,
        name: p.name,
        universeLabel: formatUniverseLabel(p.universe_scope, groups),
        strategyNames,
        lastPnlPct: null,
        sharpe: null,
        status
      };
    });
  }, [portfolios, groups, strategyNameById]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      if (!showArchived && row.status === "archived") {
        return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !row.code.toLowerCase().includes(q) &&
          !row.name.toLowerCase().includes(q)
        ) {
          return false;
        }
      }

      if (universeFilter !== "all" && universeFilter) {
        if (row.universeLabel.indexOf(universeFilter) === -1) {
          return false;
        }
      }

      if (strategyFilter !== "all") {
        const id = strategyFilter;
        if (
          typeof id === "number" &&
          !rows
            .find((r) => r.id === row.id)
            ?.strategyNames.some(
              (name) => name === strategyNameById[id] && Boolean(name)
            )
        ) {
          return false;
        }
      }

      if (riskFilter !== "all") {
        const pf = portfolios.find((p) => p.id === row.id);
        const maxPos =
          ((pf?.risk_profile ?? {}) as { maxPositionSizePct?: number })
            .maxPositionSizePct ?? 0;
        if (riskFilter === "conservative" && !(maxPos > 0 && maxPos <= 10)) {
          return false;
        }
        if (
          riskFilter === "balanced" &&
          !(maxPos > 10 && maxPos <= 25)
        ) {
          return false;
        }
        if (riskFilter === "aggressive" && !(maxPos > 25)) {
          return false;
        }
      }

      return true;
    });
  }, [
    rows,
    search,
    universeFilter,
    strategyFilter,
    strategyNameById,
    riskFilter,
    showArchived,
    portfolios
  ]);

  const handleRowClick = (id: number) => {
    navigate(`/portfolios/${id}`);
  };

  const handleOpenRunDialog = (id: number) => {
    setRunTargetId(id);
    setRunDateMode("relative");
    setRunDuration("1y");
    setRunStartDate("");
    setRunEndDate("");
    setRunInterval("1d");
    setRunInitialCapital("100000");
    setRunStartTime("09:15");
    setRunEndTime("15:30");
    setRunBenchmark("none");
    setRunCostModel("zerodha_default");
    setRunDataSourceMode("auto");
    setRunState("idle");
    setRunDialogOpen(true);
  };

  const handleCloseRunDialog = () => {
    setRunDialogOpen(false);
  };

  const handleSubmitRunDialog = async (event: FormEvent) => {
    event.preventDefault();
    if (!runTargetId) return;

    setRunState("loading");

    // Derive effective start/end dates based on date mode and duration.
    let effectiveStart = runStartDate;
    let effectiveEnd = runEndDate;

    if (runDateMode === "relative") {
      const end = new Date();
      const start = new Date(end);
      switch (runDuration) {
        case "1d":
          start.setDate(end.getDate() - 1);
          break;
        case "5d":
          start.setDate(end.getDate() - 5);
          break;
        case "1m":
          start.setMonth(end.getMonth() - 1);
          break;
        case "3m":
          start.setMonth(end.getMonth() - 3);
          break;
        case "6m":
          start.setMonth(end.getMonth() - 6);
          break;
        case "1y":
          start.setFullYear(end.getFullYear() - 1);
          break;
        case "2y":
          start.setFullYear(end.getFullYear() - 2);
          break;
        case "3y":
          start.setFullYear(end.getFullYear() - 3);
          break;
        default:
          break;
      }
      effectiveStart = start.toISOString().slice(0, 10);
      effectiveEnd = end.toISOString().slice(0, 10);
    } else {
      if (!runStartDate || !runEndDate) {
        setRunState("error");
        setSnackbarSeverity("error");
        setSnackbarMessage("Start and end dates are required.");
        return;
      }
      effectiveStart = runStartDate;
      effectiveEnd = runEndDate;
    }

    const isIntraday = runInterval !== "1d";
    const startIso = `${effectiveStart}T${
      isIntraday ? runStartTime || "09:15" : "00:00:00"
    }`;
    const endIso = `${effectiveEnd}T${
      isIntraday ? runEndTime || "15:30" : "23:59:59"
    }`;

    const params = new URLSearchParams({
      timeframe: runInterval,
      start: startIso,
      end: endIso,
      initial_capital: String(Number(runInitialCapital) || 100000),
      benchmark: runBenchmark === "none" ? "" : runBenchmark,
      cost_model: runCostModel,
      data_source_mode: runDataSourceMode
    });

    try {
      const res = await fetch(
        `${API_BASE}/api/portfolios/${runTargetId}/backtests?${params.toString()}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setRunState("error");
        setSnackbarSeverity("error");
        setSnackbarMessage(
          (err as { detail?: string }).detail ??
            "Failed to run portfolio backtest."
        );
        return;
      }
      const created: PortfolioBacktest = await res.json();
      setRunState("success");
      setSnackbarSeverity("success");
      setSnackbarMessage(
        `Portfolio backtest #${created.id} completed (status: ${created.status}).`
      );
      setRunDialogOpen(false);
    } catch (error) {
      setRunState("error");
      setSnackbarSeverity("error");
      setSnackbarMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const columns: GridColDef<PortfolioRow>[] = [
    {
      field: "code",
      headerName: "Code",
      flex: 1,
      minWidth: 120
    },
    {
      field: "name",
      headerName: "Name",
      flex: 1.5,
      minWidth: 160
    },
    {
      field: "universeLabel",
      headerName: "Universe",
      flex: 1.5,
      minWidth: 180
    },
    {
      field: "strategyNames",
      headerName: "Strategies",
      flex: 2,
      minWidth: 200,
      sortable: false,
      renderCell: (params: GridRenderCellParams<PortfolioRow, string[]>) => {
        const value = params.value ?? [];
        if (!value.length) {
          return <Typography variant="caption">None</Typography>;
        }
        return (
          <Stack direction="row" spacing={0.5} flexWrap="wrap">
            {value.map((name) => (
              <Chip key={name} label={name} size="small" />
            ))}
          </Stack>
        );
      }
    },
    {
      field: "lastPnlPct",
      headerName: "Last PnL %",
      flex: 0.8,
      minWidth: 120,
      type: "number",
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<PortfolioRow, number | null>) => {
        const value = params.value;
        if (value == null) {
          return <Typography variant="body2">–</Typography>;
        }
        const color =
          value > 0 ? "success.main" : value < 0 ? "error.main" : "text.secondary";
        return (
          <Typography variant="body2" sx={{ color }}>
            {value.toFixed(2)}%
          </Typography>
        );
      }
    },
    {
      field: "sharpe",
      headerName: "Sharpe",
      flex: 0.7,
      minWidth: 100,
      type: "number",
      align: "right",
      headerAlign: "right",
      renderCell: (params: GridRenderCellParams<PortfolioRow, number | null>) => {
        const value = params.value;
        if (value == null) {
          return <Typography variant="body2">–</Typography>;
        }
        return <Typography variant="body2">{value.toFixed(2)}</Typography>;
      }
    },
    {
      field: "status",
      headerName: "Status",
      flex: 0.7,
      minWidth: 100,
      renderCell: (params: GridRenderCellParams<PortfolioRow, string>) => {
        const label = params.value === "archived" ? "Archived" : "Active";
        const color =
          params.value === "archived" ? "default" : ("success" as const);
        return <Chip label={label} size="small" color={color} />;
      }
    },
    {
      field: "actions",
      headerName: "Actions",
      sortable: false,
      filterable: false,
      flex: 1,
      minWidth: 180,
      renderCell: (params: GridRenderCellParams<PortfolioRow>) => {
        return (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={(e) => {
                e.stopPropagation();
                handleRowClick(params.row.id);
              }}
            >
              View
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenRunDialog(params.row.id);
              }}
            >
              Run BT
            </Button>
          </Stack>
        );
      }
    }
  ];

  const totalPortfolios = portfolios.length;
  const totalActive = rows.filter((r) => r.status === "active").length;
  const totalArchived = rows.filter((r) => r.status === "archived").length;

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
            Portfolios
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Define portfolios, run portfolio backtests, and analyse performance.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            onClick={() => navigate("/portfolios/compare")}
          >
            Compare portfolios
          </Button>
          <Button
            variant="contained"
            onClick={() => navigate("/portfolios/new")}
          >
            New portfolio
          </Button>
        </Stack>
      </Box>

      {/* KPI chips */}
      <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: "wrap" }}>
        <Chip label={`Total portfolios: ${totalPortfolios}`} />
        <Chip label={`Active: ${totalActive}`} />
        <Chip label={`Archived: ${totalArchived}`} />
        <Chip label="YTD PnL: –" />
      </Stack>

      {/* Filters bar */}
      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} md={3}>
            <TextField
              label="Search by code or name"
              size="small"
              fullWidth
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="Universe"
              size="small"
              select
              fullWidth
              value={universeFilter}
              onChange={(e) => setUniverseFilter(e.target.value)}
            >
              <MenuItem value="all">All</MenuItem>
              {groups.map((g) => (
                <MenuItem key={g.id} value={g.code}>
                  {g.code}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="Strategy"
              size="small"
              select
              fullWidth
              value={strategyFilter}
              onChange={(e) =>
                setStrategyFilter(
                  e.target.value === "all"
                    ? "all"
                    : Number(e.target.value) || "all"
                )
              }
            >
              <MenuItem value="all">All strategies</MenuItem>
              {strategies.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={2}>
            <TextField
              label="Risk profile"
              size="small"
              select
              fullWidth
              value={riskFilter}
              onChange={(e) =>
                setRiskFilter(
                  e.target.value as
                    | "all"
                    | "conservative"
                    | "balanced"
                    | "aggressive"
                )
              }
            >
              <MenuItem value="all">All profiles</MenuItem>
              <MenuItem value="conservative">Conservative</MenuItem>
              <MenuItem value="balanced">Balanced</MenuItem>
              <MenuItem value="aggressive">Aggressive</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <FormControlLabel
              control={
                <Switch
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
              }
              label="Show archived"
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Portfolio DataGrid */}
      <Paper elevation={1} sx={{ p: 1 }}>
        <div style={{ width: "100%", height: 520 }}>
          <DataGrid
            rows={filteredRows}
            columns={columns}
            density="compact"
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10, page: 0 } },
              sorting: {
                sortModel: [{ field: "code", sort: "asc" }]
              }
            }}
            loading={loadState === "loading"}
            onRowClick={(params) => handleRowClick(params.id as number)}
            getRowId={(row) => row.id}
          />
        </div>
        {loadError && (
          <Typography
            variant="caption"
            color="error"
            sx={{ mt: 1, display: "block" }}
          >
            {loadError}
          </Typography>
        )}
      </Paper>

      {/* Run Backtest dialog */}
      <Dialog
        open={runDialogOpen}
        onClose={handleCloseRunDialog}
        maxWidth="sm"
        fullWidth
      >
        <form onSubmit={handleSubmitRunDialog}>
          <DialogTitle>Run portfolio backtest</DialogTitle>
          <DialogContent
            sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
          >
            <Stack spacing={1.5}>
              <TextField
                label="Interval"
                size="small"
                select
                value={runInterval}
                onChange={(e) => setRunInterval(e.target.value)}
              >
                <MenuItem value="1d">1 day</MenuItem>
                <MenuItem value="1h">1 hour</MenuItem>
                <MenuItem value="30m">30 minutes</MenuItem>
              </TextField>
              <TextField
                label="Date mode"
                size="small"
                select
                value={runDateMode}
                onChange={(e) =>
                  setRunDateMode(e.target.value as "relative" | "custom")
                }
              >
                <MenuItem value="relative">Duration (relative)</MenuItem>
                <MenuItem value="custom">Custom range</MenuItem>
              </TextField>
              {runDateMode === "relative" ? (
                <TextField
                  label="Duration"
                  size="small"
                  select
                  value={runDuration}
                  onChange={(e) =>
                    setRunDuration(
                      e.target
                        .value as
                        | "1d"
                        | "5d"
                        | "1m"
                        | "3m"
                        | "6m"
                        | "1y"
                        | "2y"
                        | "3y"
                    )
                  }
                  helperText="Run backtest for a recent window."
                >
                  <MenuItem value="1d">Last 1 day</MenuItem>
                  <MenuItem value="5d">Last 5 days</MenuItem>
                  <MenuItem value="1m">Last 1 month</MenuItem>
                  <MenuItem value="3m">Last 3 months</MenuItem>
                  <MenuItem value="6m">Last 6 months</MenuItem>
                  <MenuItem value="1y">Last 1 year</MenuItem>
                  <MenuItem value="2y">Last 2 years</MenuItem>
                  <MenuItem value="3y">Last 3 years</MenuItem>
                </TextField>
              ) : (
                <Stack direction="row" spacing={1.5}>
                  <TextField
                    label="Start date"
                    type="date"
                    size="small"
                    value={runStartDate}
                    onChange={(e) => setRunStartDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                  <TextField
                    label="End date"
                    type="date"
                    size="small"
                    value={runEndDate}
                    onChange={(e) => setRunEndDate(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                    fullWidth
                  />
                </Stack>
              )}
              <Stack direction="row" spacing={1.5}>
                <TextField
                  label="Start time"
                  type="time"
                  size="small"
                  value={runStartTime}
                  onChange={(e) => setRunStartTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  disabled={runInterval === "1d"}
                  fullWidth
                />
                <TextField
                  label="End time"
                  type="time"
                  size="small"
                  value={runEndTime}
                  onChange={(e) => setRunEndTime(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  disabled={runInterval === "1d"}
                  fullWidth
                />
              </Stack>
              <TextField
                label="Initial capital"
                size="small"
                value={runInitialCapital}
                onChange={(e) => setRunInitialCapital(e.target.value)}
              />
            </Stack>

            <Accordion sx={{ mt: 1 }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle2">
                  Advanced settings
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Stack spacing={1.5}>
                  <TextField
                    label="Benchmark"
                    size="small"
                    select
                    value={runBenchmark}
                    onChange={(e) => setRunBenchmark(e.target.value)}
                    helperText="Optional benchmark for comparison; backend integration is planned."
                  >
                    <MenuItem value="none">(None)</MenuItem>
                    <MenuItem value="NIFTY50">NIFTY 50</MenuItem>
                    <MenuItem value="NIFTYNEXT50">NIFTY Next 50</MenuItem>
                    <MenuItem value="NIFTYMIDCAP100">NIFTY Midcap 100</MenuItem>
                  </TextField>
                  <TextField
                    label="Cost model"
                    size="small"
                    select
                    value={runCostModel}
                    onChange={(e) => setRunCostModel(e.target.value)}
                  >
                    <MenuItem value="zerodha_default">
                      Zerodha default (equity cash)
                    </MenuItem>
                    <MenuItem value="no_costs">No costs</MenuItem>
                  </TextField>
                  <TextField
                    label="Data source mode"
                    size="small"
                    select
                    value={runDataSourceMode}
                    onChange={(e) => setRunDataSourceMode(e.target.value)}
                    helperText="Aligns with single-stock backtest data source behaviour."
                  >
                    <MenuItem value="auto">Auto (local cache + broker)</MenuItem>
                    <MenuItem value="cache_only">Local cache only</MenuItem>
                    <MenuItem value="broker_only">Broker only</MenuItem>
                  </TextField>
                </Stack>
              </AccordionDetails>
            </Accordion>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseRunDialog}>Cancel</Button>
            <Button type="submit" disabled={runState === "loading"}>
              Run backtest
            </Button>
          </DialogActions>
        </form>
      </Dialog>

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
