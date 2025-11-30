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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { DataGrid, type GridColDef, type GridSelectionModel } from "@mui/x-data-grid";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

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
  const [selectedStockIds, setSelectedStockIds] = useState<number[]>([]);
  const [selectedStockId, setSelectedStockId] = useState<number | null>(null);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);

  const [stockFormSymbol, setStockFormSymbol] = useState("");
  const [stockFormExchange, setStockFormExchange] = useState("NSE");
  const [stockFormSegment, setStockFormSegment] = useState("");
  const [stockFormName, setStockFormName] = useState("");
  const [stockFormSector, setStockFormSector] = useState("");
  const [stockFormTags, setStockFormTags] = useState("");
  const [stockFormActive, setStockFormActive] = useState(true);
  const [stockFormState, setStockFormState] = useState<FetchState>("idle");
  const [stockFormMessage, setStockFormMessage] = useState<string | null>(null);

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
  const [groupPortfolioDialogOpen, setGroupPortfolioDialogOpen] =
    useState(false);
  const [addFromUniverseOpen, setAddFromUniverseOpen] = useState(false);
  const [universeSelectionForGroup, setUniverseSelectionForGroup] = useState<
    number[]
  >([]);

  const [memberAddStockId, setMemberAddStockId] = useState<number | "">("");
  const [memberState, setMemberState] = useState<FetchState>("idle");
  const [memberMessage, setMemberMessage] = useState<string | null>(null);
  const [groupBulkImportState, setGroupBulkImportState] =
    useState<FetchState>("idle");
  const [groupBulkImportMessage, setGroupBulkImportMessage] = useState<
    string | null
  >(null);

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

  const handleTabChange = (_: unknown, value: TabId) => {
    const params = new URLSearchParams(location.search);
    params.set("tab", value);
    if (value !== "groups") {
      params.delete("group");
    } else if (selectedGroup) {
      params.set("group", selectedGroup.code);
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
    navigate(`/stocks?${params.toString()}`);
  };

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
    [stocks, showInactive, exchangeFilter, sectorFilter, searchText]
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

  const universeColumns: GridColDef[] = [
    {
      field: "symbol",
      headerName: "Symbol",
      flex: 1,
      minWidth: 120
    },
    {
      field: "exchange",
      headerName: "Exchange",
      width: 100
    },
    {
      field: "segment",
      headerName: "Segment",
      width: 130,
      valueGetter: (params) => params?.row?.segment ?? ""
    },
    {
      field: "name",
      headerName: "Name",
      flex: 1.5,
      minWidth: 160,
      valueGetter: (params) => params?.row?.name ?? ""
    },
    {
      field: "sector",
      headerName: "Sector",
      flex: 1,
      minWidth: 140,
      valueGetter: (params) => params?.row?.sector ?? ""
    },
    {
      field: "tags",
      headerName: "Tags",
      flex: 1,
      minWidth: 160,
      valueGetter: (params) => (params?.row?.tags ?? []).join(", ")
    },
    {
      field: "is_active",
      headerName: "Active",
      width: 90,
      valueFormatter: (params) => (params.value ? "Yes" : "No")
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

  useEffect(() => {
    if (tab !== "groups" || !deepLinkGroupCode || groups.length === 0) {
      return;
    }
    const match = groups.find(
      (g) => g.code.toUpperCase() === deepLinkGroupCode.toUpperCase()
    );
    if (match && match.id !== selectedGroupId) {
      void loadGroupDetail(match.id);
    }
  }, [tab, deepLinkGroupCode, groups, selectedGroupId]);

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

  const handleImportGroupFromPortfolioCsv = async (file: File) => {
    if (!selectedGroupId) {
      // eslint-disable-next-line no-alert
      window.alert("Save and select a group before importing a portfolio CSV.");
      return;
    }
    const code = groupFormCode.trim().toUpperCase();
    const name = groupFormName.trim();
    if (!code || !name) {
      // eslint-disable-next-line no-alert
      window.alert("Group code and name are required before importing.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("group_code", code);
    formData.append("group_name", name);
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
        summary.errors?.length ? `Errors: ${summary.errors.length}` : null
      ]
        .filter(Boolean)
        .join(", ");
      // eslint-disable-next-line no-alert
      window.alert(msg);

      // Refresh this group's detail to reflect new members.
      await loadGroupDetail(selectedGroupId);
    } catch (error) {
      // eslint-disable-next-line no-alert
      window.alert(
        error instanceof Error
          ? error.message
          : "Unexpected error during portfolio import."
      );
    } finally {
      setGroupPortfolioDialogOpen(false);
    }
  };

  const handleConfirmAddFromUniverse = async () => {
    if (!selectedGroup || universeSelectionForGroup.length === 0) {
      setAddFromUniverseOpen(false);
      setUniverseSelectionForGroup([]);
      return;
    }
    const symbols = stocks
      .filter((s) => universeSelectionForGroup.includes(s.id))
      .map((s) => s.symbol);
    if (symbols.length === 0) {
      setAddFromUniverseOpen(false);
      setUniverseSelectionForGroup([]);
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/api/stock-groups/${selectedGroup.code}/members/bulk-add`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols })
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // eslint-disable-next-line no-alert
        window.alert(
          (err as { detail?: string }).detail ??
            "Failed to add members from universe."
        );
        return;
      }
      const summary = await res.json();
      // eslint-disable-next-line no-alert
      window.alert(
        `Added ${summary.added ?? universeSelectionForGroup.length} member(s) from universe.`
      );
      await loadGroupDetail(selectedGroup.id);
    } catch (error) {
      // eslint-disable-next-line no-alert
      window.alert(
        error instanceof Error
          ? error.message
          : "Unexpected error while adding from universe."
      );
    } finally {
      setAddFromUniverseOpen(false);
      setUniverseSelectionForGroup([]);
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
        <>
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
                      {selectedGroupId != null && (
                        <Button
                          variant="outlined"
                          onClick={() => setGroupPortfolioDialogOpen(true)}
                          disabled={groupFormState === "loading"}
                        >
                          Import portfolio CSV…
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
                            size="small"
                            onClick={() => setAddFromUniverseOpen(true)}
                            disabled={!selectedGroup}
                          >
                            Add from universe…
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

          <Dialog
            open={groupPortfolioDialogOpen}
            onClose={() => setGroupPortfolioDialogOpen(false)}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>Import group from portfolio CSV</DialogTitle>
            <DialogContent
              sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}
            >
              <Typography variant="body2" color="text.secondary">
                Upload a portfolio CSV to populate group{" "}
                <strong>{groupFormCode || selectedGroup?.code}</strong>. Existing
                members will be kept; new symbols will be added.
              </Typography>
              <Button
                variant="outlined"
                component="label"
                size="small"
                disabled={!selectedGroupId}
              >
                Upload CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleImportGroupFromPortfolioCsv(file);
                      e.target.value = "";
                    }
                  }}
                />
              </Button>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setGroupPortfolioDialogOpen(false)}>
                Close
              </Button>
            </DialogActions>
          </Dialog>

          <Dialog
            open={addFromUniverseOpen}
            onClose={() => {
              setAddFromUniverseOpen(false);
              setUniverseSelectionForGroup([]);
            }}
            maxWidth="md"
            fullWidth
          >
            <DialogTitle>Add members from universe</DialogTitle>
            <DialogContent sx={{ mt: 1 }}>
              {!selectedGroup ? (
                <Typography variant="body2" color="text.secondary">
                  Select a group first to add members.
                </Typography>
              ) : filteredStocks.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Universe is empty. Add stocks in the Universe tab first.
                </Typography>
              ) : (
                <div style={{ width: "100%", height: 420 }}>
                  <DataGrid
                    rows={availableStocksForMembership}
                    columns={[
                      {
                        field: "symbol",
                        headerName: "Symbol",
                        flex: 1,
                        minWidth: 120
                      },
                      {
                        field: "exchange",
                        headerName: "Exchange",
                        width: 110
                      },
                      {
                        field: "sector",
                        headerName: "Sector",
                        flex: 1,
                        minWidth: 140,
                        valueGetter: (params) => params?.row?.sector ?? ""
                      },
                      {
                        field: "name",
                        headerName: "Name",
                        flex: 1.5,
                        minWidth: 180,
                        valueGetter: (params) => params?.row?.name ?? ""
                      }
                    ]}
                    density="compact"
                    checkboxSelection
                    pageSizeOptions={[10, 25, 50]}
                    getRowId={(row) => row.id}
                    rowSelectionModel={universeSelectionForGroup}
                    onRowSelectionModelChange={(selection: GridSelectionModel) =>
                      setUniverseSelectionForGroup(selection as number[])
                    }
                  />
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => {
                  setAddFromUniverseOpen(false);
                  setUniverseSelectionForGroup([]);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                disabled={
                  !selectedGroup || universeSelectionForGroup.length === 0
                }
                onClick={() => void handleConfirmAddFromUniverse()}
              >
                Add selected
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Box>
  );
};
