import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
  MenuItem
} from "@mui/material";
import { useEffect, useState, FormEvent } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";

type Strategy = {
  id: number;
  name: string;
  code: string;
  engine_code: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
  tags: string[] | null;
  linked_sigma_trader_id: string | null;
  linked_tradingview_template: string | null;
  live_ready: boolean | null;
  created_at: string;
  updated_at: string;
};

type StrategyParameter = {
  id: number;
  strategy_id: number;
  label: string;
  params: Record<string, unknown>;
  notes: string | null;
  created_at: string;
};

type FetchState = "idle" | "loading" | "success" | "error";

const API_BASE = "http://127.0.0.1:8000";

// Known engine implementation codes in the backend strategy registry.
// We keep this list here so that users can always create strategies for
// supported engines even if no existing strategy currently uses them.
const KNOWN_ENGINE_CODES = ["SmaCrossStrategy", "ZeroLagTrendMtfStrategy"];

export const StrategiesPage = () => {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [selectedStrategyId, setSelectedStrategyId] = useState<number | null>(
    null
  );
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(
    null
  );
  const [params, setParams] = useState<StrategyParameter[]>([]);

  const [createState, setCreateState] = useState<FetchState>("idle");
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [newEngineCode, setNewEngineCode] = useState("");

  const [editState, setEditState] = useState<FetchState>("idle");
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [isEditingStrategy, setIsEditingStrategy] = useState(false);

  const [engineFilter, setEngineFilter] = useState<string>("all");

  const [paramRegistry, setParamRegistry] = useState<StrategyParameter[]>([]);

  const [selectedStrategyIds, setSelectedStrategyIds] = useState<Set<number>>(
    () => new Set()
  );

  const [baseParamJson, setBaseParamJson] = useState('{"fast": 10, "slow": 30}');
  const [baseParamNotes, setBaseParamNotes] = useState("");
  const [baseParamError, setBaseParamError] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [defaultLabelByStrategy, setDefaultLabelByStrategy] = useState<
    Record<number, string>
  >({});
  const [editingStrategyParamId, setEditingStrategyParamId] = useState<
    number | null
  >(null);
  const [editingParamJson, setEditingParamJson] = useState("");
  const [editingParamNotes, setEditingParamNotes] = useState("");
  const [editingParamError, setEditingParamError] = useState<string | null>(
    null
  );

  const getEngineDefaultParams = (engineCode: string | null) => {
    if (!engineCode) return null;
    if (engineCode === "ZeroLagTrendMtfStrategy") {
      return {
        length: 70,
        mult: 1.2,
        stop_loss_pct: 2.0,
        take_profit_pct: 4.0,
        take_long_only: false,
        pyramid_limit: 2
      } as Record<string, unknown>;
    }
    if (engineCode === "SmaCrossStrategy") {
      return {
        fast: 10,
        slow: 30
      } as Record<string, unknown>;
    }
    return null;
  };

  const getEngineDefaultNotes = (engineCode: string | null) => {
    if (engineCode === "ZeroLagTrendMtfStrategy") {
      return [
        "Zero Lag Trend default parameters:",
        "- length: lookback for the zero-lag EMA (bars).",
        "- mult: volatility band multiplier applied to ATR-based bands.",
        "- stop_loss_pct: percent stop-loss from entry price.",
        "- take_profit_pct: percent take-profit from entry price.",
        "- take_long_only: if true, only long trades are taken.",
        "- pyramid_limit: maximum number of pyramiding additions."
      ].join("\n");
    }
    if (engineCode === "SmaCrossStrategy") {
      return [
        "SMA crossover default parameters:",
        "- fast: period for the fast SMA (bars).",
        "- slow: period for the slow SMA (bars).",
        "Long when fast crosses above slow, flat/short when it crosses below."
      ].join("\n");
    }
    return "";
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

  useEffect(() => {
    const loadStrategies = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/strategies`);
        if (!res.ok) return;
        const data: Strategy[] = await res.json();
        setStrategies(data);
        if (data.length > 0 && selectedStrategyId === null) {
          setSelectedStrategyId(data[0].id);
          setSelectedStrategy(data[0]);
        }
      } catch {
        // ignore; page will show empty state
      }
    };
    loadStrategies();
  }, [selectedStrategyId]);

  const availableEngineCodes = Array.from(
    new Set([
      // Always include known engines from the backend registry so they remain
      // selectable even if there is no existing strategy using them yet.
      ...KNOWN_ENGINE_CODES,
      ...strategies
        .map((s) => s.engine_code)
        .filter((code): code is string => Boolean(code))
    ])
  );

  // Default the new strategy's engine code based on current context:
  // - Use the engine filter when it is specific.
  // - Otherwise, prefer the selected strategy's engine_code.
  // - Fall back to the first known engine or SmaCrossStrategy.
  useEffect(() => {
    if (newEngineCode) return;
    let next = "";
    if (engineFilter !== "all") {
      next = engineFilter;
    } else if (selectedStrategy?.engine_code) {
      next = selectedStrategy.engine_code;
    } else if (availableEngineCodes.length > 0) {
      next = availableEngineCodes[0];
    } else {
      next = "SmaCrossStrategy";
    }
    setNewEngineCode(next);
  }, [engineFilter, selectedStrategy, availableEngineCodes, newEngineCode]);

  const filteredStrategies = strategies.filter(
    (s) =>
      engineFilter === "all" || (s.engine_code ?? "") === engineFilter
  );

  const allFilteredSelected =
    filteredStrategies.length > 0 &&
    filteredStrategies.every((s) => selectedStrategyIds.has(s.id));

  // Whenever the engine for a new strategy changes (including initial
  // defaulting), prefill the base params JSON and notes with sensible
  // engine-specific defaults. Users can then tweak these per strategy.
  useEffect(() => {
    if (!newEngineCode) return;
    const defaults = getEngineDefaultParams(newEngineCode);
    if (defaults) {
      setBaseParamJson(JSON.stringify(defaults, null, 2));
    }
    const notes = getEngineDefaultNotes(newEngineCode);
    setBaseParamNotes(notes);
  }, [newEngineCode]);

  const recomputeDefaultLabels = (all: StrategyParameter[]) => {
    const best: Record<
      number,
      { label: string; created_at: string; is_api_default: boolean }
    > = {};
    all.forEach((p) => {
      const current = best[p.strategy_id];
      const isApi = p.label === "api_default";
      if (!current) {
        best[p.strategy_id] = {
          label: p.label,
          created_at: p.created_at,
          is_api_default: isApi
        };
        return;
      }
      if (current.is_api_default && !isApi) {
        return;
      }
      if (!current.is_api_default && isApi) {
        best[p.strategy_id] = {
          label: p.label,
          created_at: p.created_at,
          is_api_default: true
        };
        return;
      }
      if (!current.is_api_default && !isApi) {
        if (p.created_at < current.created_at) {
          best[p.strategy_id] = {
            label: p.label,
            created_at: p.created_at,
            is_api_default: false
          };
        }
      }
    });
    const map: Record<number, string> = {};
    Object.entries(best).forEach(([strategyId, info]) => {
      map[Number(strategyId)] = info.label;
    });
    setDefaultLabelByStrategy(map);
  };

  useEffect(() => {
    const loadParamRegistry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/params`);
        if (!res.ok) return;
        const data: StrategyParameter[] = await res.json();
        setParamRegistry(data);
        recomputeDefaultLabels(data);
      } catch {
        // ignore
      }
    };
    loadParamRegistry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    recomputeDefaultLabels(paramRegistry);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramRegistry]);

  useEffect(() => {
    const loadParams = async () => {
      if (!selectedStrategyId) {
        setParams([]);
        return;
      }
      try {
        const res = await fetch(
          `${API_BASE}/api/strategies/${selectedStrategyId}/params`
        );
        if (!res.ok) return;
        const data: StrategyParameter[] = await res.json();
        setParams(data);
      } catch {
        // ignore
      }
    };
    loadParams();
  }, [selectedStrategyId]);

  const handleSelectStrategy = (strategy: Strategy) => {
    setSelectedStrategyId(strategy.id);
    setSelectedStrategy(strategy);
    setEditState("idle");
    setEditMessage(null);
    setIsEditingStrategy(false);
    setEditName(strategy.name);
    setEditStatus(strategy.status ?? "");
    setEditCategory(strategy.category ?? "");
    setDetailsOpen(true);
  };

  const handleCreateStrategy = async (event: FormEvent) => {
    event.preventDefault();
    setCreateState("loading");
    setCreateMessage(null);

    try {
      // Determine base parameter set for the new strategy from the JSON field.
      setBaseParamError(null);
      if (!baseParamJson.trim()) {
        setBaseParamError("Provide params JSON for the base parameter set.");
        setCreateState("error");
        setCreateMessage("Missing params JSON for new strategy.");
        return;
      }
      let baseParams: Record<string, unknown>;
      try {
        baseParams = JSON.parse(baseParamJson) as Record<string, unknown>;
      } catch (error) {
        const msg =
          error instanceof Error
            ? error.message
            : "Invalid JSON for base parameters";
        setBaseParamError(msg);
        setCreateState("error");
        setCreateMessage(msg);
        return;
      }
      const baseNotes: string | null = baseParamNotes || null;

      const engineCode = newEngineCode.trim();
      if (!engineCode) {
        setCreateState("error");
        setCreateMessage(
          "Engine code is required. Choose an existing engine or type one (e.g. SmaCrossStrategy)."
        );
        return;
      }

      const name = newName.trim();
      if (!name) {
        setCreateState("error");
        setCreateMessage("Name is required for a new strategy.");
        return;
      }

      // Derive a code from the name by uppercasing and normalising to
      // alphanumeric + underscore. This keeps the internal identifier stable
      // without requiring the user to manage it explicitly.
      const baseCode = name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      const code = baseCode || "STRATEGY";
      const baseLabel = `${code.toLowerCase()}_default`;

      const payload = {
        name,
        code,
        category: newCategory || null,
        description: null,
        status: "experimental",
        tags: null,
        linked_sigma_trader_id: null,
        linked_tradingview_template: null,
        live_ready: false,
        engine_code: engineCode
      };

      const res = await fetch(`${API_BASE}/api/strategies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCreateState("error");
        setCreateMessage(err.detail ?? "Failed to create strategy");
        return;
      }

      const created: Strategy = await res.json();
      setStrategies((prev) => [...prev, created]);
      // Create base parameter set for the new strategy.
      const paramPayload = {
        label: baseLabel,
        params: baseParams,
        notes: baseNotes
      };
      const paramRes = await fetch(
        `${API_BASE}/api/strategies/${created.id}/params`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paramPayload)
        }
      );
      if (paramRes.ok) {
        const createdParam: StrategyParameter = await paramRes.json();
        setParamRegistry((prev) => [...prev, createdParam]);
        if (created.id === selectedStrategyId) {
          setParams((prev) => [...prev, createdParam]);
        }
      }
      setSelectedStrategyId(created.id);
      setSelectedStrategy(created);
      setCreateState("success");
      setCreateMessage(`Strategy '${created.name}' created.`);
      setNewName("");
      setNewCategory("");
      setNewEngineCode(engineCode);
    } catch (error) {
      setCreateState("error");
      setCreateMessage(
        error instanceof Error ? error.message : "Unexpected error occurred"
      );
    }
  };

  const handleDeleteParam = async (paramId: number) => {
    if (!window.confirm("Delete this parameter set?")) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/params/${paramId}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        return;
      }
      setParams((prev) => prev.filter((p) => p.id !== paramId));
      setParamRegistry((prev) => prev.filter((p) => p.id !== paramId));
    } catch {
      // ignore; UI will remain unchanged on failure
    }
  };

  const handleStartEditStrategyParam = (param: StrategyParameter) => {
    setEditingStrategyParamId(param.id);
    setEditingParamError(null);
    setEditingParamJson(JSON.stringify(param.params, null, 2));
    setEditingParamNotes(param.notes ?? "");
  };

  const handleSaveStrategyParamEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStrategy || editingStrategyParamId === null) {
      return;
    }
    if (!editingParamJson.trim()) {
      setEditingParamError("Provide params JSON for this parameter set.");
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editingParamJson) as Record<string, unknown>;
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Invalid JSON for parameters";
      setEditingParamError(msg);
      return;
    }

    setEditingParamError(null);
    const payload = {
      params: parsed,
      notes: editingParamNotes || null
    };

    try {
      const res = await fetch(
        `${API_BASE}/api/params/${editingStrategyParamId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg =
          err.detail ?? "Failed to update parameter set for this strategy.";
        setEditingParamError(msg);
        return;
      }

      const updated: StrategyParameter = await res.json();
      setParams((prev) =>
        prev.map((p) =>
          p.id === editingStrategyParamId ? updated : p
        )
      );
      setParamRegistry((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p))
      );
      setEditingStrategyParamId(null);
      setEditingParamJson("");
      setEditingParamNotes("");
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Unexpected error while saving parameter set.";
      setEditingParamError(msg);
    }
  };

  const handleStartEditStrategy = () => {
    if (!selectedStrategy) return;
    setIsEditingStrategy(true);
    setEditName(selectedStrategy.name);
    setEditStatus(selectedStrategy.status ?? "");
    setEditCategory(selectedStrategy.category ?? "");
    setEditState("idle");
    setEditMessage(null);
  };

  const handleCancelEditStrategy = () => {
    if (!selectedStrategy) return;
    setIsEditingStrategy(false);
    setEditName(selectedStrategy.name);
    setEditStatus(selectedStrategy.status ?? "");
    setEditCategory(selectedStrategy.category ?? "");
    setEditState("idle");
    setEditMessage(null);
  };

  const handleSaveStrategy = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStrategy) return;
    setEditState("loading");
    setEditMessage(null);

    try {
      const payload = {
        name: editName,
        status: editStatus || null,
        category: editCategory || null
      };
      const res = await fetch(
        `${API_BASE}/api/strategies/${selectedStrategy.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setEditState("error");
        setEditMessage(err.detail ?? "Failed to update strategy");
        return;
      }
      const updated: Strategy = await res.json();
      setStrategies((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
      setSelectedStrategy(updated);
      setIsEditingStrategy(false);
      setEditState("success");
      setEditMessage("Strategy updated.");
    } catch (error) {
      setEditState("error");
      setEditMessage(
        error instanceof Error ? error.message : "Unexpected error occurred"
      );
    }
  };

  const handleDeleteStrategy = async () => {
    if (!selectedStrategy) return;
    if (
      !window.confirm(
        `Delete strategy '${selectedStrategy.code}' and all its parameter sets?`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(
        `${API_BASE}/api/strategies/${selectedStrategy.id}`,
        {
          method: "DELETE"
        }
      );
      if (!res.ok && res.status !== 204) {
        return;
      }
      setStrategies((prev) =>
        prev.filter((s) => s.id !== selectedStrategy.id)
      );
      setSelectedStrategy(null);
      setSelectedStrategyId(null);
      setParams([]);
      setIsEditingStrategy(false);
      setEditMessage(null);
    } catch {
      // ignore; UI will remain unchanged on failure
    }
  };

  const handleToggleStrategySelection = (id: number) => {
    setSelectedStrategyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleToggleSelectStrategiesOnPage = () => {
    const idsOnPage = filteredStrategies.map((s) => s.id);
    setSelectedStrategyIds((prev) => {
      const next = new Set(prev);
      const everySelected = idsOnPage.every((id) => next.has(id));
      if (everySelected) {
        idsOnPage.forEach((id) => next.delete(id));
      } else {
        idsOnPage.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleDeleteSelectedStrategies = async () => {
    if (selectedStrategyIds.size === 0) {
      return;
    }
    if (
      !window.confirm(
        `Delete ${selectedStrategyIds.size} strategy/strategies? This cannot be undone.`
      )
    ) {
      return;
    }

    const ids = Array.from(selectedStrategyIds);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${API_BASE}/api/strategies/${id}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204 && res.status !== 404) {
        // eslint-disable-next-line no-alert
        window.alert(`Failed to delete strategy ${id}: HTTP ${res.status}`);
        break;
      }
    }

    setStrategies((prev) => prev.filter((s) => !selectedStrategyIds.has(s.id)));
    setParamRegistry((prev) =>
      prev.filter((p) => !selectedStrategyIds.has(p.strategy_id))
    );
    setSelectedStrategyIds(new Set());
    if (selectedStrategy && selectedStrategyIds.has(selectedStrategy.id)) {
      setSelectedStrategy(null);
      setSelectedStrategyId(null);
      setParams([]);
      setDetailsOpen(false);
    }
  };

  return (
    <Box>
      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  New Strategy
                </Typography>
                <Box component="form" onSubmit={handleCreateStrategy} noValidate>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Category"
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                  />
                  <TextField
                    select
                    fullWidth
                    margin="normal"
                    label="Engine"
                    value={newEngineCode}
                    onChange={(e) => {
                      const engine = e.target.value;
                      setNewEngineCode(engine);
                      setBaseParamError(null);
                    }}
                    helperText="Select the underlying strategy engine (required)"
                  >
                    {availableEngineCodes.length > 0 ? (
                      availableEngineCodes.map((engine) => (
                        <MenuItem key={engine} value={engine}>
                          {engine}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem value="SmaCrossStrategy">
                        SmaCrossStrategy
                      </MenuItem>
                    )}
                  </TextField>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Base params JSON"
                    value={baseParamJson}
                    onChange={(e) => setBaseParamJson(e.target.value)}
                    multiline
                    minRows={4}
                    error={Boolean(baseParamError)}
                    helperText={
                      baseParamError ??
                      "Defaults are derived from the selected engine; you can tweak them per strategy."
                    }
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Base params notes"
                    value={baseParamNotes}
                    onChange={(e) => setBaseParamNotes(e.target.value)}
                    multiline
                    minRows={4}
                    helperText="Use this to describe the strategy idea, how parameters are interpreted, and any usage notes."
                  />
                  <Box mt={2}>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={createState === "loading"}
                    >
                      {createState === "loading" ? "Creating..." : "Create"}
                    </Button>
                  </Box>
                  {createMessage && (
                    <Typography
                      variant="body2"
                      color={
                        createState === "error" ? "error" : "textSecondary"
                      }
                      mt={1}
                    >
                      {createMessage}
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
                <Typography variant="h6">Strategies</Typography>
                <Box
                  sx={{
                    display: "flex",
                    gap: 1,
                    flexWrap: "wrap"
                  }}
                >
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleToggleSelectStrategiesOnPage}
                    disabled={filteredStrategies.length === 0}
                  >
                    {allFilteredSelected ? "Unselect page" : "Select page"}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="error"
                    onClick={handleDeleteSelectedStrategies}
                    disabled={selectedStrategyIds.size === 0}
                  >
                    Delete selected
                  </Button>
                </Box>
              </Box>
              {availableEngineCodes.length > 0 && (
                <Box sx={{ mb: 1 }}>
                  <TextField
                    select
                    size="small"
                    label="Engine filter"
                    value={engineFilter}
                    onChange={(e) => setEngineFilter(e.target.value)}
                    sx={{ minWidth: 200 }}
                  >
                    <MenuItem value="all">All engines</MenuItem>
                    {availableEngineCodes.map((code) => (
                      <MenuItem key={code} value={code}>
                        {code}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
              )}
              {strategies.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No strategies yet. Use the form on the left to add one.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell />
                      <TableCell>Name</TableCell>
                      <TableCell>Engine</TableCell>
                      <TableCell>Params</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Category</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredStrategies.map((s) => (
                      <TableRow
                        key={s.id}
                        hover
                        selected={selectedStrategyId === s.id}
                        onClick={() => handleSelectStrategy(s)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell padding="checkbox">
                          <input
                            type="checkbox"
                            checked={selectedStrategyIds.has(s.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleStrategySelection(s.id);
                            }}
                          />
                        </TableCell>
                        <TableCell>{s.name}</TableCell>
                        <TableCell>{s.engine_code ?? ""}</TableCell>
                        <TableCell>
                          {defaultLabelByStrategy[s.id] ?? ""}
                        </TableCell>
                        <TableCell>{s.status ?? ""}</TableCell>
                        <TableCell>{s.category ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {selectedStrategy && (
        <Dialog
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          fullWidth
          maxWidth="lg"
        >
          <DialogTitle>
            Strategy Details – {selectedStrategy.name} ({selectedStrategy.code})
          </DialogTitle>
          <DialogContent dividers>
            <Box>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
              >
                <Box>
                  {selectedStrategy.engine_code && (
                    <Typography
                      variant="body2"
                      color="textSecondary"
                      sx={{ mb: 1 }}
                    >
                      Engine: {selectedStrategy.engine_code}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} mt={1} mb={1}>
                    {selectedStrategy.status && (
                      <Chip label={selectedStrategy.status} size="small" />
                    )}
                    {selectedStrategy.category && (
                      <Chip label={selectedStrategy.category} size="small" />
                    )}
                    {selectedStrategy.live_ready && (
                      <Chip label="Live-ready" color="success" size="small" />
                    )}
                  </Stack>
                </Box>
                <Box>
                  <Button
                    size="small"
                    sx={{ mr: 1 }}
                    variant="outlined"
                    onClick={handleStartEditStrategy}
                  >
                    Edit
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    variant="outlined"
                    onClick={handleDeleteStrategy}
                  >
                    Delete
                  </Button>
                </Box>
              </Box>
              {isEditingStrategy && (
                <Box
                  component="form"
                  onSubmit={handleSaveStrategy}
                  noValidate
                  mt={2}
                >
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6}>
                      <TextField
                        fullWidth
                        label="Name"
                        margin="dense"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        fullWidth
                        label="Status"
                        margin="dense"
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                      />
                    </Grid>
                    <Grid item xs={12} sm={3}>
                      <TextField
                        fullWidth
                        label="Category"
                        margin="dense"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                      />
                    </Grid>
                  </Grid>
                  <Box mt={1}>
                    <Button
                      type="submit"
                      size="small"
                      variant="contained"
                      sx={{ mr: 1 }}
                      disabled={editState === "loading"}
                    >
                      {editState === "loading" ? "Saving..." : "Save"}
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      onClick={handleCancelEditStrategy}
                    >
                      Cancel
                    </Button>
                  </Box>
                  {editMessage && (
                    <Typography
                      variant="body2"
                      color={editState === "error" ? "error" : "textSecondary"}
                      mt={1}
                    >
                      {editMessage}
                    </Typography>
                  )}
                </Box>
              )}
              {selectedStrategy.description && (
                <Typography variant="body2" paragraph>
                  {selectedStrategy.description}
                </Typography>
              )}
              {selectedStrategy.tags && selectedStrategy.tags.length > 0 && (
                <Box mb={2}>
                  <Typography variant="subtitle2">Tags</Typography>
                  <Stack direction="row" spacing={1} mt={0.5}>
                    {selectedStrategy.tags.map((tag) => (
                      <Chip key={tag} label={tag} size="small" />
                    ))}
                  </Stack>
                </Box>
              )}
              {(selectedStrategy.linked_sigma_trader_id ||
                selectedStrategy.linked_tradingview_template) && (
                <Box mb={2}>
                  <Typography variant="subtitle2">
                    Integration metadata
                  </Typography>
                  {selectedStrategy.linked_sigma_trader_id && (
                    <Typography variant="body2">
                      SigmaTrader ID: {selectedStrategy.linked_sigma_trader_id}
                    </Typography>
                  )}
                  {selectedStrategy.linked_tradingview_template && (
                    <Typography variant="body2">
                      TradingView template:{" "}
                      {selectedStrategy.linked_tradingview_template}
                    </Typography>
                  )}
                </Box>
              )}

              <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                  Parameters
                </Typography>
                {params.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    No parameter sets yet for this strategy.
                  </Typography>
                ) : (
                  <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Label</TableCell>
                            <TableCell>Params</TableCell>
                            <TableCell>Notes</TableCell>
                            <TableCell>Created</TableCell>
                            <TableCell align="right">Actions</TableCell>
                          </TableRow>
                        </TableHead>
                    <TableBody>
                          {Array.from(
                            new Map(
                              params.map((p) => [p.label, p])
                            ).values()
                          ).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.label}</TableCell>
                          <TableCell>
                            <code>
                              {JSON.stringify(p.params, null, 0).slice(0, 80)}
                              {JSON.stringify(p.params, null, 0).length >
                                80 && "..."}
                            </code>
                          </TableCell>
                          <TableCell>
                            {p.notes && p.notes.length > 0 ? p.notes : "\u00a0"}
                          </TableCell>
                          <TableCell>
                            {formatDateTime(p.created_at)}
                          </TableCell>
                              <TableCell align="right">
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() =>
                                    handleStartEditStrategyParam(p)
                                  }
                                  sx={{ mr: 1 }}
                                >
                                  Edit
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="text"
                              onClick={() => handleDeleteParam(p.id)}
                            >
                              Delete
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>

              {editingStrategyParamId !== null && (
                <Box
                  component="form"
                  onSubmit={handleSaveStrategyParamEdit}
                  mt={2}
                >
                  <Typography variant="subtitle2" gutterBottom>
                    Edit parameter JSON
                  </Typography>
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Params JSON"
                    value={editingParamJson}
                    onChange={(e) => setEditingParamJson(e.target.value)}
                    multiline
                    minRows={3}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Notes"
                    value={editingParamNotes}
                    onChange={(e) => setEditingParamNotes(e.target.value)}
                  />
                  {editingParamError && (
                    <Typography variant="body2" color="error" mt={1}>
                      {editingParamError}
                    </Typography>
                  )}
                  <Box mt={2}>
                    <Button
                      type="submit"
                      variant="contained"
                      size="small"
                      sx={{ mr: 1 }}
                    >
                      Save
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        setEditingStrategyParamId(null);
                        setEditingParamJson("");
                        setEditingParamNotes("");
                        setEditingParamError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </Box>
                </Box>
              )}

              {/* Parameter creation is now handled via the global parameter
                  registry card in the left column. */}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDetailsOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};
