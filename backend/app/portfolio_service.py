from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Sequence

import pandas as pd
from sqlalchemy.orm import Session

from .backtest_service import BacktestService
from .data_manager import DataManager
from .models import Portfolio, PortfolioBacktest, Stock, StockGroup, StockGroupMember


@dataclass
class PortfolioEquityPoint:
    """Lightweight equity point used internally by the portfolio engine."""

    timestamp: datetime
    equity: float


class PortfolioService:
    """Service layer for running portfolio-level backtests.

    V1 keeps the allocation model deliberately simple:
    - Universe is resolved from a stock group (universe_scope='group:<id>').
    - Long-only, equal-weight allocation across the universe at each bar.
    - Risk profile can cap max position size (%) and max concurrent positions.
    - No leverage and no costs are applied yet.

    The implementation is intentionally structured so a richer signal /
    multi-strategy allocator can be introduced in later sprints.
    """

    def __init__(
        self,
        *,
        data_manager: DataManager | None = None,
        backtest_service: BacktestService | None = None,
    ) -> None:
        self._data_manager = data_manager or DataManager()
        # BacktestService gives us _load_price_dataframe and timeframe helpers.
        self._backtest_service = backtest_service or BacktestService(
            data_manager=self._data_manager,
        )

    # -------------------------
    # Public API
    # -------------------------

    def run_portfolio_backtest(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        portfolio_id: int,
        timeframe: str,
        start: datetime,
        end: datetime,
        initial_capital: float,
    ) -> PortfolioBacktest:
        """Run a portfolio backtest and persist a PortfolioBacktest record."""

        portfolio = meta_db.get(Portfolio, portfolio_id)
        if portfolio is None:
            msg = f"Portfolio {portfolio_id} not found"
            raise ValueError(msg)

        symbols = self._resolve_universe_symbols(meta_db, portfolio)
        if not symbols:
            msg = "Portfolio universe resolved to an empty symbol list"
            raise ValueError(msg)

        # Load price data for each symbol into a DataFrame, ensuring coverage
        # exists via the DataManager. For v1 we require the intersection of
        # all symbol timelines to be non-empty so that each rebalance point
        # has prices for every active name.
        price_data: Dict[str, pd.DataFrame] = {}
        for symbol in symbols:
            self._data_manager.ensure_symbol_coverage(
                prices_db,
                symbol=symbol,
                timeframe=timeframe,
                start=start,
                end=end,
                source="prices_db",
            )
            df = self._backtest_service._load_price_dataframe(  # type: ignore[attr-defined]
                prices_db,
                symbol=symbol,
                timeframe=timeframe,
                start=start,
                end=end,
            )
            if df is None or df.empty:
                msg = f"No price data available for portfolio symbol {symbol}"
                raise ValueError(msg)
            # Ensure index is sorted ascending.
            df = df.sort_index()
            price_data[symbol] = df

        timeline = self._compute_common_timeline(price_data.values(), start, end)
        if not timeline:
            msg = "No common timeline across portfolio symbols for requested window"
            raise ValueError(msg)

        equity_curve = self._simulate_equal_weight_portfolio(
            symbols=symbols,
            price_data=price_data,
            timeline=timeline,
            initial_capital=initial_capital,
            risk_profile=portfolio.risk_profile_json or {},
        )

        final_equity = equity_curve[-1].equity if equity_curve else initial_capital
        pnl = final_equity - initial_capital

        metrics = {
            "initial_capital": float(initial_capital),
            "final_value": float(final_equity),
            "pnl": float(pnl),
            "equity_curve": [
                {"timestamp": pt.timestamp.isoformat(), "equity": float(pt.equity)}
                for pt in equity_curve
            ],
            "universe_symbols": symbols,
        }

        bt = PortfolioBacktest(
            portfolio_id=portfolio.id,
            start_date=start,
            end_date=end,
            timeframe=timeframe,
            initial_capital=initial_capital,
            config_snapshot_json={
                "universe_scope": portfolio.universe_scope,
                "allowed_strategies": portfolio.allowed_strategies_json,
            },
            risk_profile_snapshot_json=portfolio.risk_profile_json,
            status="completed",
            metrics_json=metrics,
        )
        meta_db.add(bt)
        meta_db.commit()
        meta_db.refresh(bt)
        return bt

    # -------------------------
    # Helpers
    # -------------------------

    def _resolve_universe_symbols(
        self,
        meta_db: Session,
        portfolio: Portfolio,
    ) -> List[str]:
        """Resolve portfolio.universe_scope into a list of stock symbols.

        V1 supports universe_scope strings of the form 'group:<id>'. Other
        forms are reserved for future work.
        """

        scope = portfolio.universe_scope or ""
        if scope.startswith("group:"):
            _, group_id_str = scope.split(":", 1)
            group_id = int(group_id_str)
            group = meta_db.get(StockGroup, group_id)
            if group is None:
                msg = f"StockGroup {group_id} referenced by portfolio not found"
                raise ValueError(msg)
            # Use an explicit join via StockGroupMember to keep ordering
            # deterministic.
            rows = (
                meta_db.query(Stock)
                .join(StockGroupMember, StockGroupMember.stock_id == Stock.id)
                .filter(StockGroupMember.group_id == group_id)
                .order_by(Stock.symbol.asc())
                .all()
            )
            return [row.symbol for row in rows]

        msg = (
            "Portfolio.universe_scope must currently be of the form 'group:<id>'. "
            f"Got '{scope}'."
        )
        raise ValueError(msg)

    def _compute_common_timeline(
        self,
        frames: Sequence[pd.DataFrame],
        start: datetime,
        end: datetime,
    ) -> List[datetime]:
        """Compute the common timestamp intersection across all DataFrames."""

        if not frames:
            return []

        # Normalise start/end to naive UTC datetimes so they can be compared
        # against the pandas/SQLite timestamps, which are stored without
        # timezone information.
        if start.tzinfo is not None:
            start = start.replace(tzinfo=None)
        if end.tzinfo is not None:
            end = end.replace(tzinfo=None)

        index_sets = [set(df.index) for df in frames]
        common = set.intersection(*index_sets)
        filtered = [ts for ts in common if start <= ts <= end]
        return sorted(filtered)

    def _simulate_equal_weight_portfolio(
        self,
        *,
        symbols: List[str],
        price_data: Dict[str, pd.DataFrame],
        timeline: List[datetime],
        initial_capital: float,
        risk_profile: Dict[str, object],
    ) -> List[PortfolioEquityPoint]:
        """Long-only, equal-weight portfolio simulation.

        - At each timestamp on the common timeline we:
          - Mark to market existing holdings.
          - Compute equal-weight target weights across the active universe,
            respecting maxPositionSizePct and maxConcurrentPositions.
          - Compute trade sizes needed to reach those weights.
        """

        max_pos_pct = float(risk_profile.get("maxPositionSizePct", 100.0))
        max_positions = int(risk_profile.get("maxConcurrentPositions", len(symbols)))
        max_positions = max(1, min(max_positions, len(symbols)))

        # State: holdings in shares and free cash.
        holdings: Dict[str, float] = {sym: 0.0 for sym in symbols}
        cash = float(initial_capital)

        equity_curve: List[PortfolioEquityPoint] = []

        for ts in timeline:
            prices: Dict[str, float] = {}
            for sym in symbols:
                df = price_data[sym]
                if ts not in df.index:
                    # This should not happen after computing the common
                    # timeline, but guard just in case.
                    continue
                row = df.loc[ts]
                # When multiple rows share the same timestamp (e.g. duplicate
                # inserts), df.loc[ts] returns a DataFrame; fall back to the
                # last close in that slice.
                if hasattr(row, "iloc") and not hasattr(row, "dtype"):
                    price = float(row["close"].iloc[-1])
                else:
                    price = float(row["close"])
                prices[sym] = price

            # If for some reason we have no prices, carry forward equity.
            if not prices:
                if equity_curve:
                    equity_curve.append(
                        PortfolioEquityPoint(
                            timestamp=ts,
                            equity=equity_curve[-1].equity,
                        )
                    )
                continue

            total_equity = cash + sum(holdings[sym] * prices[sym] for sym in symbols)

            # Determine number of names we can hold given max_positions.
            active_symbols = symbols[:max_positions]
            if not active_symbols:
                equity_curve.append(
                    PortfolioEquityPoint(timestamp=ts, equity=total_equity)
                )
                continue

            base_weight = 1.0 / float(len(active_symbols))
            max_weight = max_pos_pct / 100.0
            if base_weight > max_weight:
                base_weight = max_weight

            target_weights: Dict[str, float] = {
                sym: base_weight for sym in active_symbols
            }

            desired_notional: Dict[str, float] = {
                sym: total_equity * w for sym, w in target_weights.items()
            }
            current_notional: Dict[str, float] = {
                sym: holdings[sym] * prices[sym] for sym in symbols
            }

            # Compute share adjustments per symbol. Long-only: we never short;
            # when delta_notional is negative we reduce or close the position
            # but never flip through zero.
            for sym in active_symbols:
                price = prices[sym]
                if price <= 0.0:
                    continue

                delta_notional = desired_notional.get(sym, 0.0) - current_notional.get(
                    sym, 0.0
                )
                # Convert notional delta into integer shares.
                delta_shares = int(delta_notional // price)

                # If we are reducing, ensure we do not short.
                if delta_shares < 0:
                    max_reducible = int(holdings[sym])
                    if -delta_shares > max_reducible:
                        delta_shares = -max_reducible

                if delta_shares == 0:
                    continue

                trade_notional = delta_shares * price
                # Skip trades that we cannot afford with current cash.
                if trade_notional > cash and delta_shares > 0:
                    continue

                holdings[sym] += float(delta_shares)
                cash -= float(trade_notional)

            # Recompute equity after trades.
            total_equity = cash + sum(holdings[sym] * prices[sym] for sym in symbols)
            equity_curve.append(PortfolioEquityPoint(timestamp=ts, equity=total_equity))

        return equity_curve
