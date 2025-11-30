import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Grid,
  MenuItem,
  Tab,
  Tabs,
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

type Stock = {
  id: number;
  symbol: string;
  exchange: string;
  segment?: string | null;
  name?: string | null;
  sector?: string | null;
  tags?: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type StockGroup = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
  stock_count: number;
};

type StockGroupDetail = StockGroup & {
  members: Stock[];
};

type TabId = "universe" | "groups" | "imports";

const API_BASE = "http://127.0.0.1:8000";

export const StocksPage = () => {
  const [tab, setTab] = useState<TabId>("universe");

  const [stocks, setStocks] = useState<Stock[]>([]);
  const [stocksState, setStocksState] = useState<FetchState>("idle");
  const [stocksError, setStocksError] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);

  const [stockFormSymbol, setStockFormSymbol] = useState("");
  const [stockFormExchange, setStockFormExchange] = useState("NSE");
  const [stockFormSegment, setStockFormSegment] = useState("");
  const [stockFormName, setStockFormName] = useState("");
  const [stockFormSector, setStockFormSector] = useState("");
  const [stockFormTags, setStockFormTags] = useState("");
  const [stockFormActive, setStockFormActive] = useState(true);
  const [stockFormState, setStockFormState] = useState<FetchState>("idle");
  const [stockFormMessage, setStockFormMessage] = useState<string | null>(null);
  const [bulkImportState, setBulkImportState] = useState<FetchState>("idle");
  const [bulkImportMessage, setBulkImportMessage] = useState<string | null>(null);

  const [groups, setGroups] = useState<StockGroup[]>([]);
  const [groupsState, setGroupsState] = useState<FetchState>("idle");
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<StockGroupDetail | null>(
    null
  );

  const [groupFormCode, setGroupFormCode] = useState("");
  const [groupFormName, setGroupFormName] = useState("");
  const [groupFormDescription, setGroupFormDescription] = useState("");
  const [groupFormTags, setGroupFormTags] = useState("");
  const [groupFormState, setGroupFormState] = useState<FetchState>("idle");
  const [groupFormMessage, setGroupFormMessage] = useState<string | null>(null);

  const [memberAddStockId, setMemberAddStockId] = useState<number | "">("");
  const [memberState, setMemberState] = useState<FetchState>("idle");
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [groupBulkImportState, setGroupBulkImportState] =
    useState<FetchState>("idle");
  const [groupBulkImportMessage, setGroupBulkImportMessage] = useState<
    string | null
  >(null);

  useEffect(() => {
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

    void loadUniverse();
    void loadGroups();
  }, []);

  const resetStockForm = () => {
    setSelectedStockId(null);
    setStockFormSymbol("");
    setStockFormExchange("NSE");
    setStockFormSegment("");
    setStockFormName("");
    setStockFormSector("");
    setStockFormTags("");
    setStockFormActive(true);
    setStockFormState("idle");
    setStockFormMessage(null);
    setBulkImportState("idle");
    setBulkImportMessage(null);
  };

  const handleSelectStock = (stock: Stock) => {
    setSelectedStockId(stock.id);
    setStockFormSymbol(stock.symbol);
    setStockFormExchange(stock.exchange);
    setStockFormSegment(stock.segment ?? "");
    setStockFormName(stock.name ?? "");
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

    const payload = {
      symbol: stockFormSymbol.trim().toUpperCase(),
      exchange: stockFormExchange.trim().toUpperCase() || "NSE",
      segment: stockFormSegment.trim() || null,
      name: stockFormName.trim() || null,
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

  const filteredStocks = stocks.filter((s) =>
    showInactive ? true : s.is_active
  );

  const handleBulkImportCsv = async (file: File) => {
    setBulkImportState("loading");
    setBulkImportMessage(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        setBulkImportState("error");
        setBulkImportMessage("CSV file is empty.");
        return;
      }

      const header = lines[0].split(",").map((h) => h.trim());
      const nseIndex = header.findIndex(
        (h) => h.toLowerCase() === "nse code"
      );
      if (nseIndex === -1) {
        setBulkImportState("error");
        setBulkImportMessage(
          'CSV must contain a header column named "NSE Code" (case-insensitive).'
        );
        return;
      }

      const symbols: string[] = [];
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        const cols = line.split(",");
        if (nseIndex >= cols.length) continue;
        const raw = cols[nseIndex].trim();
        if (!raw) continue;
        symbols.push(raw.toUpperCase());
      }

      const uniqueSymbols = Array.from(new Set(symbols));
      if (uniqueSymbols.length === 0) {
        setBulkImportState("error");
        setBulkImportMessage("No NSE codes found in the CSV.");
        return;
      }

      let createdCount = 0;
      let existingCount = 0;
      let errorCount = 0;

      // Import each symbol as an NSE stock; ignore duplicates gracefully.
      // eslint-disable-next-line no-restricted-syntax
      for (const sym of uniqueSymbols) {
        const payload = {
          symbol: sym,
          exchange: "NSE",
          segment: null,
          name: null,
          sector: null,
          tags: null,
          is_active: true
        };
        // eslint-disable-next-line no-await-in-loop
        const res = await fetch(`${API_BASE}/api/stocks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const created: Stock = await res.json();
          createdCount += 1;
          setStocks((prev) => [...prev, created]);
        } else if (res.status === 409) {
          existingCount += 1;
        } else {
          errorCount += 1;
        }
      }

      setBulkImportState("success");
      setBulkImportMessage(
        `Bulk import complete: ${createdCount} added, ${existingCount} already existed, ${errorCount} failed.`
      );
    } catch (error) {
      setBulkImportState("error");
      setBulkImportMessage(
        error instanceof Error ? error.message : "Unexpected error during import."
      );
    }
  };

  const resetGroupForm = () => {
    setSelectedGroupId(null);
    setSelectedGroup(null);
    setGroupFormCode("");
    setGroupFormName("");
    setGroupFormDescription("");
    setGroupFormTags("");
    setGroupFormState("idle");
    setGroupFormMessage(null);
    setMemberAddStockId("");
    setMemberState("idle");
    setMemberMessage(null);
    setGroupBulkImportState("idle");
    setGroupBulkImportMessage(null);
  };

  const loadGroupDetail = async (groupId: number) => {
    try {
      const res = await fetch(`${API_BASE}/api/stock-groups/${groupId}`);
      if (!res.ok) {
        return;
      }
      const detail: StockGroupDetail = await res.json();
      setSelectedGroup(detail);
      setSelectedGroupId(detail.id);
      setGroupFormCode(detail.code);
      setGroupFormName(detail.name);
      setGroupFormDescription(detail.description ?? "");
      setGroupFormTags((detail.tags ?? []).join(", "));
      setGroupFormState("idle");
      setGroupFormMessage(null);
      setMemberAddStockId("");
      setMemberState("idle");
      setMemberMessage(null);
    } catch {
      // ignore
    }
  };

  const handleSubmitGroupForm = async (event: FormEvent) => {
    event.preventDefault();
    setGroupFormState("loading");
    setGroupFormMessage(null);

    const payload = {
      code: groupFormCode.trim().toUpperCase(),
      name: groupFormName.trim(),
      description: groupFormDescription.trim() || null,
      tags:
        groupFormTags.trim().length === 0
          ? null
          : groupFormTags
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t.length > 0)
    };

    if (!payload.code || !payload.name) {
      setGroupFormState("error");
      setGroupFormMessage("Code and Name are required.");
      return;
    }

    try {
      if (selectedGroupId == null) {
        const res = await fetch(`${API_BASE}/api/stock-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setGroupFormState("error");
          setGroupFormMessage(
            (err as { detail?: string }).detail ?? "Failed to create group."
          );
          return;
        }
        const created: StockGroupDetail = await res.json();
        const groupRow: StockGroup = {
          id: created.id,
          code: created.code,
          name: created.name,
          description: created.description,
          tags: created.tags,
          created_at: created.created_at,
          updated_at: created.updated_at,
          stock_count: created.stock_count
        };
        setGroups((prev) => [...prev, groupRow]);
        setGroupFormState("success");
        setGroupFormMessage("Group created.");
        await loadGroupDetail(created.id);
      } else {
        const res = await fetch(`${API_BASE}/api/stock-groups/${selectedGroupId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setGroupFormState("error");
          setGroupFormMessage(
            (err as { detail?: string }).detail ?? "Failed to update group."
          );
          return;
        }
        const updated: StockGroup = await res.json();
        setGroups((prev) =>
          prev.map((g) => (g.id === updated.id ? updated : g))
        );
        setGroupFormState("success");
        setGroupFormMessage("Group updated.");
        await loadGroupDetail(updated.id);
      }
    } catch (error) {
      setGroupFormState("error");
      setGroupFormMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupId || !selectedGroup) return;
    if (
      !window.confirm(
        `Delete group '${selectedGroup.code}'? This will remove its membership but not delete stocks.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/stock-groups/${selectedGroupId}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        return;
      }
      setGroups((prev) => prev.filter((g) => g.id !== selectedGroupId));
      resetGroupForm();
    } catch {
      // ignore
    }
  };

  const availableStocksForMembership = stocks.filter((s) => {
    if (!s.is_active) return false;
    if (!selectedGroup) return true;
    return !selectedGroup.members.some((m) => m.id === s.id);
  });

  const handleBulkAddMembersFromCsv = async (file: File) => {
    if (!selectedGroupId || !selectedGroup) {
      setGroupBulkImportState("error");
      setGroupBulkImportMessage(
        "Select a group before importing members from CSV."
      );
      return;
    }

    setGroupBulkImportState("loading");
    setGroupBulkImportMessage(null);

    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length === 0) {
        setGroupBulkImportState("error");
        setGroupBulkImportMessage("CSV file is empty.");
        return;
      }

      const header = lines[0].split(",").map((h) => h.trim());
      const nseIndex = header.findIndex(
        (h) => h.toLowerCase() === "nse code"
      );
      if (nseIndex === -1) {
        setGroupBulkImportState("error");
        setGroupBulkImportMessage(
          'CSV must contain a header column named "NSE Code" (case-insensitive).'
        );
        return;
      }

      const symbols: string[] = [];
      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim()) continue;
        const cols = line.split(",");
        if (nseIndex >= cols.length) continue;
        const raw = cols[nseIndex].trim();
        if (!raw) continue;
        symbols.push(raw.toUpperCase());
      }

      const uniqueSymbols = Array.from(new Set(symbols));
      if (uniqueSymbols.length === 0) {
        setGroupBulkImportState("error");
        setGroupBulkImportMessage("No NSE codes found in the CSV.");
        return;
      }

      const existingStocksByKey = new Map<string, Stock>();
      stocks.forEach((s) => {
        const key = `${s.symbol.toUpperCase()}|${s.exchange.toUpperCase()}`;
        existingStocksByKey.set(key, s);
      });

      const existingMembers = new Set<number>(
        selectedGroup.members.map((m) => m.id)
      );

      const stockIdsToAdd: number[] = [];
      let createdCount = 0;
      let reusedCount = 0;

      // Ensure each symbol exists as an NSE stock; then collect ids to add.
      // eslint-disable-next-line no-restricted-syntax
      for (const sym of uniqueSymbols) {
        const key = `${sym}|NSE`;
        let stock = existingStocksByKey.get(key);
        if (!stock) {
          const payload = {
            symbol: sym,
            exchange: "NSE",
            segment: null,
            name: null,
            sector: null,
            tags: null,
            is_active: true
          };
          // eslint-disable-next-line no-await-in-loop
          const res = await fetch(`${API_BASE}/api/stocks`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            const created: Stock = await res.json();
            createdCount += 1;
            stock = created;
            existingStocksByKey.set(key, created);
            setStocks((prev) => [...prev, created]);
          } else if (res.status === 409) {
            // Fetch the stock from the latest universe list if duplicate.
            stock = stocks.find(
              (s) =>
                s.symbol.toUpperCase() === sym && s.exchange.toUpperCase() === "NSE"
            );
            reusedCount += 1;
          }
        } else {
          reusedCount += 1;
        }

        if (stock && !existingMembers.has(stock.id)) {
          stockIdsToAdd.push(stock.id);
        }
      }

      if (stockIdsToAdd.length === 0) {
        setGroupBulkImportState("success");
        setGroupBulkImportMessage(
          `No new members to add. ${createdCount} ensured in universe, ${reusedCount} already existed.`
        );
        return;
      }

      const res = await fetch(
        `${API_BASE}/api/stock-groups/${selectedGroupId}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stock_ids: stockIdsToAdd })
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGroupBulkImportState("error");
        setGroupBulkImportMessage(
          (err as { detail?: string }).detail ??
            "Failed to add members from CSV."
        );
        return;
      }

      const detail: StockGroupDetail = await res.json();
      setSelectedGroup(detail);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === detail.id ? { ...g, stock_count: detail.stock_count } : g
        )
      );

      setGroupBulkImportState("success");
      setGroupBulkImportMessage(
        `Group import complete: ${stockIdsToAdd.length} member(s) added, ${createdCount} ensured in universe, ${reusedCount} reused.`
      );
    } catch (error) {
      setGroupBulkImportState("error");
      setGroupBulkImportMessage(
        error instanceof Error ? error.message : "Unexpected error during import."
      );
    }
  };

  const handleAddMember = async () => {
    if (!selectedGroupId || !memberAddStockId) return;
    setMemberState("loading");
    setMemberMessage(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/stock-groups/${selectedGroupId}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stock_ids: [memberAddStockId] })
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMemberState("error");
        setMemberMessage(
          (err as { detail?: string }).detail ?? "Failed to add member."
        );
        return;
      }
      const detail: StockGroupDetail = await res.json();
      setSelectedGroup(detail);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === detail.id ? { ...g, stock_count: detail.stock_count } : g
        )
      );
      setMemberAddStockId("");
      setMemberState("success");
      setMemberMessage("Stock added to group.");
    } catch (error) {
      setMemberState("error");
      setMemberMessage(
        error instanceof Error ? error.message : "Unexpected error occurred."
      );
    }
  };

  const handleRemoveMember = async (stockId: number) => {
    if (!selectedGroupId || !selectedGroup) return;
    const member = selectedGroup.members.find((m) => m.id === stockId);
    if (
      !window.confirm(
        `Remove ${member?.symbol ?? "this stock"} from group '${selectedGroup.code}'?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/stock-groups/${selectedGroupId}/members/${stockId}`,
        {
          method: "DELETE"
        }
      );
      if (!res.ok && res.status !== 204) {
        return;
      }
      const updatedMembers = selectedGroup.members.filter((m) => m.id !== stockId);
      const updatedDetail: StockGroupDetail = {
        ...selectedGroup,
        members: updatedMembers,
        stock_count: updatedMembers.length
      };
      setSelectedGroup(updatedDetail);
      setGroups((prev) =>
        prev.map((g) =>
          g.id === updatedDetail.id
            ? { ...g, stock_count: updatedDetail.stock_count }
            : g
        )
      );
    } catch {
      // ignore
    }
  };

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value as TabId)}
        sx={{ mb: 2 }}
      >
        <Tab label="Universe" value="universe" />
        <Tab label="Groups" value="groups" />
         <Tab label="Imports" value="imports" />
      </Tabs>

      {tab === "universe" && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {selectedStockId == null ? "Add stock" : "Edit stock"}
                </Typography>
                <Box component="form" onSubmit={handleSubmitStockForm} noValidate>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Symbol"
                    value={stockFormSymbol}
                    onChange={(e) => setStockFormSymbol(e.target.value.toUpperCase())}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Exchange"
                    value={stockFormExchange}
                    onChange={(e) => setStockFormExchange(e.target.value.toUpperCase())}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Segment"
                    value={stockFormSegment}
                    onChange={(e) => setStockFormSegment(e.target.value)}
                    helperText="Optional, e.g. equity, fno"
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Name"
                    value={stockFormName}
                    onChange={(e) => setStockFormName(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Sector"
                    value={stockFormSector}
                    onChange={(e) => setStockFormSector(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
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
                  <Box mt={2} display="flex" gap={1}>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={stockFormState === "loading"}
                    >
                      {selectedStockId == null ? "Create" : "Save changes"}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={resetStockForm}
                      disabled={stockFormState === "loading"}
                    >
                      Reset
                    </Button>
                  </Box>
                  {stockFormMessage && (
                    <Typography
                      variant="body2"
                      color={stockFormState === "error" ? "error" : "textSecondary"}
                      mt={1}
                    >
                      {stockFormMessage}
                    </Typography>
                  )}
                </Box>
                <Box mt={3}>
                  <Typography variant="subtitle2" gutterBottom>
                    Bulk import NSE stocks from CSV
                  </Typography>
                  <Typography variant="body2" color="textSecondary">
                    CSV must have a column named <code>NSE Code</code> (any case).
                    Symbols from that column will be added as NSE stocks.
                  </Typography>
                  <Box mt={1}>
                    <Button variant="outlined" component="label" size="small">
                      Upload CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            void handleBulkImportCsv(file);
                            e.target.value = "";
                          }
                        }}
                      />
                    </Button>
                  </Box>
                  {bulkImportMessage && (
                    <Typography
                      variant="body2"
                      color={bulkImportState === "error" ? "error" : "textSecondary"}
                      mt={1}
                    >
                      {bulkImportMessage}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={8}>
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
                  <Typography variant="h6">Universe</Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                      />
                    }
                    label="Show inactive"
                  />
                </Box>
                {stocksState === "error" && stocksError && (
                  <Typography variant="body2" color="error" mb={1}>
                    {stocksError}
                  </Typography>
                )}
                {filteredStocks.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    No stocks in the universe yet. Use the form on the left to
                    add one.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 380, overflowY: "auto" }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Symbol</TableCell>
                          <TableCell>Exchange</TableCell>
                          <TableCell>Segment</TableCell>
                          <TableCell>Name</TableCell>
                          <TableCell>Sector</TableCell>
                          <TableCell>Tags</TableCell>
                          <TableCell>Active</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {filteredStocks.map((s) => (
                          <TableRow
                            key={s.id}
                            hover
                            selected={selectedStockId === s.id}
                            onClick={() => handleSelectStock(s)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>{s.symbol}</TableCell>
                            <TableCell>{s.exchange}</TableCell>
                            <TableCell>{s.segment ?? ""}</TableCell>
                            <TableCell>{s.name ?? ""}</TableCell>
                            <TableCell>{s.sector ?? ""}</TableCell>
                            <TableCell>{(s.tags ?? []).join(", ")}</TableCell>
                            <TableCell>{s.is_active ? "Yes" : "No"}</TableCell>
                            <TableCell align="right">
                              {s.is_active && (
                                <Button
                                  size="small"
                                  color="error"
                                  variant="text"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDeactivateStock(s);
                                  }}
                                >
                                  Deactivate
                                </Button>
                              )}
                            </TableCell>
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
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {tab === "groups" && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  {selectedGroupId == null ? "New group" : "Edit group"}
                </Typography>
                <Box component="form" onSubmit={handleSubmitGroupForm} noValidate>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Code"
                    value={groupFormCode}
                    onChange={(e) => setGroupFormCode(e.target.value.toUpperCase())}
                    helperText="Short identifier, e.g. TRENDING_STOCKS"
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Name"
                    value={groupFormName}
                    onChange={(e) => setGroupFormName(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Description"
                    multiline
                    minRows={2}
                    value={groupFormDescription}
                    onChange={(e) => setGroupFormDescription(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Tags (comma-separated)"
                    value={groupFormTags}
                    onChange={(e) => setGroupFormTags(e.target.value)}
                  />
                  <Box mt={2} display="flex" gap={1}>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={groupFormState === "loading"}
                    >
                      {selectedGroupId == null ? "Create" : "Save changes"}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={resetGroupForm}
                      disabled={groupFormState === "loading"}
                    >
                      Reset
                    </Button>
                    {selectedGroupId != null && (
                      <Button
                        variant="outlined"
                        color="error"
                        onClick={handleDeleteGroup}
                        disabled={groupFormState === "loading"}
                      >
                        Delete
                      </Button>
                    )}
                  </Box>
                  {groupFormMessage && (
                    <Typography
                      variant="body2"
                      color={groupFormState === "error" ? "error" : "textSecondary"}
                      mt={1}
                    >
                      {groupFormMessage}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} md={8}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Groups
                </Typography>
                {groupsState === "error" && groupsError && (
                  <Typography variant="body2" color="error" mb={1}>
                    {groupsError}
                  </Typography>
                )}
                {groups.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    No groups defined yet. Create one using the form on the left.
                  </Typography>
                ) : (
                  <Box sx={{ maxHeight: 200, overflowY: "auto", mb: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Code</TableCell>
                          <TableCell>Name</TableCell>
                          <TableCell>Description</TableCell>
                          <TableCell>Tags</TableCell>
                          <TableCell align="right"># Stocks</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {groups.map((g) => (
                          <TableRow
                            key={g.id}
                            hover
                            selected={selectedGroupId === g.id}
                            onClick={() => void loadGroupDetail(g.id)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell>{g.code}</TableCell>
                            <TableCell>{g.name}</TableCell>
                            <TableCell>{g.description ?? ""}</TableCell>
                            <TableCell>{(g.tags ?? []).join(", ")}</TableCell>
                            <TableCell align="right">{g.stock_count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
                <Box mt={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Group members
                  </Typography>
                  {!selectedGroup ? (
                    <Typography variant="body2" color="textSecondary">
                      Select a group above to view and manage its members.
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="body2" gutterBottom>
                        {selectedGroup.code} – {selectedGroup.name} (
                        {selectedGroup.stock_count} stocks)
                      </Typography>
                      <Box
                        sx={{
                          display: "flex",
                          gap: 1,
                          alignItems: "center",
                          flexWrap: "wrap",
                          mb: 1
                        }}
                      >
                        <TextField
                          select
                          size="small"
                          label="Add stock"
                          value={memberAddStockId}
                          onChange={(e) =>
                            setMemberAddStockId(
                              e.target.value === ""
                                ? ""
                                : Number.parseInt(e.target.value, 10)
                            )
                          }
                          sx={{ minWidth: 220 }}
                        >
                          <MenuItem value="">
                            <em>Select stock</em>
                          </MenuItem>
                          {availableStocksForMembership.map((s) => (
                            <MenuItem key={s.id} value={s.id}>
                              {s.symbol} ({s.exchange})
                            </MenuItem>
                          ))}
                        </TextField>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={handleAddMember}
                          disabled={
                            memberState === "loading" || !memberAddStockId
                          }
                        >
                          Add
                        </Button>
                        <Button
                          variant="outlined"
                          component="label"
                          size="small"
                        >
                          Import from CSV
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            hidden
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                void handleBulkAddMembersFromCsv(file);
                                e.target.value = "";
                              }
                            }}
                          />
                        </Button>
                      </Box>
                      {memberMessage && (
                        <Typography
                          variant="body2"
                          color={memberState === "error" ? "error" : "textSecondary"}
                          gutterBottom
                        >
                          {memberMessage}
                        </Typography>
                      )}
                      {groupBulkImportMessage && (
                        <Typography
                          variant="body2"
                          color={
                            groupBulkImportState === "error"
                              ? "error"
                              : "textSecondary"
                          }
                          gutterBottom
                        >
                          {groupBulkImportMessage}
                        </Typography>
                      )}
                      {selectedGroup.members.length === 0 ? (
                        <Typography variant="body2" color="textSecondary">
                          This group has no members yet.
                        </Typography>
                      ) : (
                        <Box sx={{ maxHeight: 260, overflowY: "auto" }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Symbol</TableCell>
                                <TableCell>Exchange</TableCell>
                                <TableCell>Name</TableCell>
                                <TableCell>Sector</TableCell>
                                <TableCell>Tags</TableCell>
                                <TableCell>Active</TableCell>
                                <TableCell align="right">Actions</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {selectedGroup.members.map((m) => (
                                <TableRow key={m.id}>
                                  <TableCell>{m.symbol}</TableCell>
                                  <TableCell>{m.exchange}</TableCell>
                                  <TableCell>{m.name ?? ""}</TableCell>
                                  <TableCell>{m.sector ?? ""}</TableCell>
                                  <TableCell>{(m.tags ?? []).join(", ")}</TableCell>
                                  <TableCell>{m.is_active ? "Yes" : "No"}</TableCell>
                                  <TableCell align="right">
                                    <Button
                                      size="small"
                                      variant="text"
                                      color="error"
                                      onClick={() => void handleRemoveMember(m.id)}
                                    >
                                      Remove
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      )}
                    </>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );
};
