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
  Typography
} from "@mui/material";
import { useEffect, useState, FormEvent } from "react";

type Strategy = {
  id: number;
  name: string;
  code: string;
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

  const [paramState, setParamState] = useState<FetchState>("idle");
  const [paramMessage, setParamMessage] = useState<string | null>(null);
  const [newParamLabel, setNewParamLabel] = useState("");
  const [newParamJson, setNewParamJson] = useState('{"fast": 10, "slow": 30}');
  const [newParamNotes, setNewParamNotes] = useState("");
  const [editingParamId, setEditingParamId] = useState<number | null>(null);

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
  };

  const handleCreateStrategy = async (event: FormEvent) => {
    event.preventDefault();
    setCreateState("loading");
    setCreateMessage(null);

    try {
      const payload = {
        name: newName,
        code: newCode,
        category: newCategory || null,
        description: null,
        status: "experimental",
        tags: null,
        linked_sigma_trader_id: null,
        linked_tradingview_template: null,
        live_ready: false
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
        setParamMessage(`Parameter set '${created.label}' created.`);
      } else {
        setParams((prev) =>
          prev.map((p) => (p.id === editingParamId ? created : p))
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

  const handleEditParam = (param: StrategyParameter) => {
    setEditingParamId(param.id);
    setNewParamLabel(param.label);
    setNewParamJson(JSON.stringify(param.params, null, 2));
    setNewParamNotes(param.notes ?? "");
    setParamState("idle");
    setParamMessage(null);
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
                      <TableCell>Status</TableCell>
                      <TableCell>Category</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {strategies.map((s) => (
                      <TableRow
                        key={s.id}
                        hover
                        selected={selectedStrategyId === s.id}
                        onClick={() => handleSelectStrategy(s)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell>{s.name}</TableCell>
                        <TableCell>{s.code}</TableCell>
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
        </Grid>

        <Grid item xs={12} md={7}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Strategy Details
              </Typography>
              {selectedStrategy ? (
                <Box>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <Box>
                      <Typography variant="h6">
                        {selectedStrategy.name}{" "}
                        <Typography
                          component="span"
                          variant="subtitle2"
                          color="textSecondary"
                        >
                          ({selectedStrategy.code})
                        </Typography>
                      </Typography>
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
                          color={
                            editState === "error" ? "error" : "textSecondary"
                          }
                          mt={1}
                        >
                          {editMessage}
                        </Typography>
                      )}
                    </Box>
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
                          SigmaTrader ID:{" "}
                          {selectedStrategy.linked_sigma_trader_id}
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
                      Parameter Sets
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
                          {params.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>{p.label}</TableCell>
                              <TableCell>
                                <code>
                                  {JSON.stringify(p.params, null, 0).slice(
                                    0,
                                    80
                                  )}
                                  {JSON.stringify(p.params, null, 0).length >
                                    80 && "..."}
                                </code>
                              </TableCell>
                              <TableCell>
                                {p.notes && p.notes.length > 0
                                  ? p.notes
                                  : "\u00a0"}
                              </TableCell>
                              <TableCell>
                                {new Date(p.created_at).toLocaleString()}
                              </TableCell>
                              <TableCell align="right">
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => handleEditParam(p)}
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

                  <Box mt={3}>
                    <Typography variant="subtitle1" gutterBottom>
                      New Parameter Set
                    </Typography>
                    <Box component="form" onSubmit={handleCreateParam} noValidate>
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
                              ? "Create parameter set"
                              : "Save parameter set"}
                        </Button>
                      </Box>
                      {paramMessage && (
                        <Typography
                          variant="body2"
                          color={
                            paramState === "error" ? "error" : "textSecondary"
                          }
                          mt={1}
                        >
                          {paramMessage}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </Box>
              ) : (
                <Typography variant="body2" color="textSecondary">
                  Select a strategy from the list to view details and parameter
                  sets.
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};
