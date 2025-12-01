export type Stock = {
  id: number;
  symbol: string;
  exchange: string;
  segment?: string | null;
  name?: string | null;
  market_cap_crore?: number | null;
  sector?: string | null;
  tags?: string[] | null;
  analyst_rating?: string | null;
  target_price_one_year?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type GroupCompositionMode = "weights" | "qty" | "amount";

export type StockGroupSummary = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
  stock_count: number;
  composition_mode?: GroupCompositionMode;
  total_investable_amount?: number | null;
};

export type StockGroupMember = {
  id: number;
  stock_id?: number;
  symbol: string;
  exchange?: string | null;
  name?: string | null;
  sector?: string | null;
  tags?: string[] | null;
  is_active?: boolean;
  target_weight_pct?: number | null;
  target_qty?: number | null;
  target_amount?: number | null;
};

export type StockGroupDetail = StockGroupSummary & {
  composition_mode: GroupCompositionMode;
  total_investable_amount?: number | null;
  members: StockGroupMember[];
};
