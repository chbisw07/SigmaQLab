import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  Grid,
  MenuItem,
  Slider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from "@mui/material";
import { useEffect, useState, FormEvent } from "react";
import { DataPreviewChart } from "../features/data/components/DataPreviewChart";
import {
  INDICATORS_BY_CATEGORY,
  IndicatorDefinition
} from "../features/data/indicatorCatalog";
import { useAppearance } from "../appearanceContext";

type DataSummaryItem = {
  coverage_id: string;
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

type PreviewWithIndicators = PriceBarPreview & {
  sma5?: number;
  sma20?: number;
  ema20?: number;
  wma20?: number;
  hma20?: number;
  bb_upper?: number;
  bb_lower?: number;
  rsi14?: number;
  macd?: number;
  macd_signal?: number;
  obv?: number;
  donchian_high?: number;
  donchian_low?: number;
  momentum10?: number;
  roc10?: number;
  atr14?: number;
  cci20?: number;
};

type FetchState = "idle" | "loading" | "success" | "error";

type PreviewRangePreset =
  | "all"
  | "1m"
  | "3m"
  | "5m"
  | "10m"
  | "30m"
  | "60m"
  | "1d"
  | "1w"
  | "1M"
  | "3M"
  | "6M"
  | "1Y";

const API_BASE = "http://127.0.0.1:8000";

export const DataPage = () => {
  const { chartThemeId } = useAppearance();
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
  const [previewWithIndicators, setPreviewWithIndicators] = useState<
    PreviewWithIndicators[]
  >([]);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [deleteState, setDeleteState] = useState<FetchState>("idle");
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const [selectedIndicatorIds, setSelectedIndicatorIds] = useState<
    Set<string>
  >(() => {
    const initial = new Set<string>();
    Object.values(INDICATORS_BY_CATEGORY).forEach((defs) => {
      defs.forEach((def) => {
        if (def.defaultSelected) {
          initial.add(def.id);
        }
      });
    });
    return initial;
  });
  const [chartHeight, setChartHeight] = useState(640);
  const [showVolume, setShowVolume] = useState(true);
  const [previewRange, setPreviewRange] =
    useState<PreviewRangePreset>("all");
  const [showLastPriceLine, setShowLastPriceLine] = useState(true);
  const [highlightLatestBar, setHighlightLatestBar] = useState(false);

  useEffect(() => {
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    setStartDate(iso);
    setEndDate(iso);
  }, []);

  useEffect(() => {
    const computeIndicators = (data: PriceBarPreview[]): PreviewWithIndicators[] => {
      if (data.length === 0) return [];

      const closes = data.map((d) => d.close);
      const highs = data.map((d) => d.high);
      const lows = data.map((d) => d.low);
      const volumes = data.map((d) => d.volume ?? 0);

      const smaSeries = (
        series: number[],
        period: number
      ): (number | undefined)[] => {
        const out: (number | undefined)[] = [];
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          sum += series[i];
          if (i >= period) {
            sum -= series[i - period];
          }
          if (i >= period - 1) {
            out.push(sum / period);
          } else {
            out.push(undefined);
          }
        }
        return out;
      };

      const sma = (period: number): (number | undefined)[] =>
        smaSeries(closes, period);

      const ema = (period: number): (number | undefined)[] => {
        const out: (number | undefined)[] = [];
        const k = 2 / (period + 1);
        let prev: number | undefined;
        for (let i = 0; i < data.length; i += 1) {
          const price = closes[i];
          if (prev === undefined) {
            prev = price;
          } else {
            prev = price * k + prev * (1 - k);
          }
          out.push(prev);
        }
        return out;
      };

      const sma5 = sma(5);
      const sma20 = sma(20);
      const ema20 = ema(20);

      const wma = (period: number): (number | undefined)[] => {
        const weights = Array.from({ length: period }, (_, i) => i + 1);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        const out: (number | undefined)[] = [];
        for (let i = 0; i < data.length; i += 1) {
          if (i < period - 1) {
            out.push(undefined);
            continue;
          }
          let acc = 0;
          for (let j = 0; j < period; j += 1) {
            acc += closes[i - j] * weights[period - 1 - j];
          }
          out.push(acc / weightSum);
        }
        return out;
      };

      const wma20 = wma(20);

      const hma20: (number | undefined)[] = [];
      const half = 10;
      const sqrtN = Math.round(Math.sqrt(20));
      const wmaHalf = wma(half);
      const wmaFull = wma(20);
      const diff: (number | undefined)[] = [];
      for (let i = 0; i < data.length; i += 1) {
        if (wmaHalf[i] === undefined || wmaFull[i] === undefined) {
          diff.push(undefined);
        } else {
          diff.push(2 * (wmaHalf[i] as number) - (wmaFull[i] as number));
        }
      }
      const tempHma = (() => {
        const out: (number | undefined)[] = [];
        const weights = Array.from({ length: sqrtN }, (_, i) => i + 1);
        const weightSum = weights.reduce((a, b) => a + b, 0);
        for (let i = 0; i < data.length; i += 1) {
          if (i < sqrtN - 1) {
            out.push(undefined);
            continue;
          }
          let acc = 0;
          let valid = true;
          for (let j = 0; j < sqrtN; j += 1) {
            const v = diff[i - j];
            if (v === undefined) {
              valid = false;
              break;
            }
            acc += v * weights[sqrtN - 1 - j];
          }
          out.push(valid ? acc / weightSum : undefined);
        }
        return out;
      })();
      for (let i = 0; i < data.length; i += 1) {
        hma20.push(tempHma[i]);
      }

      const bbUpper: (number | undefined)[] = [];
      const bbLower: (number | undefined)[] = [];
      for (let i = 0; i < data.length; i += 1) {
        if (i < 19) {
          bbUpper.push(undefined);
          bbLower.push(undefined);
          continue;
        }
        const window = closes.slice(i - 19, i + 1);
        const mean = window.reduce((a, b) => a + b, 0) / window.length;
        const variance =
          window.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
          window.length;
        const std = Math.sqrt(variance);
        bbUpper.push(mean + 2 * std);
        bbLower.push(mean - 2 * std);
      }

      const rsi14: (number | undefined)[] = [];
      let avgGain: number | undefined;
      let avgLoss: number | undefined;
      for (let i = 0; i < data.length; i += 1) {
        if (i === 0) {
          rsi14.push(undefined);
          continue;
        }
        const change = closes[i] - closes[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? -change : 0;
        if (i < 14) {
          avgGain = (avgGain ?? 0) + gain;
          avgLoss = (avgLoss ?? 0) + loss;
          if (i === 13) {
            avgGain /= 14;
            avgLoss /= 14;
          }
          rsi14.push(undefined);
        } else {
          avgGain = ((avgGain ?? 0) * 13 + gain) / 14;
          avgLoss = ((avgLoss ?? 0) * 13 + loss) / 14;
          if (!avgLoss || avgLoss === 0) {
            rsi14.push(100);
          } else {
            const rs = avgGain / avgLoss;
            rsi14.push(100 - 100 / (1 + rs));
          }
        }
      }

      const macd: (number | undefined)[] = [];
      const macdSignal: (number | undefined)[] = [];
      const ema12 = ema(12);
      const ema26 = ema(26);
      for (let i = 0; i < data.length; i += 1) {
        if (ema12[i] === undefined || ema26[i] === undefined) {
          macd.push(undefined);
        } else {
          macd.push((ema12[i] as number) - (ema26[i] as number));
        }
      }
      let signalPrev: number | undefined;
      const k9 = 2 / (9 + 1);
      for (let i = 0; i < data.length; i += 1) {
        const m = macd[i];
        if (m === undefined) {
          macdSignal.push(undefined);
        } else if (signalPrev === undefined) {
          signalPrev = m;
          macdSignal.push(signalPrev);
        } else {
          signalPrev = m * k9 + signalPrev * (1 - k9);
          macdSignal.push(signalPrev);
        }
      }

      const obv: number[] = [];
      let prevClose = closes[0];
      let prevObv = 0;
      obv.push(prevObv);
      for (let i = 1; i < data.length; i += 1) {
        const price = closes[i];
        let value = prevObv;
        if (price > prevClose) {
          value += volumes[i];
        } else if (price < prevClose) {
          value -= volumes[i];
        }
        obv.push(value);
        prevObv = value;
        prevClose = price;
      }

      const atr14: (number | undefined)[] = [];
      const tr: number[] = [];
      for (let i = 0; i < data.length; i += 1) {
        if (i === 0) {
          tr.push(highs[i] - lows[i]);
        } else {
          const high = highs[i];
          const low = lows[i];
          const prev = closes[i - 1];
          const trVal = Math.max(
            high - low,
            Math.abs(high - prev),
            Math.abs(low - prev)
          );
          tr.push(trVal);
        }
      }
      let atrPrev: number | undefined;
      for (let i = 0; i < data.length; i += 1) {
        if (i < 13) {
          atr14.push(undefined);
        } else if (i === 13) {
          const avg =
            tr.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
          atrPrev = avg;
          atr14.push(avg);
        } else {
          atrPrev = ((atrPrev ?? tr[i]) * 13 + tr[i]) / 14;
          atr14.push(atrPrev);
        }
      }

      const cci20: (number | undefined)[] = [];
      const typicalPrices = data.map(
        (d) => (d.high + d.low + d.close) / 3
      );
      const tpSma20 = smaSeries(typicalPrices, 20);
      for (let i = 0; i < data.length; i += 1) {
        if (i < 19 || tpSma20[i] === undefined) {
          cci20.push(undefined);
          continue;
        }
        const tpWindow = typicalPrices.slice(i - 19, i + 1);
        const smaTp = tpSma20[i] as number;
        const meanDev =
          tpWindow
            .map((tp) => Math.abs(tp - smaTp))
            .reduce((a, b) => a + b, 0) / tpWindow.length;
        if (meanDev === 0) {
          cci20.push(undefined);
        } else {
          cci20.push((typicalPrices[i] - smaTp) / (0.015 * meanDev));
        }
      }

      return data.map((d, i) => ({
        ...d,
        sma5: sma5[i],
        sma20: sma20[i],
        ema20: ema20[i],
        wma20: wma20[i],
        hma20: hma20[i],
        bb_upper: bbUpper[i],
        bb_lower: bbLower[i],
        rsi14: rsi14[i],
        macd: macd[i],
        macd_signal: macdSignal[i],
        obv: obv[i],
        donchian_high:
          i >= 19 ? Math.max(...data.slice(i - 19, i + 1).map((b) => b.high)) : undefined,
        donchian_low:
          i >= 19 ? Math.min(...data.slice(i - 19, i + 1).map((b) => b.low)) : undefined,
        momentum10:
          i >= 10 ? closes[i] - closes[i - 10] : undefined,
        roc10:
          i >= 10 && closes[i - 10] !== 0
            ? ((closes[i] / closes[i - 10] - 1) * 100)
            : undefined,
        atr14: atr14[i],
        cci20: cci20[i]
      }));
    };

    setPreviewWithIndicators(computeIndicators(preview));
  }, [preview]);

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
    const key = row.coverage_id;
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

  const handleSelectAllRows = () => {
    const next = new Set<string>();
    summary.forEach((row) => {
      const key = row.coverage_id;
      next.add(key);
    });
    setSelectedRows(next);
  };

  const handleDeleteSelected = async () => {
    if (selectedRows.size === 0) {
      setDeleteState("error");
      setDeleteMessage("Select at least one coverage row to delete.");
      return;
    }

    const rowsToDelete = summary.filter((row) => selectedRows.has(row.coverage_id));

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
          <Card
            sx={{
              height: 550,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <CardContent sx={{ flex: 1 }}>
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
                  <MenuItem disabled>Minutes</MenuItem>
                  <MenuItem value="1m">1 minute</MenuItem>
                  <MenuItem value="3m">3 minutes</MenuItem>
                  <MenuItem value="5m">5 minutes</MenuItem>
                  <MenuItem value="15m">15 minutes</MenuItem>
                  <MenuItem value="30m">30 minutes</MenuItem>
                  <MenuItem disabled>Hours</MenuItem>
                  <MenuItem value="1h">1 hour</MenuItem>
                  <MenuItem disabled>Days</MenuItem>
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
          <Card
            sx={{
              height: 550,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <CardContent
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                minHeight: 0
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  mb: 1
                }}
              >
                <Typography variant="h6">Coverage Summary</Typography>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleSelectAllRows}
                    disabled={summary.length === 0}
                  >
                    Select All
                  </Button>
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
              </Box>
              {summary.length === 0 ? (
                <Typography variant="body2" color="textSecondary">
                  No data yet. Fetch some bars to see coverage.
                </Typography>
              ) : (
                <Box
                  sx={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto"
                  }}
                >
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox" />
                        <TableCell>ID</TableCell>
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
                      {summary.map((row) => {
                        const key = row.coverage_id;
                        const checked = selectedRows.has(key);
                        return (
                          <TableRow
                            key={key}
                            hover
                            onClick={() => handleSelectSummaryRow(row)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell padding="checkbox">
                              <Checkbox
                                size="small"
                                checked={checked}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  handleToggleRowSelection(row);
                                }}
                              />
                            </TableCell>
                            <TableCell>{row.coverage_id}</TableCell>
                            <TableCell>{row.symbol}</TableCell>
                            <TableCell>{row.exchange ?? ""}</TableCell>
                            <TableCell>{row.timeframe}</TableCell>
                            <TableCell>{row.source ?? ""}</TableCell>
                            <TableCell>
                              {new Date(row.start_timestamp).toLocaleString("en-IN", {
                                timeZone: "Asia/Kolkata"
                              })}
                            </TableCell>
                            <TableCell>
                              {new Date(row.end_timestamp).toLocaleString("en-IN", {
                                timeZone: "Asia/Kolkata"
                              })}
                            </TableCell>
                            <TableCell align="right">{row.bar_count}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </Box>
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
            <Box
              sx={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                mb: 1
              }}
            >
              <Typography variant="h6">
                Preview{" "}
                {selectedSymbol && selectedTimeframe
                  ? `${selectedSymbol} (${selectedTimeframe})`
                  : ""}
              </Typography>
              {preview.length > 0 && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography variant="body2">Range:</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {[
                      { id: "all", label: "All" },
                      { id: "1m", label: "1m" },
                      { id: "3m", label: "3m" },
                      { id: "5m", label: "5m" },
                      { id: "10m", label: "10m" },
                      { id: "30m", label: "30m" },
                      { id: "60m", label: "60m" },
                      { id: "1d", label: "1D" },
                      { id: "1w", label: "1W" },
                      { id: "1M", label: "1M" },
                      { id: "3M", label: "3M" },
                      { id: "6M", label: "6M" },
                      { id: "1Y", label: "1Y" }
                    ].map((opt) => (
                      <Button
                        key={opt.id}
                        size="small"
                        variant={
                          previewRange === (opt.id as PreviewRangePreset)
                            ? "contained"
                            : "outlined"
                        }
                        onClick={() =>
                          setPreviewRange(opt.id as PreviewRangePreset)
                        }
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
            {preview.length === 0 ? (
              <Typography variant="body2" color="textSecondary">
                Select a row from the coverage table to preview price and volume
                data.
              </Typography>
            ) : (
              <>
                <Box mb={2}>
                  <Typography variant="subtitle2" gutterBottom>
                    Indicators
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={3}>
                      <Typography variant="body2">Moving averages</Typography>
                      {INDICATORS_BY_CATEGORY.moving_average.map(
                        (def: IndicatorDefinition) => (
                          <FormControlLabel
                            key={def.id}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedIndicatorIds.has(def.id)}
                                onChange={(e) => {
                                  setSelectedIndicatorIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(def.id);
                                    } else {
                                      next.delete(def.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            }
                            label={def.label}
                          />
                        )
                      )}
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="body2">Trend / bands</Typography>
                      {INDICATORS_BY_CATEGORY.trend_bands.map(
                        (def: IndicatorDefinition) => (
                          <FormControlLabel
                            key={def.id}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedIndicatorIds.has(def.id)}
                                onChange={(e) => {
                                  setSelectedIndicatorIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(def.id);
                                    } else {
                                      next.delete(def.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            }
                            label={def.label}
                          />
                        )
                      )}
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="body2">
                        Momentum / oscillators
                      </Typography>
                      {INDICATORS_BY_CATEGORY.momentum.map(
                        (def: IndicatorDefinition) => (
                          <FormControlLabel
                            key={def.id}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedIndicatorIds.has(def.id)}
                                onChange={(e) => {
                                  setSelectedIndicatorIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(def.id);
                                    } else {
                                      next.delete(def.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            }
                            label={def.label}
                          />
                        )
                      )}
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <Typography variant="body2">Volume / volatility</Typography>
                      <FormControlLabel
                        control={
                          <Checkbox
                            size="small"
                            checked={showVolume}
                            onChange={(e) => setShowVolume(e.target.checked)}
                          />
                        }
                        label="Volume bars"
                      />
                      {INDICATORS_BY_CATEGORY.volume.map(
                        (def: IndicatorDefinition) => (
                          <FormControlLabel
                            key={def.id}
                            control={
                              <Checkbox
                                size="small"
                                checked={selectedIndicatorIds.has(def.id)}
                                onChange={(e) => {
                                  setSelectedIndicatorIds((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      next.add(def.id);
                                    } else {
                                      next.delete(def.id);
                                    }
                                    return next;
                                  });
                                }}
                              />
                            }
                            label={def.label}
                          />
                        )
                      )}
                    </Grid>
                  </Grid>
                  <Box mt={2} sx={{ maxWidth: 260 }}>
                    <Typography variant="body2" gutterBottom>
                      Chart height
                    </Typography>
                    <Slider
                      size="small"
                      value={chartHeight}
                      min={512}
                      max={1080}
                      step={20}
                      valueLabelDisplay="auto"
                      onChange={(_, value) =>
                        setChartHeight(
                          Array.isArray(value) ? value[0] : (value as number)
                        )
                      }
                    />
                  </Box>
                  <Box mt={2}>
                    <Typography variant="body2" gutterBottom>
                      Tools
                    </Typography>
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={showLastPriceLine}
                          onChange={(e) =>
                            setShowLastPriceLine(e.target.checked)
                          }
                        />
                      }
                      label="Last price line"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          size="small"
                          checked={highlightLatestBar}
                          onChange={(e) =>
                            setHighlightLatestBar(e.target.checked)
                          }
                        />
                      }
                      label="Highlight latest bar"
                    />
                  </Box>
                </Box>

                <Box
                  sx={{
                    mt: 1,
                    height: chartHeight,
                    minHeight: chartHeight,
                    width: "100%",
                    position: "relative"
                  }}
                >
                  <DataPreviewChart
                    data={previewWithIndicators}
                    selectedIndicatorIds={Array.from(selectedIndicatorIds)}
                    height={chartHeight}
                    showVolume={showVolume}
                    rangePreset={previewRange}
                    showLastPriceLine={showLastPriceLine}
                    highlightLatestBar={highlightLatestBar}
                    chartTheme={chartThemeId}
                  />
                </Box>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};
