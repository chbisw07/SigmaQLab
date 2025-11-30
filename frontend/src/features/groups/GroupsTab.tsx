import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { FormEvent, useMemo, useState } from "react";
import type { FetchState } from "../../pages/StocksPage";
import type { Stock, StockGroupSummary } from "../../types/stocks";
import { GroupDetailPanel } from "./GroupDetailPanel";
import { GroupList } from "./GroupList";

type GroupsTabProps = {
  apiBase: string;
  groups: StockGroupSummary[];
  groupsState: FetchState;
  groupsError: string | null;
  onRefreshGroups: () => void;
  stocks: Stock[];
  activeGroupCode: string | null;
  onGroupSelectionChange: (code: string | null) => void;
};

export const GroupsTab = ({
  apiBase,
  groups,
  groupsState,
  groupsError,
  onRefreshGroups,
  stocks,
  activeGroupCode,
  onGroupSelectionChange
}: GroupsTabProps) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<StockGroupSummary | null>(null);
  const [formState, setFormState] = useState<FetchState>("idle");
  const [formMessage, setFormMessage] = useState<string | null>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.code === activeGroupCode) ?? null,
    [groups, activeGroupCode]
  );

  const openCreateDialog = () => {
    setEditingGroup(null);
    setFormMessage(null);
    setFormState("idle");
    setFormOpen(true);
  };

  const openEditDialog = (group: StockGroupSummary) => {
    setEditingGroup(group);
    setFormMessage(null);
    setFormState("idle");
    setFormOpen(true);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = {
      code: (formData.get("code") as string).trim().toUpperCase(),
      name: (formData.get("name") as string).trim(),
      description: (formData.get("description") as string).trim() || null,
      tags:
        ((formData.get("tags") as string) ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean) || null
    };
    if (!payload.code || !payload.name) {
      setFormState("error");
      setFormMessage("Code and name are required.");
      return;
    }
    setFormState("loading");
    setFormMessage(null);

    try {
      if (editingGroup) {
        const res = await fetch(`${apiBase}/api/stock-groups/${editingGroup.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("Failed to update group.");
      } else {
        const res = await fetch(`${apiBase}/api/stock-groups`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("Failed to create group.");
      }
      setFormState("success");
      setFormMessage("Changes saved.");
      setFormOpen(false);
      await onRefreshGroups();
      onGroupSelectionChange(payload.code);
    } catch (err) {
      setFormState("error");
      setFormMessage(err instanceof Error ? err.message : "Unable to save group.");
    }
  };

  return (
    <Box>
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        mb={2}
        spacing={2}
      >
        <Box>
          <Typography variant="h5">Stock groups (baskets)</Typography>
          <Typography variant="body2" color="text.secondary">
            Define baskets of stocks for backtests and portfolios.
          </Typography>
        </Box>
        <Button variant="contained" size="small" onClick={openCreateDialog}>
          New group
        </Button>
      </Stack>

      {groupsError && (
        <Typography variant="body2" color="error" mb={2}>
          {groupsError}
        </Typography>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <GroupList
            groups={groups}
            loading={groupsState === "loading"}
            activeGroupCode={activeGroupCode}
            onSelectGroup={(code) => onGroupSelectionChange(code)}
          />
        </Grid>
        <Grid item xs={12} md={8}>
          <GroupDetailPanel
            apiBase={apiBase}
            group={activeGroup}
            onGroupUpdated={onRefreshGroups}
            onEditGroup={openEditDialog}
            stocks={stocks}
          />
        </Grid>
      </Grid>

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <Box component="form" onSubmit={handleSubmit}>
          <DialogTitle>{editingGroup ? "Edit group" : "New group"}</DialogTitle>
          <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <TextField
              name="code"
              label="Code"
              defaultValue={editingGroup?.code ?? ""}
              inputProps={{ style: { textTransform: "uppercase" } }}
              helperText="Short identifier, e.g. MIDCAP_50"
            />
            <TextField
              name="name"
              label="Name"
              defaultValue={editingGroup?.name ?? ""}
            />
            <TextField
              name="description"
              label="Description"
              defaultValue={editingGroup?.description ?? ""}
              multiline
              minRows={2}
            />
            <TextField
              name="tags"
              label="Tags (comma-separated)"
              defaultValue={(editingGroup?.tags ?? []).join(", ")}
            />
            {formMessage && (
              <Typography
                variant="body2"
                color={formState === "error" ? "error" : "text.secondary"}
              >
                {formMessage}
              </Typography>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={formState === "loading"} variant="contained">
              {editingGroup ? "Save changes" : "Create group"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
};
