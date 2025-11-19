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
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  BarChart,
  Bar
} from "recharts";
import { useEffect, useState, FormEvent } from "react";

type DataSummaryItem = {
  symbol: string;
  exchange?: string | null;
  timeframe: string;
  source?: string | null;
  start_timestamp: string;
  end_timestamp: string;
  bar_count: number;
};

type PriceBarPreview = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  source: string;
};

type FetchState = "idle" | "loading" | "success" | "error";

const API_BASE = "http://127.0.0.1:8000";

export const DataPage = () => {
  const [symbol, setSymbol] = useState("HDFCBANK");
  const [timeframe, setTimeframe] = useState("1d");
  const [exchange, setExchange] = useState("NSE");
  const [source, setSource] = useState<"kite" | "yfinance">("kite");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  const [summary, setSummary] = useState<DataSummaryItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<string | null>(null);
  const [preview, setPreview] = useState<PriceBarPreview[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [deleteState, setDeleteState] = useState<FetchState>("idle");
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    setStartDate(iso);
    setEndDate(iso);
  }, []);

  useEffect(() => {
    const loadSummary = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/data/summary`);
        if (!res.ok) return;
        const data: DataSummaryItem[] = await res.json();
        setSummary(data);
      } catch {
        // ignore; user can still fetch manually
      }
    };
    loadSummary();
  }, []);

  const handleFetch = async (event: FormEvent) => {
    event.preventDefault();
    setFetchState("loading");
    setFetchMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/data/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          timeframe,
          start_date: startDate,
          end_date: endDate,
          source,
          exchange
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFetchState("error");
        setFetchMessage(err.detail ?? "Fetch failed");
        return;
      }

      const data = await res.json();
      setFetchState("success");
      setFetchMessage(
        `Fetched ${data.bars_written} bars for ${data.symbol} (${data.timeframe}).`
      );

      const summaryRes = await fetch(`${API_BASE}/api/data/summary`);
      if (summaryRes.ok) {
        setSummary(await summaryRes.json());
      }
    } catch (error) {
      setFetchState("error");
      setFetchMessage(
        error instanceof Error ? error.message : "Unexpected error occurred"
      );
    }
  };

  const handleSelectSummaryRow = async (row: DataSummaryItem) => {
    setSelectedSymbol(row.symbol);
    setSelectedTimeframe(row.timeframe);
    setPreview([]);

    try {
      const res = await fetch(
        `${API_BASE}/api/data/${encodeURIComponent(
          row.symbol
        )}/preview?timeframe=${encodeURIComponent(row.timeframe)}`
      );
      if (!res.ok) return;
      const data: PriceBarPreview[] = await res.json();
      setPreview(data);
    } catch {
      // ignore for now; UI just won't show preview
    }
  };

  const handleToggleRowSelection = (row: DataSummaryItem) => {
    const key = `${row.symbol}|${row.exchange ?? ""}|${row.timeframe}|${
      row.source ?? ""
    }`;
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) {
      setDeleteState("error");
      setDeleteMessage("Select at least one coverage row to delete.");
      return;
    }

    const rowsToDelete = summary.filter((row) => {
      const key = `${row.symbol}|${row.exchange ?? ""}|${row.timeframe}|${
        row.source ?? ""
      }`;
      return selectedRows.has(key);
    });

    if (rowsToDelete.length === 0) {
      return;
    }

    if (
      !window.confirm(
        `Delete price data for ${rowsToDelete.length} coverage row(s)? This cannot be undone.`
      )
    ) {
      return;
    }

    setDeleteState("loading");
    setDeleteMessage(null);

    try {
      const groups = new Map<
        string,
        { symbols: string[]; timeframe: string; exchange?: string | null; source?: string | null }
      >();

      for (const row of rowsToDelete) {
        const key = `${row.timeframe}|${row.exchange ?? ""}|${row.source ?? ""}`;
        const existing = groups.get(key);
        if (existing) {
          existing.symbols.push(row.symbol);
        } else {
          groups.set(key, {
            symbols: [row.symbol],
            timeframe: row.timeframe,
            exchange: row.exchange ?? undefined,
            source: row.source ?? undefined
          });
        }
      }

      for (const group of groups.values()) {
        const params = new URLSearchParams();
        group.symbols.forEach((s) => params.append("symbols", s));
        params.append("timeframe", group.timeframe);
        if (group.exchange) {
          params.append("exchange", group.exchange);
        }
        if (group.source) {
          params.append("source", group.source);
        }

        const res = await fetch(`${API_BASE}/api/data/bars?${params.toString()}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setDeleteState("error");
          setDeleteMessage(err.detail ?? "Failed to delete selected data");
          return;
        }
      }

      const summaryRes = await fetch(`${API_BASE}/api/data/summary`);
      if (summaryRes.ok) {
        const data: DataSummaryItem[] = await summaryRes.json();
        setSummary(data);
      }
      setSelectedRows(new Set());
      setDeleteState("success");
      setDeleteMessage("Selected coverage rows deleted.");
    } catch (error) {
      setDeleteState("error");
      setDeleteMessage(
        error instanceof Error ? error.message : "Unexpected error during delete"
      );
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        Data Management
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} md={5}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Fetch Data
              </Typography>
              <Box component="form" onSubmit={handleFetch} noValidate>
                <TextField
                  fullWidth
                  margin="normal"
                  label="Symbol"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
                <TextField
                  select
                  fullWidth
                  margin="normal"
                  label="Timeframe"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  <MenuItem value="1m">1 minute</MenuItem>
                  <MenuItem value="5m">5 minutes</MenuItem>
                  <MenuItem value="15m">15 minutes</MenuItem>
                  <MenuItem value="1h">1 hour</MenuItem>
                  <MenuItem value="1d">1 day</MenuItem>
                </TextField>
                <TextField
                  select
                  fullWidth
                  margin="normal"
                  label="Exchange"
                  value={exchange}
                  onChange={(e) => setExchange(e.target.value)}
                >
                  <MenuItem value="NSE">NSE</MenuItem>
                  <MenuItem value="BSE">BSE</MenuItem>
                  <MenuItem value="US">US</MenuItem>
                  <MenuItem value="CRYPTO">CRYPTO</MenuItem>
                </TextField>
                <TextField
                  select
                  fullWidth
                  margin="normal"
                  label="Source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as "kite" | "yfinance")}
                >
                  <MenuItem value="kite">Kite</MenuItem>
                  <MenuItem value="yfinance">yfinance</MenuItem>
                </TextField>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      margin="normal"
                      label="Start date"
                      type="date"
                      InputLabelProps={{ shrink: true }}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </Grid>
                  <Grid item xs={6}>
                    <TextField
                      fullWidth
                      margin="normal"
                      label="End date"
                      type="date"
                      InputLabelProps={{ shrink: true }}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </Grid>
                </Grid>

                <Box mt={2}>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    disabled={fetchState === "loading"}
                  >
                    {fetchState === "loading" ? "Fetching..." : "Fetch"}
                  </Button>
                </Box>
                {fetchMessage && (
                  <Typography
                    variant="body2"
                    color={fetchState === "error" ? "error" : "textSecondary"}
                    mt={1}
                  >
                    {fetchMessage}
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} md={7}>
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
                <Typography variant="h6">Coverage Summary</Typography>
                <Button
                  size="small"
                  variant="outlined"
                  color="error"
                  onClick={handleDeleteSelected}
                  disabled={selectedRows.size === 0 || deleteState === "loading"}
                >
                  Delete Selected
                </Button>
              </Box>
              {summary.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No data yet. Fetch some bars to see coverage.
                </Typography>
              ) : (
                <Table size="small">
                    <TableHead>
                      <TableRow>
                      <TableCell />
                      <TableCell>Symbol</TableCell>
                      <TableCell>Exchange</TableCell>
                      <TableCell>Timeframe</TableCell>
                      <TableCell>Source</TableCell>
                      <TableCell>Start</TableCell>
                      <TableCell>End</TableCell>
                      <TableCell align="right">Bars</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summary.map((row) => (
                      <TableRow
                        key={`${row.symbol}-${row.exchange ?? ""}-${row.timeframe}-${
                          row.source ?? ""
                        }`}
                        hover
                        onClick={() => handleSelectSummaryRow(row)}
                        sx={{ cursor: "pointer" }}
                      >
                        <TableCell padding="checkbox">
                          <input
                            type="checkbox"
                            checked={selectedRows.has(
                              `${row.symbol}|${row.exchange ?? ""}|${
                                row.timeframe
                              }|${row.source ?? ""}`
                            )}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleRowSelection(row);
                            }}
                          />
                        </TableCell>
                        <TableCell>{row.symbol}</TableCell>
                        <TableCell>{row.exchange ?? ""}</TableCell>
                        <TableCell>{row.timeframe}</TableCell>
                        <TableCell>{row.source ?? ""}</TableCell>
                        <TableCell>
                          {new Date(row.start_timestamp).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          {new Date(row.end_timestamp).toLocaleString()}
                        </TableCell>
                        <TableCell align="right">{row.bar_count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {deleteMessage && (
                <Typography
                  variant="body2"
                  color={deleteState === "error" ? "error" : "textSecondary"}
                  mt={1}
                >
                  {deleteMessage}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Box mt={3}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Preview{" "}
              {selectedSymbol && selectedTimeframe
                ? `${selectedSymbol} (${selectedTimeframe})`
                : ""}
            </Typography>
            {preview.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Select a row from the coverage table to preview price and volume
                data.
              </Typography>
            ) : (
              <Box sx={{ height: 320 }}>
                <ResponsiveContainer width="100%" height="60%">
                  <LineChart data={preview}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" tick={false} />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) =>
                        new Date(value).toLocaleString()
                      }
                    />
                    <Line
                      type="monotone"
                      dataKey="close"
                      stroke="#90caf9"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <ResponsiveContainer width="100%" height="40%">
                  <BarChart data={preview}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" tick={false} />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) =>
                        new Date(value).toLocaleString()
                      }
                    />
                    <Bar dataKey="volume" fill="#f48fb1" />
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};
