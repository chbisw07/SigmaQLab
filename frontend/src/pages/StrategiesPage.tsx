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
  const [newCode, setNewCode] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const [editState, setEditState] = useState<FetchState>("idle");
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [isEditingStrategy, setIsEditingStrategy] = useState(false);

  const [engineFilter, setEngineFilter] = useState<string>("all");

  const [paramState, setParamState] = useState<FetchState>("idle");
  const [paramMessage, setParamMessage] = useState<string | null>(null);
  const [newParamLabel, setNewParamLabel] = useState("");
  const [newParamJson, setNewParamJson] = useState('{"fast": 10, "slow": 30}');
  const [newParamNotes, setNewParamNotes] = useState("");
  const [editingParamId, setEditingParamId] = useState<number | null>(null);

  const [paramRegistry, setParamRegistry] = useState<StrategyParameter[]>([]);
  const [baseParamLabel, setBaseParamLabel] = useState<string>("");
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
  const [strategyParamEditLabel, setStrategyParamEditLabel] =
    useState<string>("");
  const [strategyParamEditError, setStrategyParamEditError] = useState<
    string | null
  >(null);

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
    new Set(
      strategies
        .map((s) => s.engine_code)
        .filter((code): code is string => Boolean(code))
    )
  );

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
        if (!baseParamLabel && data.length > 0) {
          // Default to first distinct label.
          const first = data[0];
          setBaseParamLabel(first.label);
          setBaseParamJson(JSON.stringify(first.params, null, 2));
          setBaseParamNotes(first.notes ?? "");
        }
      } catch {
        // ignore
      }
    };
    loadParamRegistry();
    // we only want to run on mount; baseParamLabel defaulting is guarded
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
    setParamState("idle");
    setParamMessage(null);
    setEditState("idle");
    setEditMessage(null);
    setIsEditingStrategy(false);
    setEditName(strategy.name);
    setEditStatus(strategy.status ?? "");
    setEditCategory(strategy.category ?? "");
    setEditingParamId(null);
    setDetailsOpen(true);
  };

  const handleCreateStrategy = async (event: FormEvent) => {
    event.preventDefault();
    setCreateState("loading");
    setCreateMessage(null);

    try {
      // Determine base parameter set for the new strategy.
      setBaseParamError(null);
      let baseLabel: string | null = null;
      let baseParams: Record<string, unknown> | null = null;
      let baseNotes: string | null = null;

      if (baseParamLabel) {
        const template = paramRegistry.find((p) => p.label === baseParamLabel);
        if (!template) {
          setCreateState("error");
          setCreateMessage(
            `Selected base params label '${baseParamLabel}' not found in registry.`
          );
          return;
        }
        baseLabel = template.label;
        baseParams = template.params;
        baseNotes = template.notes;
      } else {
        // User must supply a new label + JSON.
        if (!baseParamJson.trim()) {
          setBaseParamError("Provide params JSON for the new base parameter set.");
          setCreateState("error");
          setCreateMessage("Missing params JSON for new strategy.");
          return;
        }
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(baseParamJson) as Record<string, unknown>;
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
        baseLabel = (newParamLabel || "default").trim();
        baseParams = parsed;
        baseNotes = baseParamNotes || null;
      }

      if (!baseLabel || !baseParams) {
        setCreateState("error");
        setCreateMessage("Base parameter set is required for new strategies.");
        return;
      }

      const engineCode =
        engineFilter !== "all"
          ? engineFilter
          : selectedStrategy?.engine_code ?? "SmaCrossStrategy";

      const payload = {
        name: newName,
        code: newCode,
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
      setCreateMessage(`Strategy '${created.code}' created.`);
      setNewName("");
      setNewCode("");
      setNewCategory("");
    } catch (error) {
      setCreateState("error");
      setCreateMessage(
        error instanceof Error ? error.message : "Unexpected error occurred"
      );
    }
  };

  const handleCreateParam = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedStrategyId) {
      setParamState("error");
      setParamMessage("Select a strategy first.");
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(newParamJson) as Record<string, unknown>;
    } catch (error) {
      setParamState("error");
      setParamMessage(
        error instanceof Error ? error.message : "Invalid JSON for params"
      );
      return;
    }

    setParamState("loading");
    setParamMessage(null);

    try {
      const payload = {
        label: newParamLabel || "default",
        params: parsed,
        notes: newParamNotes || null
      };

      const url =
        editingParamId === null
          ? `${API_BASE}/api/strategies/${selectedStrategyId}/params`
          : `${API_BASE}/api/params/${editingParamId}`;
      const method = editingParamId === null ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setParamState("error");
        setParamMessage(
          err.detail ??
            (editingParamId === null
              ? "Failed to create parameter set"
              : "Failed to update parameter set")
        );
        return;
      }

      const created: StrategyParameter = await res.json();
      if (editingParamId === null) {
        setParams((prev) => [...prev, created]);
        setParamRegistry((prev) => [...prev, created]);
        setParamMessage(`Parameter set '${created.label}' created.`);
      } else {
        setParams((prev) =>
          prev.map((p) => (p.id === editingParamId ? created : p))
        );
        setParamRegistry((prev) =>
          prev.map((p) => (p.id === created.id ? created : p))
        );
        setParamMessage(`Parameter set '${created.label}' updated.`);
      }
      setParamState("success");
      setNewParamLabel("");
      setNewParamNotes("");
      setEditingParamId(null);
    } catch (error) {
      setParamState("error");
      setParamMessage(
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
      if (editingParamId === paramId) {
        setEditingParamId(null);
        setNewParamLabel("");
        setNewParamNotes("");
        setNewParamJson('{"fast": 10, "slow": 30}');
      }
    } catch {
      // ignore; UI will remain unchanged on failure
    }
  };

  const handleStartEditStrategyParam = (param: StrategyParameter) => {
    setEditingStrategyParamId(param.id);
    setStrategyParamEditError(null);
    // Preselect matching label if present in registry.
    const hasTemplate = paramRegistry.some((p) => p.label === param.label);
    setStrategyParamEditLabel(hasTemplate ? param.label : "");
  };

  const handleApplyStrategyParamTemplate = async (
    event: FormEvent
  ) => {
    event.preventDefault();
    if (!selectedStrategy || editingStrategyParamId === null) {
      return;
    }
    const label = strategyParamEditLabel.trim();
    if (!label) {
      setStrategyParamEditError("Choose a parameter label from the registry.");
      return;
    }
    const template = paramRegistry.find((p) => p.label === label);
    if (!template) {
      setStrategyParamEditError(
        `Label '${label}' not found in parameter registry.`
      );
      return;
    }

    setStrategyParamEditError(null);

    const payload = {
      label: template.label,
      params: template.params,
      notes: template.notes
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
          err.detail ??
          "Failed to apply parameter template. Check for duplicate labels.";
        setStrategyParamEditError(msg);
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
      setStrategyParamEditLabel("");
    } catch (error) {
      const msg =
        error instanceof Error
          ? error.message
          : "Unexpected error while applying parameter template.";
      setStrategyParamEditError(msg);
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

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Strategy Library
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Strategies
              </Typography>
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
                  No strategies yet. Use the form below to add one.
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Code</TableCell>
                      <TableCell>Engine</TableCell>
                      <TableCell>Params</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Category</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {strategies
                      .filter(
                        (s) =>
                          engineFilter === "all" ||
                          (s.engine_code ?? "") === engineFilter
                      )
                      .map((s) => (
                      <TableRow
                        key={s.id}
                        hover
                        selected={selectedStrategyId === s.id}
                        onClick={() => handleSelectStrategy(s)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>{s.name}</TableCell>
                        <TableCell>{s.code}</TableCell>
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

          <Box mt={3}>
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
                    label="Code"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value.toUpperCase())}
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
                    label="Base params label"
                    helperText="Select existing params label or leave blank to define new"
                    value={baseParamLabel}
                    onChange={(e) => {
                      const label = e.target.value;
                      setBaseParamLabel(label);
                      setBaseParamError(null);
                      if (label) {
                        const tmpl = paramRegistry.find((p) => p.label === label);
                        if (tmpl) {
                          setBaseParamJson(JSON.stringify(tmpl.params, null, 2));
                          setBaseParamNotes(tmpl.notes ?? "");
                        }
                      }
                    }}
                  >
                    <MenuItem value="">(Define new parameters)</MenuItem>
                    {Array.from(
                      new Map(
                        paramRegistry.map((p) => [p.label, p])
                      ).values()
                    ).map((p) => (
                      <MenuItem key={p.id} value={p.label}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {!baseParamLabel && (
                    <>
                      <TextField
                        fullWidth
                        margin="normal"
                        label="New base params label"
                        value={newParamLabel}
                        onChange={(e) => setNewParamLabel(e.target.value)}
                      />
                      <TextField
                        fullWidth
                        margin="normal"
                        label="New base params JSON"
                        value={baseParamJson}
                        onChange={(e) => setBaseParamJson(e.target.value)}
                        multiline
                        minRows={3}
                        error={Boolean(baseParamError)}
                        helperText={baseParamError ?? undefined}
                      />
                      <TextField
                        fullWidth
                        margin="normal"
                        label="New base params notes"
                        value={baseParamNotes}
                        onChange={(e) => setBaseParamNotes(e.target.value)}
                      />
                    </>
                  )}
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
          </Box>

          <Box mt={3}>
            <Card>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Parameter Registry
                </Typography>
                {paramRegistry.length === 0 ? (
                  <Typography variant="body2" color="textSecondary">
                    No parameters yet. Create a parameter set using the form
                    below (attached to the currently selected strategy) and it
                    will appear here for reuse.
                  </Typography>
                ) : (
                  <Table size="small" sx={{ mb: 2 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Label</TableCell>
                        <TableCell>Params</TableCell>
                        <TableCell>Notes (sample)</TableCell>
                        <TableCell align="right">Strategies</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {Array.from(
                        paramRegistry.reduce((map, p) => {
                          const existing = map.get(p.label);
                          if (!existing) {
                            map.set(p.label, {
                              label: p.label,
                              params: p.params,
                              notes: p.notes,
                              strategies: new Set<number>([p.strategy_id])
                            });
                          } else {
                            existing.strategies.add(p.strategy_id);
                          }
                          return map;
                        }, new Map<string, { label: string; params: Record<string, unknown>; notes: string | null; strategies: Set<number> }>())
                      ).map(([label, info]) => (
                        <TableRow key={label}>
                          <TableCell>{label}</TableCell>
                          <TableCell>
                            <code>
                              {JSON.stringify(info.params, null, 0).slice(0, 80)}
                              {JSON.stringify(info.params, null, 0).length >
                                80 && "..."}
                            </code>
                          </TableCell>
                          <TableCell>
                            {info.notes && info.notes.length > 0
                              ? info.notes
                              : "\u00a0"}
                          </TableCell>
                          <TableCell align="right">
                            {info.strategies.size}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                <Typography variant="subtitle1" gutterBottom>
                  New Parameter Template
                </Typography>
                <Typography variant="body2" color="textSecondary">
                  New templates are attached to the currently selected strategy
                  and become available for reuse when creating other strategies.
                </Typography>
                <Box
                  component="form"
                  onSubmit={handleCreateParam}
                  noValidate
                  mt={1}
                >
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Label"
                    value={newParamLabel}
                    onChange={(e) => setNewParamLabel(e.target.value)}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Params JSON"
                    value={newParamJson}
                    onChange={(e) => setNewParamJson(e.target.value)}
                    multiline
                    minRows={3}
                  />
                  <TextField
                    fullWidth
                    margin="normal"
                    label="Notes"
                    value={newParamNotes}
                    onChange={(e) => setNewParamNotes(e.target.value)}
                  />
                  <Box mt={2}>
                    <Button
                      type="submit"
                      variant="contained"
                      disabled={paramState === "loading"}
                    >
                      {paramState === "loading"
                        ? editingParamId === null
                          ? "Creating..."
                          : "Saving..."
                        : editingParamId === null
                          ? "Create parameter template"
                          : "Save parameter template"}
                    </Button>
                  </Box>
                  {paramMessage && (
                    <Typography
                      variant="body2"
                      color={paramState === "error" ? "error" : "textSecondary"}
                      mt={1}
                    >
                      {paramMessage}
                    </Typography>
                  )}
                </Box>
              </CardContent>
            </Card>
          </Box>
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
                    No parameter sets yet. Use the form below to add one.
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
                            {new Date(p.created_at).toLocaleString()}
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
                  onSubmit={handleApplyStrategyParamTemplate}
                  mt={2}
                >
                  <Typography variant="subtitle2" gutterBottom>
                    Change parameter template
                  </Typography>
                  <TextField
                    select
                    fullWidth
                    margin="normal"
                    label="Registry label"
                    value={strategyParamEditLabel}
                    onChange={(e) => {
                      setStrategyParamEditLabel(e.target.value);
                      setStrategyParamEditError(null);
                    }}
                    helperText="Select a label from the parameter registry to apply to this strategy."
                  >
                    {Array.from(
                      new Map(paramRegistry.map((p) => [p.label, p])).values()
                    ).map((p) => (
                      <MenuItem key={p.id} value={p.label}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  {strategyParamEditError && (
                    <Typography variant="body2" color="error" mt={1}>
                      {strategyParamEditError}
                    </Typography>
                  )}
                  <Box mt={2}>
                    <Button
                      type="submit"
                      variant="contained"
                      size="small"
                      sx={{ mr: 1 }}
                    >
                      Apply template
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        setEditingStrategyParamId(null);
                        setStrategyParamEditLabel("");
                        setStrategyParamEditError(null);
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
