import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from "@mui/material";
import {
  DataGrid,
  type GridColDef,
  type GridRowSelectionModel
} from "@mui/x-data-grid";
import { useEffect, useMemo, useState } from "react";
import type {
  GroupCompositionMode,
  Stock,
  StockGroupDetail,
  StockGroupMember,
  StockGroupSummary
} from "../../types/stocks";
import { AddStockDialog } from "./AddStockDialog";
import { AddFromUniverseDialog } from "./AddFromUniverseDialog";

type GroupDetailPanelProps = {
  apiBase: string;
  group: StockGroupSummary | null;
  onGroupUpdated: () => void;
  onEditGroup: (group: StockGroupSummary) => void;
  onDeleteGroup: (group: StockGroupSummary) => void;
  stocks: Stock[];
};

type MessageState = { type: "success" | "error"; text: string } | null;

export const GroupDetailPanel = ({
  apiBase,
  group,
  onGroupUpdated,
  onEditGroup,
  onDeleteGroup,
  stocks
}: GroupDetailPanelProps) => {
  const [detail, setDetail] = useState<StockGroupDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"composition" | "deployments">("composition");
  const [selectionModel, setSelectionModel] = useState<GridRowSelectionModel>([]);
  const [actionMessage, setActionMessage] = useState<MessageState>(null);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [addUniverseOpen, setAddUniverseOpen] = useState(false);
  const [pendingTotalAmount, setPendingTotalAmount] = useState("");
  const [savingTotal, setSavingTotal] = useState(false);

  useEffect(() => {
    if (!group) {
      setDetail(null);
      setSelectionModel([]);
      return;
    }
    const fetchDetail = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/api/stock-groups/${group.id}`);
        if (!res.ok) {
          throw new Error("Failed to load group details.");
        }
        const data: StockGroupDetail = await res.json();
        setDetail(data);
        setPendingTotalAmount(
          data.total_investable_amount != null
            ? String(data.total_investable_amount)
            : ""
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to load group.");
      } finally {
        setLoading(false);
      }
    };
    void fetchDetail();
  }, [apiBase, group]);

  const handleModeChange = async (mode: GroupCompositionMode) => {
    if (!detail || detail.composition_mode === mode) return;
    try {
      const res = await fetch(`${apiBase}/api/stock-groups/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition_mode: mode })
      });
      if (!res.ok) {
        throw new Error("Failed to update composition mode.");
      }
      setActionMessage({
        type: "success",
        text: `Composition mode updated to ${mode}.`
      });
      onGroupUpdated();
      const updated: StockGroupSummary = await res.json();
      setDetail((prev) =>
        prev
          ? { ...prev, composition_mode: mode, updated_at: updated.updated_at }
          : prev
      );
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to update mode."
      });
    }
  };

  const handleAddSingleSymbol = async (symbol: string) => {
    await handleBulkAddSymbols([symbol]);
  };

  const handleTotalAmountBlur = async () => {
    if (!detail || detail.composition_mode !== "amount") return;
    const parsed =
      pendingTotalAmount.trim().length === 0
        ? null
        : Number.parseFloat(pendingTotalAmount);
    setSavingTotal(true);
    try {
      const res = await fetch(`${apiBase}/api/stock-groups/${detail.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_investable_amount: parsed })
      });
      if (!res.ok) {
        throw new Error("Failed to update total investable amount.");
      }
      setActionMessage({
        type: "success",
        text: "Total investable amount saved."
      });
      onGroupUpdated();
      setDetail((prev) => (prev ? { ...prev, total_investable_amount: parsed } : prev));
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to save amount."
      });
    } finally {
      setSavingTotal(false);
    }
  };

  const refreshDetail = async (): Promise<StockGroupDetail | null> => {
    if (!group) return null;
    try {
      const res = await fetch(`${apiBase}/api/stock-groups/${group.id}`);
      if (!res.ok) throw new Error("Failed to reload group.");
      const data: StockGroupDetail = await res.json();
      setDetail(data);
      setPendingTotalAmount(
        data.total_investable_amount != null
          ? String(data.total_investable_amount)
          : ""
      );
      onGroupUpdated();
      return data;
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to refresh group."
      });
      return null;
    }
  };

  const handleRemoveSelected = async () => {
    if (!detail || selectionModel.length === 0) return;
    const stockIds = selectionModel.map((id) => Number(id));
    try {
      const responses = await Promise.all(
        stockIds.map((stockId) =>
          fetch(
            `${apiBase}/api/stock-groups/${detail.id}/members/${stockId}`,
            {
              method: "DELETE"
            }
          )
        )
      );
      const failed = responses.find((res) => !res.ok);
      if (failed) {
        throw new Error("Failed to remove selected members.");
      }
      setActionMessage({
        type: "success",
        text: `Removed ${stockIds.length} member(s).`
      });
      await refreshDetail();
      setSelectionModel([]);
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to remove members."
      });
    }
  };

  const handleEqualise = async (symbolsOverride?: string[]) => {
    if (!detail) return;
    try {
      const symbols =
        symbolsOverride && symbolsOverride.length > 0
          ? symbolsOverride
          : detail.members.map((member) => member.symbol);
      if (symbols.length === 0) return;
      const res = await fetch(
        `${apiBase}/api/stock-groups/${detail.code}/members/bulk-add`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols })
        }
      );
      if (!res.ok) {
        throw new Error("Failed to equalize distribution.");
      }
      setActionMessage({
        type: "success",
        text: "Distribution recalculated."
      });
      await refreshDetail();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to equalize members."
      });
    }
  };

  const handleMemberPatch = async (
    memberId: number,
    field: "target_weight_pct" | "target_qty" | "target_amount",
    value: number
  ) => {
    if (!detail) return;
    setActionMessage(null);
    try {
      const res = await fetch(
        `${apiBase}/api/stock-groups/${detail.code}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value })
        }
      );
      if (!res.ok) {
        throw new Error("Failed to update member.");
      }
      setActionMessage({
        type: "success",
        text: "Member updated."
      });
      await refreshDetail();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Unable to update member."
      });
    }
  };

  const handleBulkAddSymbols = async (symbols: string[]): Promise<void> => {
    if (!detail) return;
    if (symbols.length === 0) return;
    const res = await fetch(
      `${apiBase}/api/stock-groups/${detail.code}/members/bulk-add`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbols })
      }
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(
        (err as { detail?: string }).detail ??
          "Failed to add the selected stocks."
      );
    }
    const existingSymbols = detail.members.map((member) => member.symbol);
    const combined = Array.from(new Set([...existingSymbols, ...symbols]));
    await handleEqualise(combined);
  };

  const handleImportCsv = async (file: File) => {
    if (!detail) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("group_code", detail.code);
    formData.append("group_name", detail.name);
    formData.append("mark_active", "true");
    try {
      const res = await fetch(
        `${apiBase}/api/stock-groups/import-portfolio-csv`,
        {
          method: "POST",
          body: formData
        }
      );
      if (!res.ok) {
        throw new Error("Failed to import CSV. Ensure the format is valid.");
      }
      const summary = await res.json();
      setActionMessage({
        type: "success",
        text: `Import complete. Added ${summary.added_to_group ?? 0} member(s).`
      });
      await refreshDetail();
    } catch (err) {
      setActionMessage({
        type: "error",
        text: err instanceof Error ? err.message : "CSV import failed."
      });
    }
  };

  const members = detail?.members ?? [];
  const availableStocks = useMemo(() => {
    if (!detail) return [];
    return stocks.filter((stock) => {
      if (!stock.is_active) return false;
      const symbolMatch = members.some(
        (member) =>
          member.stock_id === stock.id ||
          member.symbol.toUpperCase() === stock.symbol.toUpperCase()
      );
      return !symbolMatch;
    });
  }, [stocks, members, detail]);

  const columns: GridColDef[] = useMemo(() => {
    const targetField =
      detail?.composition_mode === "qty"
        ? "target_qty"
        : detail?.composition_mode === "amount"
          ? "target_amount"
          : "target_weight_pct";
    const targetHeader =
      detail?.composition_mode === "qty"
        ? "Qty"
        : detail?.composition_mode === "amount"
          ? "Amount"
          : "Weight %";

    return [
      { field: "symbol", headerName: "Symbol", width: 110 },
      { field: "name", headerName: "Name", flex: 1, minWidth: 150 },
      { field: "sector", headerName: "Sector", width: 160 },
      {
        field: "analyst_rating",
        headerName: "Analyst rating",
        width: 140
      },
      {
        field: targetField,
        headerName: targetHeader,
        width: 140,
        editable: true,
        valueFormatter: (params) =>
          params?.value != null ? Number(params.value).toFixed(2) : ""
      }
    ];
  }, [detail]);

  const handleCellEditCommit = async (params: {
    id: GridRowSelectionModel[number];
    field: string;
    value: unknown;
  }) => {
    if (!detail) return;
    const memberId = Number(params.id);
    const numericValue = Number(params.value);
    if (Number.isNaN(numericValue)) return;
    if (detail.composition_mode === "weights" && params.field === "target_weight_pct") {
      await handleMemberPatch(memberId, "target_weight_pct", numericValue);
    } else if (detail.composition_mode === "qty" && params.field === "target_qty") {
      await handleMemberPatch(memberId, "target_qty", numericValue);
    } else if (
      detail.composition_mode === "amount" &&
      params.field === "target_amount"
    ) {
      await handleMemberPatch(memberId, "target_amount", numericValue);
    }
  };

  if (!group) {
    return (
      <Paper elevation={1} sx={{ p: 3, height: "100%" }}>
        <Typography variant="body2" color="text.secondary">
          Select a group to view its composition.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper elevation={1} sx={{ p: 3, height: "100%" }}>
      <Stack spacing={2}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Box>
            <Typography variant="h6">
              {group.name} ({group.code})
            </Typography>
            {group.description && (
              <Typography variant="body2" color="text.secondary">
                {group.description}
              </Typography>
            )}
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" onClick={() => onEditGroup(group)}>
              Edit group
            </Button>
            <Button
              variant="outlined"
              size="small"
              color="error"
              onClick={() => onDeleteGroup(group)}
            >
              Delete
            </Button>
          </Stack>
        </Stack>

        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          textColor="primary"
          indicatorColor="primary"
        >
          <Tab label="Composition" value="composition" />
          <Tab label="Deployments" value="deployments" />
        </Tabs>

        {loading && (
          <Typography variant="body2" color="text.secondary">
            Loading group details…
          </Typography>
        )}
        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {actionMessage && (
          <Alert
            severity={actionMessage.type}
            onClose={() => setActionMessage(null)}
          >
            {actionMessage.text}
          </Alert>
        )}

        {tab === "composition" && detail && !loading && !error && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <ToggleButtonGroup
                size="small"
                exclusive
                value={detail.composition_mode}
                onChange={(_, value) => value && handleModeChange(value)}
              >
                <ToggleButton value="weights">Weights</ToggleButton>
                <ToggleButton value="qty">Qty</ToggleButton>
                <ToggleButton value="amount">Amount</ToggleButton>
              </ToggleButtonGroup>

              <TextField
                label="Total investable amount"
                size="small"
                type="number"
                value={pendingTotalAmount}
                onChange={(e) => setPendingTotalAmount(e.target.value)}
                onBlur={() => void handleTotalAmountBlur()}
                disabled={detail.composition_mode !== "amount" || savingTotal}
                helperText={
                  detail.composition_mode !== "amount"
                    ? "Enabled only in amount mode"
                    : undefined
                }
                InputProps={{ inputProps: { min: 0, step: 1000 } }}
                sx={{ maxWidth: 240 }}
              />
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Button size="small" onClick={() => setAddStockOpen(true)}>
                Add stock
              </Button>
              <Button size="small" onClick={() => setAddUniverseOpen(true)}>
                Add from universe…
              </Button>
              <Button size="small" component="label">
                Import CSV…
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void handleImportCsv(file);
                      event.target.value = "";
                    }
                  }}
                />
              </Button>
              {selectionModel.length > 0 && (
                <Button
                  size="small"
                  color="error"
                  onClick={() => void handleRemoveSelected()}
                >
                  Remove selected
                </Button>
              )}
              <Box sx={{ flexGrow: 1 }} />
              <Button size="small" onClick={() => void handleEqualise()}>
                Equalize{" "}
                {detail.composition_mode === "weights"
                  ? "weights"
                  : detail.composition_mode === "amount"
                    ? "amounts"
                    : "qty"}
              </Button>
            </Stack>

            <div style={{ width: "100%", height: 420 }}>
              <DataGrid
                rows={members as StockGroupMember[]}
                columns={columns}
                density="compact"
                getRowId={(row) => row.id}
                checkboxSelection
                disableColumnMenu
                rowSelectionModel={selectionModel}
                onRowSelectionModelChange={(model) => setSelectionModel(model)}
                onCellEditCommit={(params) =>
                  void handleCellEditCommit({
                    id: params.id,
                    field: params.field,
                    value: params.value
                  })
                }
                localeText={{
                  noRowsLabel: "No members in this group yet."
                }}
              />
            </div>
          </Stack>
        )}

        {tab === "deployments" && (
          <Box py={8} textAlign="center">
            <Typography variant="body2" color="text.secondary">
              Deployments coming soon. This area will show live portfolios using
              this basket.
            </Typography>
          </Box>
        )}
      </Stack>

      {detail && (
        <>
          <AddStockDialog
            open={addStockOpen}
            onClose={() => setAddStockOpen(false)}
            availableStocks={availableStocks}
            onSubmit={handleAddSingleSymbol}
          />
          <AddFromUniverseDialog
            open={addUniverseOpen}
            onClose={() => setAddUniverseOpen(false)}
            onSubmit={handleBulkAddSymbols}
            availableStocks={availableStocks}
          />
        </>
      )}
    </Paper>
  );
};
