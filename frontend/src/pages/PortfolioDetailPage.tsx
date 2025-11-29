import { Box, CircularProgress, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type PortfolioDto = {
  id: number;
  code: string;
  name: string;
  base_currency: string;
  universe_scope: string | null;
};

const API_BASE = "http://127.0.0.1:8000";

export const PortfolioDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [portfolio, setPortfolio] = useState<PortfolioDto | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setState("loading");
      try {
        const res = await fetch(`${API_BASE}/api/portfolios/${id}`);
        if (!res.ok) {
          setState("error");
          return;
        }
        const data: PortfolioDto = await res.json();
        setPortfolio(data);
        setState("idle");
      } catch {
        setState("error");
      }
    };
    void load();
  }, [id]);

  if (!id) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6">Portfolio not found</Typography>
      </Box>
    );
  }

  if (state === "loading" && !portfolio) {
    return (
      <Box sx={{ p: 3, display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={20} />
        <Typography variant="body2">Loading portfolio…</Typography>
      </Box>
    );
  }

  if (state === "error" && !portfolio) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          Failed to load portfolio.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" gutterBottom>
        Portfolio detail – {portfolio?.code ?? id}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This is a placeholder Portfolio Detail view. Future iterations will
        include Overview, Settings, Backtests, Trades &amp; Holdings, and
        Analytics tabs as defined in the Portfolio Management PRD.
      </Typography>
      {portfolio && (
        <Box>
          <Typography variant="subtitle1">Basic information</Typography>
          <Typography variant="body2">Name: {portfolio.name}</Typography>
          <Typography variant="body2">
            Base currency: {portfolio.base_currency}
          </Typography>
          <Typography variant="body2">
            Universe scope: {portfolio.universe_scope ?? "–"}
          </Typography>
        </Box>
      )}
    </Box>
  );
};
