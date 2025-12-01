import {
  Box,
  Paper,
  Stack,
  TextField,
  Typography,
  type Theme
} from "@mui/material";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useMemo, useState } from "react";
import type { StockGroupSummary } from "../../types/stocks";

type GroupListProps = {
  groups: StockGroupSummary[];
  loading: boolean;
  activeGroupCode: string | null;
  onSelectGroup: (code: string | null) => void;
  selectedCodes: string[];
  onSelectionChange: (codes: string[]) => void;
};

const columns: GridColDef[] = [
  { field: "code", headerName: "Code", width: 110 },
  { field: "name", headerName: "Name", flex: 1, minWidth: 160 },
  {
    field: "composition_mode",
    headerName: "Mode",
    width: 110,
    valueGetter: (params) => params.row?.composition_mode ?? "weights"
  },
  {
    field: "stock_count",
    headerName: "# Stocks",
    width: 100,
    align: "right",
    headerAlign: "right"
  }
];

export const GroupList = ({
  groups,
  loading,
  activeGroupCode,
  onSelectGroup,
  selectedCodes,
  onSelectionChange
}: GroupListProps) => {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter(
      (g) =>
        g.code.toLowerCase().includes(query) ||
        g.name.toLowerCase().includes(query) ||
        (g.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
    );
  }, [groups, search]);

  return (
    <Paper elevation={1} sx={{ p: 2, height: "100%" }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1">Groups</Typography>
        <TextField
          size="small"
          placeholder="Search groups…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Box sx={{ flexGrow: 1 }}>
          <DataGrid
            rows={filtered}
            columns={columns}
            loading={loading}
            disableColumnMenu
            disableRowSelectionOnClick
            density="compact"
            autoHeight={filtered.length === 0}
            getRowId={(row) => row.code}
            checkboxSelection
            rowSelectionModel={selectedCodes}
            onRowClick={(params) => {
              const code = params.row?.code;
              if (typeof code === "string") {
                onSelectGroup(code);
              }
            }}
            onRowSelectionModelChange={(model) => {
              onSelectionChange(model as string[]);
            }}
            sx={{
              minHeight: 320,
              "& .MuiDataGrid-row.Mui-selected": {
                bgcolor: (theme: Theme) =>
                  theme.palette.action.selected +
                  (theme.palette.action.selectedOpacity || 0)
              }
            }}
            pageSizeOptions={[10, 25, 50]}
          />
        </Box>
      </Stack>
    </Paper>
  );
};
