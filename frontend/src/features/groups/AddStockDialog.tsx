import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from "@mui/material";
import { useMemo, useState } from "react";
import type { Stock } from "../../types/stocks";

type AddStockDialogProps = {
  open: boolean;
  availableStocks: Stock[];
  onClose: () => void;
  onSubmit: (symbol: string) => Promise<void>;
};

export const AddStockDialog = ({
  open,
  availableStocks,
  onClose,
  onSubmit
}: AddStockDialogProps) => {
  const [value, setValue] = useState<Stock | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      availableStocks.map((s) => ({
        ...s,
        label: `${s.symbol} (${s.exchange})${s.name ? ` – ${s.name}` : ""}`
      })),
    [availableStocks]
  );

  const handleSubmit = async () => {
    if (!value) {
      setError("Select a stock to add.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(value.symbol);
      setValue(null);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to add stock. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Add stock to group</DialogTitle>
      <DialogContent sx={{ mt: 1 }}>
        <Autocomplete
          value={value}
          onChange={(_, newValue) => setValue(newValue ?? null)}
          options={options}
          getOptionLabel={(option) => option.label}
          renderInput={(params) => (
            <TextField {...params} label="Symbol" placeholder="Search symbol…" />
          )}
        />
        {error && (
          <Typography variant="body2" color="error" mt={1}>
            {error}
          </Typography>
        )}
        {options.length === 0 && (
          <Box mt={1}>
            <Typography variant="body2" color="text.secondary">
              No eligible stocks found. Universe stocks already in the group are
              hidden.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting} variant="contained">
          Add stock
        </Button>
      </DialogActions>
    </Dialog>
  );
};
