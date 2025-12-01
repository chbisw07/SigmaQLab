from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from statistics import mean
from typing import Dict, List, Sequence, Tuple

import pandas as pd
from sqlalchemy.orm import Session

from .backtest_engine import EquityPoint
from .backtest_service import BacktestService
from .data_manager import DataManager
from .models import (
    BacktestFactorExposure,
    BacktestSectorExposure,
    FactorExposure,
    Portfolio,
    PortfolioBacktest,
    PortfolioConstraints,
    Stock,
    StockGroup,
    StockGroupMember,
)
from .services import OptimizerService


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
        optimizer_service: OptimizerService | None = None,
    ) -> None:
        self._data_manager = data_manager or DataManager()
        # BacktestService gives us _load_price_dataframe and timeframe helpers.
        self._backtest_service = backtest_service or BacktestService(
            data_manager=self._data_manager,
        )
        self._optimizer_service = optimizer_service or OptimizerService()

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
        """Run a portfolio backtest and persist a PortfolioBacktest record.

        S16/G04 upgrades this from a simple equal-weight engine to a
        factor-aware, optimiser-driven backtest:
        - Universe is still resolved from a stock group.
        - Rebalancing dates are derived from portfolio.rebalance_policy_json.
        - At each rebalance we invoke OptimizerService to obtain target weights
          based on historical factors and risk (covariance matrices).
        - Holdings drift between rebalances as prices move.
        """

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

        (
            equity_curve,
            utilisation_history,
            final_holdings,
            final_prices,
            factor_exposures_ts,
            sector_exposures_ts,
            rebalance_risk_metrics,
        ) = self._simulate_optimised_portfolio(
            meta_db=meta_db,
            prices_db=prices_db,
            portfolio=portfolio,
            symbols=symbols,
            price_data=price_data,
            timeline=timeline,
            initial_capital=initial_capital,
        )

        final_equity = equity_curve[-1].equity if equity_curve else initial_capital
        pnl = final_equity - initial_capital

        # Reuse the existing equity-metrics helper so portfolio metrics are
        # consistent with single-strategy backtests.
        equity_points = [
            EquityPoint(timestamp=pt.timestamp, equity=pt.equity) for pt in equity_curve
        ]
        equity_metrics: Dict[str, float] = {}
        if equity_points:
            equity_metrics = self._backtest_service._compute_equity_metrics(  # type: ignore[attr-defined]
                equity_points,
                timeframe=timeframe,
            )

        metrics: Dict[str, object] = {
            "initial_capital": float(initial_capital),
            "final_value": float(final_equity),
            "pnl": float(pnl),
            "equity_curve": [
                {"timestamp": pt.timestamp.isoformat(), "equity": float(pt.equity)}
                for pt in equity_curve
            ],
            "universe_symbols": symbols,
            # In this v1 engine there are no explicit trades, so all PnL is
            # unrealised mark-to-market from the holdings.
            "pnl_realised": 0.0,
            "pnl_unrealised": float(pnl),
            "pnl_what_if": float(pnl),
        }

        metrics.update(equity_metrics)

        # Simple historical CVaR (95%) based on daily equity returns.
        cvar_95 = self._compute_cvar_95(equity_curve)
        if cvar_95 is not None:
            metrics["cvar_95"] = cvar_95

        # Aggregate optimiser risk metrics across rebalances when available.
        if rebalance_risk_metrics:
            agg_risk: Dict[str, float] = {}
            keys = set().union(*(m.keys() for m in rebalance_risk_metrics))
            for key in keys:
                vals = [float(m[key]) for m in rebalance_risk_metrics if key in m]
                if vals:
                    agg_risk[key] = float(mean(vals))
            # Expose as top-level helpers and under a namespaced key.
            metrics.setdefault("volatility", agg_risk.get("volatility", 0.0))
            if "beta" in agg_risk:
                metrics["beta"] = agg_risk["beta"]
            metrics["optimizer_risk"] = agg_risk

        if utilisation_history:
            metrics["avg_capital_utilisation"] = float(mean(utilisation_history))
            metrics["max_capital_utilisation"] = float(max(utilisation_history))

        # Simple per-symbol contribution based on final holding value versus
        # an equal-split allocation of initial capital.
        if final_holdings and final_prices:
            per_symbol: Dict[str, Dict[str, float]] = {}
            per_name_initial = initial_capital / float(len(final_holdings))
            for sym, shares in final_holdings.items():
                price = final_prices.get(sym, 0.0)
                final_val = float(shares) * float(price)
                per_symbol[sym] = {
                    "final_value": final_val,
                    "pnl": final_val - per_name_initial,
                }
            metrics["per_symbol"] = per_symbol

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

        # Persist factor and sector exposures per rebalance date for this
        # backtest. For S16 we store one row per rebalance date.
        for as_of, exposures in factor_exposures_ts.items():
            meta_db.add(
                BacktestFactorExposure(
                    backtest_id=bt.id,
                    date=as_of,
                    value=exposures.get("value"),
                    quality=exposures.get("quality"),
                    momentum=exposures.get("momentum"),
                    low_vol=exposures.get("low_vol"),
                    size=exposures.get("size"),
                )
            )

        for as_of, sector_weights in sector_exposures_ts.items():
            for sector, weight in sector_weights.items():
                meta_db.add(
                    BacktestSectorExposure(
                        backtest_id=bt.id,
                        date=as_of,
                        sector=sector,
                        weight=float(weight),
                    )
                )

        meta_db.commit()
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
    ) -> tuple[
        List[PortfolioEquityPoint],
        List[float],
        Dict[str, float],
        Dict[str, float],
    ]:
        """Long-only, equal-weight portfolio simulation with basic diagnostics.

        - At each timestamp on the common timeline we:
          - Mark to market existing holdings.
          - Compute equal-weight target weights across the active universe,
            respecting maxPositionSizePct and maxConcurrentPositions.
          - Compute trade sizes needed to reach those weights.
        - Returns equity curve, capital-utilisation history, final holdings,
          and final prices for contribution analysis.
        """

        max_pos_pct = float(risk_profile.get("maxPositionSizePct", 100.0))
        max_positions = int(risk_profile.get("maxConcurrentPositions", len(symbols)))
        max_positions = max(1, min(max_positions, len(symbols)))

        # State: holdings in shares and free cash.
        holdings: Dict[str, float] = {sym: 0.0 for sym in symbols}
        cash = float(initial_capital)

        equity_curve: List[PortfolioEquityPoint] = []
        utilisation_history: List[float] = []

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
                utilisation_history.append(0.0)
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
                    sym,
                    0.0,
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

            invested_notional = sum(holdings[sym] * prices[sym] for sym in symbols)
            utilisation = (
                invested_notional / total_equity if total_equity > 0.0 else 0.0
            )
            utilisation_history.append(utilisation)

        # Snapshot of final prices for contribution calculations.
        final_prices: Dict[str, float] = {}
        if timeline:
            last_ts = timeline[-1]
            for sym in symbols:
                df = price_data[sym]
                if last_ts in df.index:
                    row = df.loc[last_ts]
                    if hasattr(row, "iloc") and not hasattr(row, "dtype"):
                        price = float(row["close"].iloc[-1])
                    else:
                        price = float(row["close"])
                    final_prices[sym] = price

        return equity_curve, utilisation_history, holdings, final_prices

    def _build_rebalance_schedule(
        self,
        timeline: List[datetime],
        *,
        portfolio: Portfolio,
    ) -> List[datetime]:
        """Return rebalance timestamps derived from portfolio policy."""

        if not timeline:
            return []

        policy = portfolio.rebalance_policy_json or {}
        freq_raw = str(policy.get("frequency", "monthly")).lower()
        freq = freq_raw.strip() or "monthly"

        if freq == "daily":
            return list(timeline)

        if freq == "weekly":
            seen_weeks: set[tuple[int, int]] = set()
            rebal: List[datetime] = []
            for ts in timeline:
                iso = ts.isocalendar()
                key = (iso.year, iso.week)
                if key not in seen_weeks:
                    seen_weeks.add(key)
                    rebal.append(ts)
            return rebal

        if freq in {"quarterly", "q"}:
            seen_quarters: set[tuple[int, int]] = set()
            rebal_q: List[datetime] = []
            for ts in timeline:
                quarter = (ts.month - 1) // 3 + 1
                key_q = (ts.year, quarter)
                if key_q not in seen_quarters:
                    seen_quarters.add(key_q)
                    rebal_q.append(ts)
            return rebal_q

        # Default: monthly.
        seen_months: set[tuple[int, int]] = set()
        rebal_m: List[datetime] = []
        for ts in timeline:
            key_m = (ts.year, ts.month)
            if key_m not in seen_months:
                seen_months.add(key_m)
                rebal_m.append(ts)
        return rebal_m

    def _build_constraints_for_portfolio(
        self,
        meta_db: Session,
        *,
        portfolio: Portfolio,
    ) -> Tuple[Dict[str, object] | None, float | None]:
        """Return optimiser constraints dict and turnover limit, if any."""

        constraints: Dict[str, object] | None = None
        turnover_limit: float | None = None

        pc = (
            meta_db.query(PortfolioConstraints)
            .filter(PortfolioConstraints.portfolio_id == portfolio.id)
            .one_or_none()
        )
        if pc is not None:
            constraints = {
                "min_weight": pc.min_weight,
                "max_weight": pc.max_weight,
                "turnover_limit": pc.turnover_limit,
                "target_volatility": pc.target_volatility,
                "max_beta": pc.max_beta,
                "sector_caps": pc.sector_caps_json,
                "factor_constraints": pc.factor_constraints_json,
            }
            turnover_limit = pc.turnover_limit

        # Fallback: derive max_weight from risk profile when not stored.
        risk = portfolio.risk_profile_json or {}
        max_pos_pct = risk.get("maxPositionSizePct")
        if max_pos_pct is not None:
            max_weight = float(max_pos_pct) / 100.0
            if constraints is None:
                constraints = {"max_weight": max_weight}
            elif constraints.get("max_weight") is None:
                constraints["max_weight"] = max_weight

        return constraints, turnover_limit

    @staticmethod
    def _apply_turnover_limit(
        *,
        symbols: List[str],
        previous_weights: Dict[str, float] | None,
        new_weights: Dict[str, float],
        turnover_limit: float | None,
    ) -> Dict[str, float]:
        """Scale weight changes to respect a simple turnover cap.

        turnover = sum |w_new - w_old|
        When turnover exceeds the configured limit, we scale deltas so that
        turnover matches the limit while preserving directionality and then
        renormalise to sum to 1.
        """

        if turnover_limit is None or turnover_limit <= 0.0:
            return new_weights

        prev = previous_weights or {}
        deltas: Dict[str, float] = {}
        turnover = 0.0
        for sym in symbols:
            w_old = float(prev.get(sym, 0.0))
            w_new = float(new_weights.get(sym, 0.0))
            delta = w_new - w_old
            deltas[sym] = delta
            turnover += abs(delta)

        if turnover <= turnover_limit or turnover == 0.0:
            return new_weights

        scale = float(turnover_limit) / float(turnover)
        adjusted: Dict[str, float] = {}
        for sym in symbols:
            w_old = float(prev.get(sym, 0.0))
            delta = deltas.get(sym, 0.0) * scale
            adjusted[sym] = w_old + delta

        # Renormalise to 1.0 while ensuring weights are non-negative.
        min_zero: Dict[str, float] = {s: max(0.0, w) for s, w in adjusted.items()}
        total = sum(min_zero.values())
        if total <= 0.0:
            equal = 1.0 / float(len(symbols)) if symbols else 0.0
            return {s: equal for s in symbols}
        return {s: w / total for s, w in min_zero.items()}

    @staticmethod
    def _compute_cvar_95(
        equity_curve: List[PortfolioEquityPoint],
    ) -> float | None:
        """Compute simple historical CVaR (95%) from equity curve."""

        if len(equity_curve) < 2:
            return None

        returns: List[float] = []
        for prev, curr in zip(equity_curve, equity_curve[1:], strict=False):
            if prev.equity <= 0.0:
                continue
            ret = (curr.equity / prev.equity) - 1.0
            returns.append(ret)

        if not returns:
            return None

        returns.sort()
        tail_count = max(int(len(returns) * 0.05), 1)
        tail = returns[:tail_count]
        return float(sum(tail) / float(len(tail)))

    def _simulate_optimised_portfolio(
        self,
        *,
        meta_db: Session,
        prices_db: Session,
        portfolio: Portfolio,
        symbols: List[str],
        price_data: Dict[str, pd.DataFrame],
        timeline: List[datetime],
        initial_capital: float,
    ) -> tuple[
        List[PortfolioEquityPoint],
        List[float],
        Dict[str, float],
        Dict[str, float],
        Dict[date, Dict[str, float]],
        Dict[date, Dict[str, float]],
        List[Dict[str, float]],
    ]:
        """Optimiser-driven portfolio simulation with scheduled rebalancing."""

        if not timeline:
            return ([], [], {}, {}, {}, {}, [])

        rebalance_dates = self._build_rebalance_schedule(
            timeline,
            portfolio=portfolio,
        )

        constraints, turnover_limit = self._build_constraints_for_portfolio(
            meta_db,
            portfolio=portfolio,
        )

        # Basic sector metadata for exposures.
        stocks = (
            meta_db.query(Stock)
            .filter(Stock.symbol.in_(symbols))  # type: ignore[arg-type]
            .all()
        )
        sector_by_symbol: Dict[str, str] = {
            s.symbol: (s.sector or "Unknown") for s in stocks
        }

        equity_curve: List[PortfolioEquityPoint] = []
        utilisation_history: List[float] = []
        holdings: Dict[str, float] = {sym: 0.0 for sym in symbols}
        cash = float(initial_capital)

        factor_exposures_ts: Dict[date, Dict[str, float]] = {}
        sector_exposures_ts: Dict[date, Dict[str, float]] = {}
        risk_metrics_by_rebalance: List[Dict[str, float]] = []

        previous_weights: Dict[str, float] | None = None

        rebalance_set = set(rebalance_dates)

        for ts in timeline:
            prices: Dict[str, float] = {}
            for sym in symbols:
                df = price_data[sym]
                if ts not in df.index:
                    continue
                row = df.loc[ts]
                if hasattr(row, "iloc") and not hasattr(row, "dtype"):
                    price = float(row["close"].iloc[-1])
                else:
                    price = float(row["close"])
                prices[sym] = price

            if not prices:
                if equity_curve:
                    equity_curve.append(
                        PortfolioEquityPoint(
                            timestamp=ts,
                            equity=equity_curve[-1].equity,
                        )
                    )
                continue

            # Mark-to-market before any rebalance on this timestamp.
            nav_before = cash + sum(
                holdings[sym] * prices.get(sym, 0.0) for sym in symbols
            )

            if ts in rebalance_set:
                as_of = ts.date()
                # Optimise weights as of this date using historical factors.
                (
                    weights_list,
                    risk_metrics,
                    _,
                    _,
                ) = self._optimizer_service.optimise_portfolio(
                    meta_db=meta_db,
                    prices_db=prices_db,
                    portfolio_id=portfolio.id,
                    as_of_date=as_of,
                    optimizer_type=str(
                        (portfolio.rebalance_policy_json or {}).get(
                            "optimizer_type",
                            "max_sharpe",
                        )
                    ),
                    constraints=constraints,
                    previous_weights=[
                        {"symbol": s, "weight": w}
                        for s, w in (previous_weights or {}).items()
                    ]
                    or None,
                )

                # Convert optimiser output into a symbol → weight mapping.
                raw_weights: Dict[str, float] = {
                    item["symbol"]: float(item["weight"]) for item in weights_list
                }
                # Apply simple turnover cap when configured.
                adj_weights = self._apply_turnover_limit(
                    symbols=symbols,
                    previous_weights=previous_weights,
                    new_weights=raw_weights,
                    turnover_limit=turnover_limit,
                )
                previous_weights = adj_weights

                # Translate target weights into holdings in shares.
                new_holdings: Dict[str, float] = {}
                for sym in symbols:
                    price = prices.get(sym)
                    if price is None or price <= 0.0:
                        new_holdings[sym] = 0.0
                        continue
                    w = float(adj_weights.get(sym, 0.0))
                    notional = nav_before * w
                    shares = notional / price
                    new_holdings[sym] = float(shares)

                invested = sum(
                    new_holdings[sym] * prices.get(sym, 0.0) for sym in symbols
                )
                cash = nav_before - invested
                holdings = new_holdings

                # Persist factor and sector exposures for this rebalance date.
                # Factor exposures are recomputed using the final weights and
                # stored per PRD.
                exposures_for_date: Dict[str, float] = {}
                rows = (
                    meta_db.query(FactorExposure)
                    .filter(
                        FactorExposure.symbol.in_(symbols),  # type: ignore[arg-type]
                        FactorExposure.as_of_date == as_of,
                    )
                    .all()
                )
                by_symbol = {row.symbol: row for row in rows}
                factor_names = ["value", "quality", "momentum", "low_vol", "size"]
                for fname in factor_names:
                    total = 0.0
                    for sym in symbols:
                        w = float(adj_weights.get(sym, 0.0))
                        f_row = by_symbol.get(sym)
                        if f_row is None:
                            continue
                        val = getattr(f_row, fname, None)
                        if val is None:
                            continue
                        total += w * float(val)
                    exposures_for_date[fname] = total
                factor_exposures_ts[as_of] = exposures_for_date

                sector_weights: Dict[str, float] = {}
                for sym in symbols:
                    sector = sector_by_symbol.get(sym, "Unknown")
                    w = float(adj_weights.get(sym, 0.0))
                    sector_weights[sector] = sector_weights.get(sector, 0.0) + w
                sector_exposures_ts[as_of] = sector_weights

                risk_metrics_by_rebalance.append(
                    {k: float(v) for k, v in risk_metrics.items()}
                )

            # NAV after any rebalance at this timestamp.
            nav_after = cash + sum(
                holdings[sym] * prices.get(sym, 0.0) for sym in symbols
            )
            equity_curve.append(PortfolioEquityPoint(timestamp=ts, equity=nav_after))

            invested_notional = sum(
                holdings[sym] * prices.get(sym, 0.0) for sym in symbols
            )
            utilisation = invested_notional / nav_after if nav_after > 0.0 else 0.0
            utilisation_history.append(utilisation)

        # Snapshot of final prices for contribution calculations.
        final_prices: Dict[str, float] = {}
        if timeline:
            last_ts = timeline[-1]
            for sym in symbols:
                df = price_data[sym]
                if last_ts in df.index:
                    row = df.loc[last_ts]
                    if hasattr(row, "iloc") and not hasattr(row, "dtype"):
                        price = float(row["close"].iloc[-1])
                    else:
                        price = float(row["close"])
                    final_prices[sym] = price

        return (
            equity_curve,
            utilisation_history,
            holdings,
            final_prices,
            factor_exposures_ts,
            sector_exposures_ts,
            risk_metrics_by_rebalance,
        )
