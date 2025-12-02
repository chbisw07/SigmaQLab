import {
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
import { DataGrid, type GridColDef, type GridSelectionModel } from "@mui/x-data-grid";
import { useMemo, useState } from "react";
import type { FetchState } from "../../pages/StocksPage";
import type {
  ScreenerFilter,
  ScreenerResult,
  ScreenerRunRequest
} from "../../types/screener";

type FactorScreenerTabProps = {
  apiBase: string;
  onGroupCreated: (groupCode: string) => void;
};

type FilterRow = ScreenerFilter & { id: number };

const factorFieldOptions = [
  { label: "PE", value: "PE" },
  { label: "PB", value: "PB" },
  { label: "ROE", value: "ROE" },
  { label: "ROCE", value: "ROCE" },
  { label: "Debt-to-Equity", value: "debt_to_equity" },
  { label: "Sales Growth YoY", value: "sales_growth_yoy" },
  { label: "Profit Growth YoY", value: "profit_growth_yoy" },
  { label: "EPS Growth 3Y", value: "eps_growth_3y" },
  { label: "Value", value: "Value" },
  { label: "Quality", value: "Quality" },
  { label: "Momentum", value: "Momentum" },
  { label: "Low-Vol", value: "Low-Vol" },
  { label: "Size", value: "Size" },
  { label: "Composite", value: "Composite" }
];

const rankingFieldOptions = [
  { label: "Composite score", value: "Composite" },
  { label: "Value", value: "Value" },
  { label: "Quality", value: "Quality" },
  { label: "Momentum", value: "Momentum" },
  { label: "Low-Vol", value: "Low-Vol" },
  { label: "Size", value: "Size" },
  { label: "ROE", value: "ROE" },
  { label: "Market cap", value: "market_cap" }
];

export const FactorScreenerTab = ({ apiBase, onGroupCreated }: FactorScreenerTabProps) => {
  const [asOfDate, setAsOfDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [filters, setFilters] = useState<FilterRow[]>([
    { id: 1, field: "PE", op: "<", value: 20 }
  ]);
  const [nextFilterId, setNextFilterId] = useState(2);

  const [rankingField, setRankingField] = useState<string>("Composite");
  const [rankingOrder, setRankingOrder] = useState<"asc" | "desc">("desc");
  const [rankingLimit, setRankingLimit] = useState<number>(30);

  const [results, setResults] = useState<ScreenerResult[]>([]);
  const [resultsState, setResultsState] = useState<FetchState>("idle");
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);

  const [groupName, setGroupName] = useState<string>("ScreenerGroup");
  const [groupDescription, setGroupDescription] = useState<string>("");
  const [groupState, setGroupState] = useState<FetchState>("idle");
  const [groupMessage, setGroupMessage] = useState<string | null>(null);

  const handleAddFilter = () => {
    setFilters((prev) => [
      ...prev,
      { id: nextFilterId, field: "PE", op: "<", value: 20 }
    ]);
    setNextFilterId((id) => id + 1);
  };

  const handleUpdateFilter = (id: number, patch: Partial<ScreenerFilter>) => {
    setFilters((prev) =>
      prev.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const handleRemoveFilter = (id: number) => {
    setFilters((prev) => prev.filter((row) => row.id !== id));
  };

  const handleRunScreener = async () => {
    setResultsState("loading");
    setResultsError(null);
    setResults([]);
    setSelectedSymbols([]);

    const validFilters = filters.filter(
      (f) => f.field && !Number.isNaN(f.value) && f.value !== null
    );

    const payload: ScreenerRunRequest = {
      universe: "NSE_ALL",
      as_of_date: asOfDate,
      filters: validFilters.map(({ field, op, value }) => ({
        field,
        op,
        value
      })),
      ranking: {
        primary: { field: rankingField, order: rankingOrder },
        secondary: null,
        limit: rankingLimit
      }
    };

    try {
      const res = await fetch(`${apiBase}/api/v1/screener/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setResultsState("error");
        setResultsError(
          (err as { detail?: string }).detail ?? "Failed to run screener."
        );
        return;
      }
      const data: ScreenerResult[] = await res.json();
      setResults(data);
      setResultsState("success");
    } catch (error) {
      setResultsState("error");
      setResultsError(
        error instanceof Error ? error.message : "Unexpected error running screener."
      );
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setGroupState("error");
      setGroupMessage("Group name is required.");
      return;
    }
    const symbolsToUse =
      selectedSymbols.length > 0 ? selectedSymbols : results.map((r) => r.symbol);
    if (symbolsToUse.length === 0) {
      setGroupState("error");
      setGroupMessage("No symbols to save. Run screener and select results first.");
      return;
    }

    setGroupState("loading");
    setGroupMessage(null);

    try {
      const res = await fetch(`${apiBase}/api/v1/groups/create_from_screener`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim() || null,
          symbols: symbolsToUse
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGroupState("error");
        setGroupMessage(
          (err as { detail?: string }).detail ?? "Failed to create group."
        );
        return;
      }
      const body = (await res.json()) as { group_id: number };

      // Fetch groups to discover the newly created group's code.
      const groupsRes = await fetch(`${apiBase}/api/stock-groups`);
      if (!groupsRes.ok) {
        setGroupState("error");
        setGroupMessage("Group created, but failed to refresh groups.");
        return;
      }
      const groups = (await groupsRes.json()) as Array<{
        id: number;
        code: string;
      }>;
      const created = groups.find((g) => g.id === body.group_id);
      if (!created) {
        setGroupState("error");
        setGroupMessage("Group created, but unable to locate it in groups list.");
        return;
      }

      setGroupState("success");
      setGroupMessage("Group created from screener results.");
      onGroupCreated(created.code);
    } catch (error) {
      setGroupState("error");
      setGroupMessage(
        error instanceof Error ? error.message : "Unexpected error creating group."
      );
    }
  };

  const rowsWithId = useMemo(
    () =>
      results.map((row) => ({
        id: row.symbol,
        ...row
      })),
    [results]
  );

  const columns: GridColDef[] = useMemo(
    () => [
      { field: "symbol", headerName: "Symbol", width: 120 },
      { field: "sector", headerName: "Sector", width: 140 },
      {
        field: "market_cap",
        headerName: "Mkt cap (cr)",
        width: 130,
        type: "number",
        renderCell: (params) => {
          const v = params.value as number | null | undefined;
          return (
            <span>{v != null ? Number(v).toFixed(0) : ""}</span>
          );
        }
      },
      {
        field: "value",
        headerName: "Value",
        width: 110,
        type: "number",
        renderCell: (params) => {
          const v = params.value as number | null | undefined;
          return (
            <span>{v != null ? Number(v).toFixed(2) : ""}</span>
          );
        }
      },
      {
        field: "quality",
        headerName: "Quality",
        width: 110,
        type: "number",
        renderCell: (params) => {
          const v = params.value as number | null | undefined;
          return (
            <span>{v != null ? Number(v).toFixed(2) : ""}</span>
          );
        }
      },
      {
        field: "momentum",
        headerName: "Momentum",
        width: 110,
        type: "number",
        renderCell: (params) => {
          const v = params.value as number | null | undefined;
          return (
            <span>{v != null ? Number(v).toFixed(2) : ""}</span>
          );
        }
      },
      {
        field: "low_vol",
        headerName: "Low-Vol",
        width: 110,
        type: "number",
        renderCell: (params) => {
          const v = params.value as number | null | undefined;
          return (
            <span>{v != null ? Number(v).toFixed(2) : ""}</span>
          );
        }
      },
      {
        field: "size",
        headerName: "Size",
        width: 110,
        type: "number",
        renderCell: (params) => {
          const v = params.value as number | null | undefined;
          return (
            <span>{v != null ? Number(v).toFixed(2) : ""}</span>
          );
        }
      }
    ],
    []
  );

  return (
    <Box>
      <Stack spacing={2} mb={2}>
        <Box>
          <Typography variant="h5">Factor Screener</Typography>
          <Typography variant="body2" color="text.secondary">
            Apply factor and fundamental filters to the active universe and rank
            candidates for portfolio construction.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Factors are cross-sectional z-scores for each as-of date:
            Value (cheaper valuation is higher), Quality (stronger profitability
            and balance sheet is higher), Momentum (stronger recent returns is
            higher), Low-Vol (more defensive, lower volatility is higher),
            Size (larger market cap is higher). Composite is a weighted blend
            of these; in all cases, higher scores are better within the same
            date.
          </Typography>
        </Box>
        <Paper sx={{ p: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid item xs={12} sm={4} md={3}>
              <TextField
                label="Universe"
                size="small"
                fullWidth
                value="NSE_ALL"
                disabled
                helperText="Universe selection will be extended in later sprints."
              />
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField
                label="As of date"
                type="date"
                size="small"
                fullWidth
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid item xs={12} sm={4} md={3}>
              <TextField
                select
                label="Rank by"
                size="small"
                fullWidth
                value={rankingField}
                onChange={(e) => setRankingField(e.target.value)}
              >
                {rankingFieldOptions.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid item xs={6} sm={3} md={2}>
              <TextField
                select
                label="Order"
                size="small"
                fullWidth
                value={rankingOrder}
                onChange={(e) => setRankingOrder(e.target.value as "asc" | "desc")}
              >
                <MenuItem value="desc">Desc</MenuItem>
                <MenuItem value="asc">Asc</MenuItem>
              </TextField>
            </Grid>
            <Grid item xs={6} sm={3} md={1}>
              <TextField
                label="Top N"
                type="number"
                size="small"
                fullWidth
                value={rankingLimit}
                onChange={(e) =>
                  setRankingLimit(
                    Number.isNaN(Number.parseInt(e.target.value, 10))
                      ? 0
                      : Number.parseInt(e.target.value, 10)
                  )
                }
              />
            </Grid>
          </Grid>
        </Paper>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Stack spacing={1.5}>
                <Typography variant="h6">Filters</Typography>
                <Typography variant="body2" color="text.secondary">
                  All filters are combined with AND for now. You can mix
                  fundamentals (PE, ROE…) with factors (Value, Momentum, etc).
                </Typography>
                {filters.map((row) => (
                  <Stack
                    key={row.id}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                  >
                    <TextField
                      select
                      size="small"
                      label="Field"
                      value={row.field}
                      onChange={(e) =>
                        handleUpdateFilter(row.id, { field: e.target.value })
                      }
                      sx={{ minWidth: 160 }}
                    >
                      {factorFieldOptions.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      size="small"
                      label="Op"
                      value={row.op}
                      onChange={(e) =>
                        handleUpdateFilter(row.id, {
                          op: e.target.value as FilterRow["op"]
                        })
                      }
                      sx={{ width: 80 }}
                    >
                      <MenuItem value="<">&lt;</MenuItem>
                      <MenuItem value="<=">&le;</MenuItem>
                      <MenuItem value=">">&gt;</MenuItem>
                      <MenuItem value=">=">&ge;</MenuItem>
                      <MenuItem value="=">=</MenuItem>
                    </TextField>
                    <TextField
                      size="small"
                      label="Value"
                      type="number"
                      value={row.value}
                      onChange={(e) =>
                        handleUpdateFilter(row.id, {
                          value: Number.parseFloat(e.target.value)
                        })
                      }
                      sx={{ width: 120 }}
                    />
                    <Button
                      size="small"
                      color="error"
                      onClick={() => handleRemoveFilter(row.id)}
                    >
                      Remove
                    </Button>
                  </Stack>
                ))}
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleAddFilter}
                  >
                    Add filter
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setFilters([])}
                  >
                    Clear all
                  </Button>
                </Stack>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => void handleRunScreener()}
                    disabled={resultsState === "loading"}
                  >
                    Run screener
                  </Button>
                  {resultsState === "loading" && (
                    <Typography variant="body2" color="text.secondary">
                      Running…
                    </Typography>
                  )}
                  {resultsError && (
                    <Typography variant="body2" color="error">
                      {resultsError}
                    </Typography>
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={7}>
          <Card>
            <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box>
                  <Typography variant="h6">Results</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Select rows and save them as a stock group for use in
                    portfolios and backtests.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    label="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    sx={{ minWidth: 180 }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void handleCreateGroup()}
                    disabled={groupState === "loading" || results.length === 0}
                  >
                    Save as group
                  </Button>
                </Stack>
              </Stack>
              <TextField
                size="small"
                label="Group description"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                multiline
                minRows={1}
              />
              {groupMessage && (
                <Typography
                  variant="body2"
                  color={groupState === "error" ? "error" : "text.secondary"}
                >
                  {groupMessage}
                </Typography>
              )}
              <Box sx={{ height: 360, width: "100%" }}>
                {results.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                    No results yet. Configure filters and run the screener.
                  </Typography>
                ) : (
                  <DataGrid
                    rows={rowsWithId}
                    columns={columns}
                    density="compact"
                    checkboxSelection
                    disableRowSelectionOnClick
                    pageSizeOptions={[10, 25, 50]}
                    onRowSelectionModelChange={(selection: GridSelectionModel) =>
                      setSelectedSymbols(selection as string[])
                    }
                  />
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
