import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  Tab,
  Tabs,
  TextField,
  Typography
} from "@mui/material";
import { DataGrid, type GridColDef, type GridSelectionModel } from "@mui/x-data-grid";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { GroupsTab } from "../features/groups/GroupsTab";
import { type Stock, type StockGroupSummary } from "../types/stocks";

export type FetchState = "idle" | "loading" | "success" | "error";

type TabId = "universe" | "groups" | "imports";

const API_BASE = "http://127.0.0.1:8000";

export const StocksPage = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [tab, setTab] = useState<TabId>("universe");
  const [deepLinkGroupCode, setDeepLinkGroupCode] = useState<string | null>(null);
  const [lastImportedGroupCode, setLastImportedGroupCode] = useState<string | null>(
    null
  );

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [stocksState, setStocksState] = useState<FetchState>("idle");
  const [stocksError, setStocksError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [exchangeFilter, setExchangeFilter] = useState<string>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [analystRatingFilter, setAnalystRatingFilter] = useState<string>("all");
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);

  const [stockFormSymbol, setStockFormSymbol] = useState("");
  const [stockFormExchange, setStockFormExchange] = useState("NSE");
  const [stockFormSegment, setStockFormSegment] = useState("");
  const [stockFormName, setStockFormName] = useState("");
  const [stockFormMarketCap, setStockFormMarketCap] = useState("");
  const [stockFormSector, setStockFormSector] = useState("");
  const [stockFormTags, setStockFormTags] = useState("");
  const [stockFormActive, setStockFormActive] = useState(true);
  const [stockFormState, setStockFormState] = useState<FetchState>("idle");
  const [stockFormMessage, setStockFormMessage] = useState<string | null>(null);

  const [groups, setGroups] = useState<StockGroupSummary[]>([]);
  const [groupsState, setGroupsState] = useState<FetchState>("idle");
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [activeGroupCode, setActiveGroupCode] = useState<string | null>(null);

  const loadUniverse = async () => {
    setStocksState("loading");
    setStocksError(null);
    try {
      const res = await fetch(`${API_BASE}/api/stocks?active_only=false`);
      if (!res.ok) {
        setStocksState("error");
        setStocksError("Failed to load stocks universe.");
        return;
      }
      const data: Stock[] = await res.json();
      setStocks(data);
      setStocksState("success");
    } catch (error) {
      setStocksState("error");
      setStocksError(
        error instanceof Error ? error.message : "Unexpected error loading stocks."
      );
    }
  };

  const loadGroups = async () => {
    setGroupsState("loading");
    setGroupsError(null);
    try {
      const res = await fetch(`${API_BASE}/api/stock-groups`);
      if (!res.ok) {
        setGroupsState("error");
        setGroupsError("Failed to load stock groups.");
        return;
      }
      const data: StockGroup[] = await res.json();
      setGroups(data);
      setGroupsState("success");
    } catch (error) {
      setGroupsState("error");
      setGroupsError(
        error instanceof Error ? error.message : "Unexpected error loading groups."
      );
    }
  };

  useEffect(() => {
    void loadUniverse();
    void loadGroups();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get("tab") as TabId | null;
    const groupParam = params.get("group");

    if (tabParam === "universe" || tabParam === "groups" || tabParam === "imports") {
      setTab(tabParam);
    } else {
      setTab("universe");
    }
    setDeepLinkGroupCode(groupParam);
  }, [location.search]);

  useEffect(() => {
    if (tab !== "groups") {
      return;
    }
    if (deepLinkGroupCode) {
      const match = groups.find(
        (g) => g.code.toUpperCase() === deepLinkGroupCode.toUpperCase()
      );
      if (match) {
        setActiveGroupCode(match.code);
        return;
      }
    }
    if (!activeGroupCode && groups.length > 0) {
      setActiveGroupCode(groups[0].code);
    }
  }, [tab, deepLinkGroupCode, groups, activeGroupCode]);

  const handleTabChange = (_: unknown, value: TabId) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", value);
    if (value !== "groups") {
      params.delete("group");
    } else if (activeGroupCode) {
      params.set("group", activeGroupCode);
    } else if (deepLinkGroupCode) {
      params.set("group", deepLinkGroupCode);
    }
    navigate(`/stocks?${params.toString()}`);
    setTab(value);
  };

  const handleViewImportedGroup = () => {
    if (!lastImportedGroupCode) return;
    const code = lastImportedGroupCode;
    const params = new URLSearchParams(location.search);
    params.set("tab", "groups");
    params.set("group", code);
    setTab("groups");
    setDeepLinkGroupCode(code);
    setActiveGroupCode(code);
    navigate(`/stocks?${params.toString()}`);
  };

  const handleGroupSelectionChange = (code: string | null) => {
    setActiveGroupCode(code);
    const params = new URLSearchParams(location.search);
    params.set("tab", "groups");
    if (code) {
      params.set("group", code);
    } else {
      params.delete("group");
    }
    navigate(`/stocks?${params.toString()}`);
  };

  const resetStockForm = () => {
    setSelectedStockId(null);
    setStockFormSymbol("");
    setStockFormExchange("NSE");
    setStockFormSegment("");
    setStockFormName("");
    setStockFormMarketCap("");
    setStockFormSector("");
    setStockFormTags("");
    setStockFormActive(true);
    setStockFormState("idle");
    setStockFormMessage(null);
  };

  const handleSelectStock = (stock: Stock) => {
    setSelectedStockId(stock.id);
    setStockFormSymbol(stock.symbol);
    setStockFormExchange(stock.exchange);
    setStockFormSegment(stock.segment ?? "");
    setStockFormName(stock.name ?? "");
    setStockFormMarketCap(
      stock.market_cap_crore != null ? String(stock.market_cap_crore) : ""
    );
    setStockFormSector(stock.sector ?? "");
    setStockFormTags((stock.tags ?? []).join(", "));
    setStockFormActive(stock.is_active);
    setStockFormState("idle");
    setStockFormMessage(null);
  };

  const handleSubmitStockForm = async (event: FormEvent) => {
    event.preventDefault();
    setStockFormState("loading");
    setStockFormMessage(null);

    const marketCapClean = stockFormMarketCap.trim();
    const marketCapValue =
      marketCapClean.length === 0
        ? null
        : Number.isNaN(Number.parseFloat(marketCapClean))
          ? null
          : Number.parseFloat(marketCapClean);

    const payload = {
      symbol: stockFormSymbol.trim().toUpperCase(),
      exchange: stockFormExchange.trim().toUpperCase() || "NSE",
      segment: stockFormSegment.trim() || null,
      name: stockFormName.trim() || null,
      market_cap_crore: marketCapValue,
      sector: stockFormSector.trim() || null,
      tags:
        stockFormTags.trim().length === 0
          ? null
          : stockFormTags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0),
      is_active: stockFormActive
    };

    if (!payload.symbol) {
      setStockFormState("error");
      setStockFormMessage("Symbol is required.");
      return;
    }

    try {
      if (selectedStockId == null) {
        const res = await fetch(`${API_BASE}/api/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setStockFormState("error");
          setStockFormMessage(
            (err as { detail?: string }).detail ?? "Failed to create stock."
          );
          return;
        }
        const created: Stock = await res.json();
        setStocks((prev) => [...prev, created]);
        setStockFormState("success");
        setStockFormMessage("Stock added to universe.");
        handleSelectStock(created);
        setStockDialogOpen(false);
      } else {
        const res = await fetch(`${API_BASE}/api/stocks/${selectedStockId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setStockFormState("error");
          setStockFormMessage(
            (err as { detail?: string }).detail ?? "Failed to update stock."
          );
          return;
        }
        const updated: Stock = await res.json();
        setStocks((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setStockFormState("success");
        setStockFormMessage("Stock updated.");
        handleSelectStock(updated);
        setStockDialogOpen(false);
      }
    } catch (error) {
      setStockFormState("error");
      setStockFormMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const handleDeactivateStock = async (stock: Stock) => {
    if (!stock.is_active) return;
    if (
      !window.confirm(
        `Deactivate ${stock.symbol} on ${stock.exchange}? It will be removed from the active universe.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/stocks/${stock.id}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        return;
      }
      setStocks((prev) =>
        prev.map((s) =>
          s.id === stock.id
            ? {
                ...s,
                is_active: false
              }
            : s
        )
      );
      if (selectedStockId === stock.id) {
        setStockFormActive(false);
      }
    } catch {
      // ignore
    }
  };

  const handleEditStock = (stock: Stock) => {
    handleSelectStock(stock);
    setStockDialogOpen(true);
  };

  const handleBulkDeactivate = async () => {
    if (selectedStockIds.length === 0) return;
    if (
      // eslint-disable-next-line no-alert
      !window.confirm(
        `Deactivate ${selectedStockIds.length} stock(s)? They will be removed from the active universe.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/stocks/bulk-deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedStockIds })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-alert
        window.alert(
          (err as { detail?: string }).detail ??
            "Failed to bulk-deactivate stocks."
        );
        return;
      }
      setStocks((prev) =>
        prev.map((s) =>
          selectedStockIds.includes(s.id) ? { ...s, is_active: false } : s
        )
      );
      setSelectedStockIds([]);
    } catch (error) {
      // eslint-disable-next-line no-alert
      window.alert(
        error instanceof Error
          ? error.message
          : "Unexpected error during bulk deactivate."
      );
    }
  };

  const handleBulkRemoveFromUniverse = async () => {
    if (selectedStockIds.length === 0) return;
    if (
      // eslint-disable-next-line no-alert
      !window.confirm(
        `Remove ${selectedStockIds.length} stock(s) from the universe? This will delete them and remove group memberships, but price history will remain.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/stocks/bulk-remove-from-universe`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedStockIds })
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-alert
        window.alert(
          (err as { detail?: string }).detail ??
            "Failed to remove stocks from universe."
        );
        return;
      }
      setStocks((prev) =>
        prev.filter((s) => !selectedStockIds.includes(s.id))
      );
      if (selectedStockId && selectedStockIds.includes(selectedStockId)) {
        setSelectedStockId(null);
      }
      setSelectedStockIds([]);
    } catch (error) {
      // eslint-disable-next-line no-alert
      window.alert(
        error instanceof Error
          ? error.message
          : "Unexpected error during bulk remove."
      );
    }
  };

  const filteredStocks = useMemo(
    () =>
      stocks.filter((s) => {
        if (!showInactive && !s.is_active) return false;
        if (exchangeFilter !== "all" && s.exchange !== exchangeFilter) {
          return false;
        }
        if (sectorFilter !== "all") {
          const sector = (s.sector ?? "").trim();
          if (!sector || sector !== sectorFilter) {
            return false;
          }
        }
        if (analystRatingFilter !== "all") {
          const rating = (s.analyst_rating ?? "").trim();
          if (!rating || rating !== analystRatingFilter) {
            return false;
          }
        }
        if (searchText.trim()) {
          const q = searchText.trim().toLowerCase();
          const symbolMatch = s.symbol.toLowerCase().includes(q);
          const nameMatch = (s.name ?? "").toLowerCase().includes(q);
          if (!symbolMatch && !nameMatch) {
            return false;
          }
        }
        return true;
      }),
    [stocks, showInactive, exchangeFilter, sectorFilter, analystRatingFilter, searchText]
  );

  const exchangeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          stocks
            .map((s) => (s.exchange || "").trim())
            .filter((value) => value.length > 0)
        )
      ).sort(),
    [stocks]
  );

  const sectorOptions = useMemo(
    () =>
      Array.from(
        new Set(
          stocks
            .map((s) => (s.sector ?? "").trim())
            .filter((value) => value.length > 0)
        )
      ).sort(),
    [stocks]
  );

  const analystRatingOptions = useMemo(
    () =>
      Array.from(
        new Set(
          stocks
            .map((s) => (s.analyst_rating ?? "").trim())
            .filter((value) => value.length > 0)
        )
      ).sort(),
    [stocks]
  );

  const universeColumns: GridColDef[] = [
    {
      field: "symbol",
      headerName: "Symbol",
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
      field: "exchange",
      headerName: "Exchange",
      width: 100
    },
    {
      field: "market_cap_crore",
      headerName: "Mkt. cap (₹ cr)",
      width: 140,
      renderCell: (params) => {
        const row = params.row as Stock | undefined;
        const value = row?.market_cap_crore;
        if (value == null || Number.isNaN(value)) return "";
        // show with one decimal place
        return value.toLocaleString("en-IN", {
          maximumFractionDigits: 1,
          minimumFractionDigits: 0
        });
      }
    },
    {
      field: "segment",
      headerName: "Segment",
      width: 130
    },
    {
      field: "sector",
      headerName: "Sector",
      flex: 1,
      minWidth: 140
    },
    {
      field: "analyst_rating",
      headerName: "Analyst rating",
      flex: 1,
      minWidth: 160
    },
    {
      field: "target_price_one_year",
      headerName: "Target price 1 year (₹)",
      width: 190,
      renderCell: (params) => {
        const row = params.row as Stock | undefined;
        const value = row?.target_price_one_year;
        if (value == null || Number.isNaN(value)) return "";
        return value.toLocaleString("en-IN", {
          maximumFractionDigits: 2,
          minimumFractionDigits: 0
        });
      }
    },
    {
      field: "is_active",
      headerName: "Active",
      width: 90,
      renderCell: (params) => {
        const row = params.row as Stock | undefined;
        return row && row.is_active ? "Yes" : "No";
      }
    },
    {
      field: "actions",
      headerName: "Actions",
      width: 180,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const row = (params && (params.row as Stock)) || undefined;
        if (!row) return null;
        return (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              variant="text"
              onClick={(e) => {
                e.stopPropagation();
                handleEditStock(row);
              }}
            >
              Edit
            </Button>
            {row.is_active && (
              <Button
                size="small"
                color="error"
                variant="text"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeactivateStock(row);
                }}
              >
                Deactivate
              </Button>
            )}
          </Stack>
        );
      }
    }
  ];

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, value) => handleTabChange(_, value as TabId)}
        sx={{ mb: 2 }}
      >
        <Tab label="Universe" value="universe" />
        <Tab label="Groups" value="groups" />
         <Tab label="Imports" value="imports" />
      </Tabs>

      <Dialog
        open={stockDialogOpen}
        onClose={() => setStockDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <Box component="form" onSubmit={handleSubmitStockForm} noValidate>
          <DialogTitle>
            {selectedStockId == null ? "Add stock" : "Edit stock"}
          </DialogTitle>
          <DialogContent
            sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
          >
            <TextField
              fullWidth
              label="Symbol"
              value={stockFormSymbol}
              onChange={(e) => setStockFormSymbol(e.target.value.toUpperCase())}
            />
            <TextField
              fullWidth
              label="Exchange"
              value={stockFormExchange}
              onChange={(e) => setStockFormExchange(e.target.value.toUpperCase())}
            />
            <TextField
              fullWidth
              label="Segment"
              value={stockFormSegment}
              onChange={(e) => setStockFormSegment(e.target.value)}
              helperText="Optional, e.g. equity, fno"
            />
            <TextField
              fullWidth
              label="Market cap (₹ cr)"
              type="number"
              value={stockFormMarketCap}
              onChange={(e) => setStockFormMarketCap(e.target.value)}
              helperText="Optional market capitalisation in INR crores"
            />
            <TextField
              fullWidth
              label="Name"
              value={stockFormName}
              onChange={(e) => setStockFormName(e.target.value)}
            />
            <TextField
              fullWidth
              label="Sector"
              value={stockFormSector}
              onChange={(e) => setStockFormSector(e.target.value)}
            />
            <TextField
              fullWidth
              label="Tags (comma-separated)"
              value={stockFormTags}
              onChange={(e) => setStockFormTags(e.target.value)}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={stockFormActive}
                  onChange={(e) => setStockFormActive(e.target.checked)}
                />
              }
              label="Active in universe"
            />
            {stockFormMessage && (
              <Typography
                variant="body2"
                color={stockFormState === "error" ? "error" : "textSecondary"}
              >
                {stockFormMessage}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => {
                setStockDialogOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={stockFormState === "loading"}
            >
              {selectedStockId == null ? "Create" : "Save changes"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {tab === "universe" && (
        <Box>
          <Box
            mb={2}
            display="flex"
            justifyContent="space-between"
            alignItems="center"
          >
            <Box>
              <Typography variant="h5">Stocks – Universe</Typography>
              <Typography variant="body2" color="text.secondary">
                Manage the master list of stocks and their active status.
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              onClick={() => {
                resetStockForm();
                setStockDialogOpen(true);
              }}
            >
              Add stock
            </Button>
          </Box>

          <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} md={4}>
                <TextField
                  label="Search symbol or name"
                  size="small"
                  fullWidth
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  label="Exchange"
                  size="small"
                  select
                  fullWidth
                  value={exchangeFilter}
                  onChange={(e) => setExchangeFilter(e.target.value)}
                >
                  <MenuItem value="all">All exchanges</MenuItem>
                  {exchangeOptions.map((ex) => (
                    <MenuItem key={ex} value={ex}>
                      {ex}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Sector"
                  size="small"
                  select
                  fullWidth
                  value={sectorFilter}
                  onChange={(e) => setSectorFilter(e.target.value)}
                >
                  <MenuItem value="all">All sectors</MenuItem>
                  {sectorOptions.map((sec) => (
                    <MenuItem key={sec} value={sec}>
                      {sec}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  label="Analyst rating"
                  size="small"
                  select
                  fullWidth
                  value={analystRatingFilter}
                  onChange={(e) => setAnalystRatingFilter(e.target.value)}
                >
                  <MenuItem value="all">All ratings</MenuItem>
                  {analystRatingOptions.map((rating) => (
                    <MenuItem key={rating} value={rating}>
                      {rating}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={showInactive}
                      onChange={(e) => setShowInactive(e.target.checked)}
                      size="small"
                    />
                  }
                  label="Show inactive"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => navigate("/stocks?tab=imports")}
                >
                  Import from CSV…
                </Button>
              </Grid>
            </Grid>
          </Paper>

          {selectedStockIds.length > 0 && (
            <Paper
              sx={{
                p: 1,
                mb: 1,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center"
              }}
            >
              <Typography variant="body2">
                {selectedStockIds.length} stock(s) selected
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={() => void handleBulkDeactivate()}>
                  Deactivate
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => void handleBulkRemoveFromUniverse()}
                >
                  Remove from universe
                </Button>
              </Stack>
            </Paper>
          )}

          <Paper elevation={1} sx={{ p: 1 }}>
            {stocksState === "error" && stocksError && (
              <Typography variant="body2" color="error" sx={{ mb: 1 }}>
                {stocksError}
              </Typography>
            )}
            {filteredStocks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No stocks in the universe yet. Use “Add stock” to create one.
              </Typography>
            ) : (
              <div style={{ width: "100%", height: 420 }}>
                <DataGrid
                  rows={filteredStocks}
                  columns={universeColumns}
                  density="compact"
                  checkboxSelection
                  disableRowSelectionOnClick
                  pageSizeOptions={[10, 25, 50]}
                  getRowId={(row) => row.id}
                  rowSelectionModel={selectedStockIds}
                  onRowSelectionModelChange={(selection: GridSelectionModel) =>
                    setSelectedStockIds(selection as number[])
                  }
                />
              </div>
            )}
          </Paper>
        </Box>
      )}

      {tab === "imports" && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Import TradingView screener CSV
                </Typography>
                <Typography variant="body2" color="textSecondary" gutterBottom>
                  Upload a TradingView screener export and optionally map it
                  into a stock group. The backend will attempt to resolve
                  symbols and exchanges automatically.
                </Typography>
                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
                >
                  <Button
                    variant="outlined"
                    component="label"
                    size="small"
                  >
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const formData = new FormData();
                        formData.append("file", file);
                        formData.append("group_code", "TV_IMPORT");
                        formData.append(
                          "group_name",
                          "TradingView screener import"
                        );
                        formData.append("create_or_update_group", "true");
                        formData.append("mark_active", "true");
                        try {
                          const res = await fetch(
                            `${API_BASE}/api/stocks/import/tradingview`,
                            {
                              method: "POST",
                              body: formData
                            }
                          );
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // eslint-disable-next-line no-alert
                            window.alert(
                              (err as { detail?: string }).detail ??
                                "Failed to import TradingView CSV."
                            );
                            return;
                          }
                          const summary = await res.json();
                          const msg = [
                            `Created stocks: ${summary.created_stocks}`,
                            `Updated stocks: ${summary.updated_stocks}`,
                            `Added to group: ${summary.added_to_group}`,
                            summary.errors?.length
                              ? `Errors: ${summary.errors.length}`
                              : null
                          ]
                            .filter(Boolean)
                            .join(", ");
                          // eslint-disable-next-line no-alert
                          window.alert(msg);
                          setLastImportedGroupCode(
                            (summary.group_code as string | null) ?? "TV_IMPORT"
                          );
                          void loadUniverse();
                          void loadGroups();
                        } catch (error) {
                          // eslint-disable-next-line no-alert
                          window.alert(
                            error instanceof Error
                              ? error.message
                              : "Unexpected error during import."
                          );
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </Button>
                  <Typography variant="body2" color="textSecondary">
                    Expected to contain a column named{" "}
                    <strong>Ticker</strong> or <strong>Symbol</strong>. Other
                    columns are ignored.
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={6}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Import portfolio CSV
                </Typography>
                <Typography variant="body2" color="textSecondary" gutterBottom>
                  Import a portfolio CSV and map it into a stock group that can
                  be used as a universe for portfolios and backtests.
                </Typography>
                <Box
                  sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
                >
                  <Button
                    variant="outlined"
                    component="label"
                    size="small"
                  >
                    Upload CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      hidden
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const groupCode = window.prompt(
                          "Enter group code (e.g. HPS):",
                          "HPS"
                        );
                        const groupName = window.prompt(
                          "Enter group name:",
                          "Imported portfolio"
                        );
                        if (!groupCode || !groupName) {
                          e.target.value = "";
                          return;
                        }
                        const formData = new FormData();
                        formData.append("file", file);
                        formData.append("group_code", groupCode);
                        formData.append("group_name", groupName);
                        formData.append("mark_active", "true");
                        try {
                          const res = await fetch(
                            `${API_BASE}/api/stock-groups/import-portfolio-csv`,
                            {
                              method: "POST",
                              body: formData
                            }
                          );
                          if (!res.ok) {
                            const err = await res.json().catch(() => ({}));
                            // eslint-disable-next-line no-alert
                            window.alert(
                              (err as { detail?: string }).detail ??
                                "Failed to import portfolio CSV."
                            );
                            return;
                          }
                          const summary = await res.json();
                          const msg = [
                            `Created stocks: ${summary.created_stocks}`,
                            `Updated stocks: ${summary.updated_stocks}`,
                            `Added to group: ${summary.added_to_group}`,
                            summary.errors?.length
                              ? `Errors: ${summary.errors.length}`
                              : null
                          ]
                            .filter(Boolean)
                            .join(", ");
                          // eslint-disable-next-line no-alert
                          window.alert(msg);
                          setLastImportedGroupCode(
                            (summary.group_code as string | null) ?? groupCode
                          );
                          void loadUniverse();
                          void loadGroups();
                        } catch (error) {
                          // eslint-disable-next-line no-alert
                          window.alert(
                            error instanceof Error
                              ? error.message
                              : "Unexpected error during import."
                          );
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </Button>
                  <Typography variant="body2" color="textSecondary">
                    Expected to contain a column named{" "}
                    <strong>Symbol</strong> or <strong>Ticker</strong>. All
                    resolved symbols will be added to the specified group.
                  </Typography>
                  {lastImportedGroupCode && (
                    <Box mt={1}>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={handleViewImportedGroup}
                      >
                        View group {lastImportedGroupCode}
                      </Button>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === "groups" && (
        <GroupsTab
          apiBase={API_BASE}
          groups={groups}
          groupsState={groupsState}
          groupsError={groupsError}
          onRefreshGroups={() => void loadGroups()}
          stocks={stocks}
          activeGroupCode={activeGroupCode}
          onGroupSelectionChange={handleGroupSelectionChange}
        />
      )}
    </Box>
  );
};
