export type OptimizerType =
  | "equal_weight"
  | "market_cap"
  | "min_var"
  | "max_sharpe"
  | "risk_parity"
  | "hrp"
  | "cvar";

export type PortfolioConstraintsConfig = {
  min_weight?: number | null;
  max_weight?: number | null;
  turnover_limit?: number | null;
  target_volatility?: number | null;
  max_beta?: number | null;
  sector_caps?: Record<string, number> | null;
  factor_constraints?: Record<string, number> | null;
};

export type OptimizedWeight = {
  symbol: string;
  weight: number;
  sector?: string | null;
  value?: number | null;
  quality?: number | null;
  momentum?: number | null;
  low_vol?: number | null;
  size?: number | null;
};

export type PortfolioOptimizeResponse = {
  weights: OptimizedWeight[];
  risk: Record<string, number>;
  exposures: Record<string, number>;
  diagnostics: Record<string, unknown>;
};
