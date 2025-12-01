export type ScreenerFilter = {
  field: string;
  op: "<" | "<=" | ">" | ">=" | "=" | "==";
  value: number;
};

export type ScreenerRankingField = {
  field: string;
  order: "asc" | "desc";
};

export type ScreenerRankingConfig = {
  primary: ScreenerRankingField;
  secondary?: ScreenerRankingField | null;
  limit?: number | null;
};

export type ScreenerRunRequest = {
  universe: string;
  as_of_date: string;
  filters: ScreenerFilter[];
  ranking?: ScreenerRankingConfig | null;
};

export type ScreenerResult = {
  symbol: string;
  sector?: string | null;
  market_cap?: number | null;
  value?: number | null;
  quality?: number | null;
  momentum?: number | null;
  low_vol?: number | null;
  size?: number | null;
};
