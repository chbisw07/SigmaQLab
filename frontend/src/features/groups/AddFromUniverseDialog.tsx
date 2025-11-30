import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from "@mui/material";
import { DataGrid, type GridColDef, type GridRowSelectionModel } from "@mui/x-data-grid";
import { useMemo, useState } from "react";
import type { Stock } from "../../types/stocks";

type AddFromUniverseDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (symbols: string[]) => Promise<void>;
  availableStocks: Stock[];
};

const columns: GridColDef[] = [
  { field: "symbol", headerName: "Symbol", width: 120 },
  { field: "exchange", headerName: "Exchange", width: 120 },
  { field: "sector", headerName: "Sector", flex: 1, minWidth: 140 },
  { field: "name", headerName: "Name", flex: 1.2, minWidth: 180 }
];

export const AddFromUniverseDialog = ({
  open,
  onClose,
  onSubmit,
  availableStocks
}: AddFromUniverseDialogProps) => {
  const [selection, setSelection] = useState<GridRowSelectionModel>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableStocks;
    return availableStocks.filter((stock) => {
      const symbol = stock.symbol.toLowerCase();
      const name = (stock.name ?? "").toLowerCase();
      const sector = (stock.sector ?? "").toLowerCase();
      return (
        symbol.includes(query) ||
        name.includes(query) ||
        sector.includes(query)
      );
    });
  }, [availableStocks, search]);

  const handleAdd = async () => {
    if (selection.length === 0) {
      setError("Select at least one stock to add.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const symbols = rows
      .filter((row) => selection.includes(row.id))
      .map((row) => row.symbol);
    try {
      await onSubmit(symbols);
      setSelection([]);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to add selected stocks. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Add from universe</DialogTitle>
      <DialogContent sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <TextField
          size="small"
          label="Search symbol, name, or sector"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelection([]);
          }}
        />
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No eligible universe stocks available.
          </Typography>
        ) : (
          <div style={{ width: "100%", height: 420 }}>
            <DataGrid
              rows={rows}
              columns={columns}
              checkboxSelection
              disableRowSelectionOnClick
              density="compact"
              getRowId={(row) => row.id}
              rowSelectionModel={selection}
              onRowSelectionModelChange={(model) => setSelection(model)}
            />
          </div>
        )}
        {error && (
          <Typography variant="body2" color="error" mt={1}>
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          onClick={() => {
            setSelection([]);
            onClose();
          }}
        >
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={selection.length === 0 || submitting || rows.length === 0}
          onClick={handleAdd}
        >
          Add {selection.length > 0 ? selection.length : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
