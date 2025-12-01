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
  const [selectedGroupCodes, setSelectedGroupCodes] = useState<string[]>([]);

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

  const clearSelectionAndActive = () => {
    setSelectedGroupCodes([]);
    onGroupSelectionChange(null);
  };

  const handleDeleteGroup = async (group: StockGroupSummary) => {
    if (
      !window.confirm(
        `Delete group '${group.code}'? This will remove its members but not delete stocks.`
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${apiBase}/api/stock-groups/${group.id}`, {
        method: "DELETE"
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Failed to delete group.");
      }
      await onRefreshGroups();
      clearSelectionAndActive();
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(
        err instanceof Error ? err.message : "Unable to delete group. Try again."
      );
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedGroupCodes.length === 0) return;
    const toDelete = groups.filter((g) => selectedGroupCodes.includes(g.code));
    if (toDelete.length === 0) {
      clearSelectionAndActive();
      return;
    }
    if (
      !window.confirm(
        `Delete ${toDelete.length} group(s)? This will remove their members but not delete stocks.`
      )
    ) {
      return;
    }
    try {
      await Promise.all(
        toDelete.map(async (g) => {
          const res = await fetch(`${apiBase}/api/stock-groups/${g.id}`, {
            method: "DELETE"
          });
          if (!res.ok && res.status !== 204) {
            throw new Error(`Failed to delete group ${g.code}.`);
          }
        })
      );
      await onRefreshGroups();
      clearSelectionAndActive();
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(
        err instanceof Error
          ? err.message
          : "Unable to delete one or more groups. Try again."
      );
    }
  };

  return (
    <Box>
      <Stack spacing={1.5} mb={2}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={2}
        >
          <Box>
            <Typography variant="h5">Stock groups (baskets)</Typography>
            <Typography variant="body2" color="text.secondary">
              Define baskets of stocks for backtests and portfolios.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {selectedGroupCodes.length > 0 && (
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={() => void handleDeleteSelected()}
              >
                Delete selected
              </Button>
            )}
            <Button variant="contained" size="small" onClick={openCreateDialog}>
              New group
            </Button>
          </Stack>
        </Stack>
        {selectedGroupCodes.length > 0 && (
          <Typography variant="body2">
            {selectedGroupCodes.length} group(s) selected
          </Typography>
        )}
      </Stack>

      {groupsError && (
        <Typography variant="body2" color="error" mb={2}>
          {groupsError}
        </Typography>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={5}>
          <GroupList
            groups={groups}
            loading={groupsState === "loading"}
            activeGroupCode={activeGroupCode}
            onSelectGroup={(code) => onGroupSelectionChange(code)}
            selectedCodes={selectedGroupCodes}
            onSelectionChange={setSelectedGroupCodes}
          />
        </Grid>
        <Grid item xs={12} md={7}>
          <GroupDetailPanel
            apiBase={apiBase}
            group={activeGroup}
            onGroupUpdated={onRefreshGroups}
            onEditGroup={openEditDialog}
             onDeleteGroup={handleDeleteGroup}
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
