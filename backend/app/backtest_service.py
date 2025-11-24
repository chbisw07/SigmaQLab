from __future__ import annotations

from datetime import datetime
from math import sqrt
from statistics import mean, pstdev
from typing import Any, Dict, List, Optional

import pandas as pd
from sqlalchemy.orm import Session

from .backtest_engine import BacktestConfig, BacktraderEngine, EquityPoint, TradeRecord
from .models import (
    Backtest,
    BacktestEquityPoint,
    BacktestTrade,
    Strategy,
    StrategyParameter,
)
from .prices_models import PriceBar


_TIMEFRAME_MINUTES: Dict[str, int] = {
    "1m": 1,
    "3m": 3,
    "5m": 5,
    "15m": 15,
    "30m": 30,
    "60m": 60,
    "1h": 60,
    "1d": 24 * 60,
}

_PANDAS_FREQ: Dict[str, str] = {
    "1m": "1T",
    "3m": "3T",
    "5m": "5T",
    "15m": "15T",
    "30m": "30T",
    "60m": "60T",
    "1h": "60T",
    "1d": "1D",
}


class BacktestService:
    """Service layer for running backtests against stored price data."""

    def __init__(self, *, engine: BacktraderEngine | None = None) -> None:
        self._engine = engine or BacktraderEngine()

    def run_single_backtest(
        self,
        meta_db: Session,
        prices_db: Session,
        *,
        strategy_id: int,
        symbol: str,
        timeframe: str,
        start: datetime,
        end: datetime,
        initial_capital: float,
        params: Dict[str, Any] | None = None,
        params_id: int | None = None,
        price_source: str | None = None,
        label: str | None = None,
        notes: str | None = None,
        risk_config: Dict[str, Any] | None = None,
        costs_config: Dict[str, Any] | None = None,
        visual_config: Dict[str, Any] | None = None,
    ) -> Backtest:
        """Run a single backtest and persist a Backtest record.

        The function:
        - Loads the Strategy (and optional StrategyParameter) from the meta DB.
        - Loads OHLCV from the prices DB (price_bars).
        - Runs the Backtrader engine.
        - Persists an entry in the `backtests` table with basic metrics.
        """

        strategy = meta_db.get(Strategy, strategy_id)
        if strategy is None:
            msg = f"Strategy {strategy_id} not found"
            raise ValueError(msg)

        engine_code = strategy.engine_code or strategy.code

        resolved_params: Dict[str, Any] = {}
        if params_id is not None:
            param = meta_db.get(StrategyParameter, params_id)
            if param is None:
                msg = f"StrategyParameter {params_id} not found"
                raise ValueError(msg)
            resolved_params.update(param.params_json or {})
        if params:
            resolved_params.update(params)

        # First attempt: direct match on requested timeframe.
        price_rows = (
            prices_db.query(PriceBar)
            .filter(
                PriceBar.symbol == symbol,
                PriceBar.timeframe == timeframe,
                PriceBar.timestamp >= start,
                PriceBar.timestamp <= end,
            )
            .order_by(PriceBar.timestamp.asc())
            .all()
        )

        df: Optional[pd.DataFrame]
        if price_rows:
            df = pd.DataFrame(
                {
                    "open": [r.open for r in price_rows],
                    "high": [r.high for r in price_rows],
                    "low": [r.low for r in price_rows],
                    "close": [r.close for r in price_rows],
                    "volume": [r.volume or 0.0 for r in price_rows],
                },
                index=[r.timestamp for r in price_rows],
            )
        else:
            # Fallback: attempt to aggregate from a finer timeframe (e.g. 1h -> 1d).
            df = self._aggregate_from_lower_timeframe(
                prices_db=prices_db,
                symbol=symbol,
                target_timeframe=timeframe,
                start=start,
                end=end,
            )

        if df is None or df.empty:
            msg = "No price data available for given symbol/timeframe window"
            raise ValueError(msg)

        cfg = BacktestConfig(
            strategy_code=engine_code,
            symbol=symbol,
            timeframe=timeframe,
            initial_capital=initial_capital,
            params=resolved_params,
            risk_config=risk_config,
            costs_config=costs_config,
        )
        result = self._engine.run(cfg, df)

        # Apply transactional costs if a costs_config has been provided. This
        # will adjust per-trade PnL and the equity curve so that downstream
        # metrics are computed on a net-of-cost basis where possible.
        equity_curve_with_costs = result.equity_curve
        trades_with_costs = result.trades
        gross_final_value = float(result.metrics.get("final_value", initial_capital))
        gross_pnl = float(
            result.metrics.get("pnl", gross_final_value - initial_capital)
        )
        total_costs = 0.0

        if costs_config and result.trades and result.equity_curve:
            (
                equity_curve_with_costs,
                trades_with_costs,
                total_costs,
            ) = self._apply_costs_indian_equity(
                equity_curve=result.equity_curve,
                trades=result.trades,
                costs_config=costs_config,
            )

        # Derive richer metrics from (possibly adjusted) equity curve and trades.
        metrics: Dict[str, float] = dict(result.metrics)

        # Preserve gross figures explicitly so callers can compare if needed.
        metrics["gross_final_value"] = gross_final_value
        metrics["gross_pnl"] = gross_pnl
        metrics["total_costs"] = total_costs

        if total_costs > 0.0:
            net_final_value = gross_final_value - total_costs
            net_pnl = gross_pnl - total_costs
            metrics["final_value"] = net_final_value
            metrics["pnl"] = net_pnl
            metrics["pnl_net"] = net_pnl
        else:
            metrics["pnl_net"] = gross_pnl

        metrics.update(
            self._compute_equity_metrics(
                equity_curve_with_costs,
                timeframe=timeframe,
            )
        )
        metrics.update(self._compute_trade_metrics(trades_with_costs))

        # Partition total PnL into realised (from closed trades) and
        # unrealised (open mark-to-market) components so the UI can explain
        # why equity and trade-level PnL may differ.
        realised_pnl = 0.0
        if isinstance(trades_with_costs, list):
            realised_pnl = sum(
                float(t.pnl) for t in trades_with_costs if isinstance(t, TradeRecord)
            )
        total_pnl = float(metrics.get("pnl", gross_pnl - total_costs))
        unrealised_pnl = total_pnl - realised_pnl
        metrics["pnl_realised"] = realised_pnl
        metrics["pnl_unrealised"] = unrealised_pnl
        # For now, the "what-if" PnL corresponds to the current open
        # mark-to-market. In future we may extend this to include estimated
        # exit costs.
        metrics["pnl_what_if"] = unrealised_pnl

        backtest = Backtest(
            strategy_id=strategy.id,
            params_id=params_id,
            engine="backtrader",
            label=label,
            notes=notes,
            symbols_json=[symbol],
            timeframe=timeframe,
            start_date=start,
            end_date=end,
            initial_capital=initial_capital,
            starting_portfolio_json=None,
            params_effective_json=resolved_params or None,
            risk_config_json=risk_config,
            costs_config_json=costs_config,
            visual_config_json=visual_config,
            status="completed",
            metrics_json=metrics,
            data_source=price_source,
        )
        meta_db.add(backtest)
        meta_db.commit()
        meta_db.refresh(backtest)

        # Persist equity curve points.
        if isinstance(equity_curve_with_costs, list) and equity_curve_with_costs:
            equity_rows: List[BacktestEquityPoint] = [
                BacktestEquityPoint(
                    backtest_id=backtest.id,
                    timestamp=pt.timestamp,
                    equity=pt.equity,
                )
                for pt in equity_curve_with_costs
                if isinstance(pt, EquityPoint)
            ]
            meta_db.add_all(equity_rows)

        # Persist trades, including per-trade metrics derived from the price
        # series (e.g. holding period and what-if projections). When storing
        # exit_price, we prefer the close from the OHLCV series at the
        # exit_timestamp so that the UI shows a value consistent with the
        # chart, even if Backtrader's internal fills occurred intrabar.
        if isinstance(trades_with_costs, list) and trades_with_costs:
            trade_rows: List[BacktestTrade] = []

            closes = df["close"]
            for trade in trades_with_costs:
                if not isinstance(trade, TradeRecord):
                    continue

                # Determine direction for projections.
                direction = 1.0 if trade.side == "long" else -1.0

                # Locate bars from entry onward.
                mask_from_entry = closes.index >= trade.entry_timestamp
                window_after_entry = closes[mask_from_entry]

                # Holding-period mask up to the exit bar.
                mask_holding = (closes.index >= trade.entry_timestamp) & (
                    closes.index <= trade.exit_timestamp
                )
                holding_window = closes[mask_holding]

                holding_period_bars: int | None = None
                if not holding_window.empty:
                    holding_period_bars = int(len(holding_window))

                notional = trade.entry_price * trade.size
                pnl_pct: float | None = None
                if notional > 0:
                    pnl_pct = trade.pnl / notional

                max_theoretical_pnl: float | None = None
                max_theoretical_pnl_pct: float | None = None
                pnl_capture_ratio: float | None = None

                if not window_after_entry.empty and notional > 0:
                    price_diff = window_after_entry - trade.entry_price
                    projection = direction * price_diff * trade.size
                    max_theoretical_pnl = float(projection.max())
                    if max_theoretical_pnl != 0:
                        max_theoretical_pnl_pct = max_theoretical_pnl / notional
                        pnl_capture_ratio = trade.pnl / max_theoretical_pnl

                # Align exit_price with the charted close at (or just before)
                # the recorded exit_timestamp so that the trades table and
                # price chart remain visually consistent.
                exit_price_chart = trade.exit_price
                if trade.exit_timestamp in closes.index:
                    exit_price_chart = float(closes.loc[trade.exit_timestamp])
                else:
                    # Find the last bar at or before the exit timestamp.
                    idx = closes.index.searchsorted(trade.exit_timestamp)
                    if idx == 0:
                        exit_price_chart = float(closes.iloc[0])
                    else:
                        exit_price_chart = float(closes.iloc[idx - 1])

                trade_rows.append(
                    BacktestTrade(
                        backtest_id=backtest.id,
                        symbol=trade.symbol or symbol,
                        side=trade.side,
                        size=trade.size,
                        entry_timestamp=trade.entry_timestamp,
                        entry_price=trade.entry_price,
                        exit_timestamp=trade.exit_timestamp,
                        exit_price=exit_price_chart,
                        pnl=trade.pnl,
                        pnl_pct=pnl_pct,
                        holding_period_bars=holding_period_bars,
                        max_theoretical_pnl=max_theoretical_pnl,
                        max_theoretical_pnl_pct=max_theoretical_pnl_pct,
                        pnl_capture_ratio=pnl_capture_ratio,
                        entry_order_type=trade.entry_order_type,
                        exit_order_type=trade.exit_order_type,
                        entry_brokerage=trade.entry_brokerage,
                        exit_brokerage=trade.exit_brokerage,
                        entry_reason=trade.entry_reason,
                        exit_reason=trade.exit_reason,
                    )
                )

            if trade_rows:
                meta_db.add_all(trade_rows)

        meta_db.commit()

        return backtest

    def _apply_costs_indian_equity(
        self,
        *,
        equity_curve: List[EquityPoint],
        trades: List[TradeRecord],
        costs_config: Dict[str, Any],
    ) -> tuple[List[EquityPoint], List[TradeRecord], float]:
        """Apply an approximate Indian equity cost model (Zerodha style).

        The goal is to capture the dominant components of trading costs for
        NSE/BSE cash equities:

        - Brokerage:
          - Delivery (CNC): zero brokerage.
          - Intraday (MIS): 0.03% or Rs. 20 per executed order, whichever lower.
        - STT/CTT, exchange transaction charges, SEBI, stamp duty, GST.

        We intentionally keep the model simple and slightly conservative rather
        than re-implementing every corner case. All numbers are approximate
        and may diverge slightly from live contract notes.
        """

        if not equity_curve or not trades:
            return equity_curve, trades, 0.0

        broker = str(costs_config.get("broker") or "").lower()
        if broker and broker != "zerodha":
            # Only a Zerodha-equity model is implemented for now.
            return equity_curve, trades, 0.0

        product_type = str(
            costs_config.get("productType") or costs_config.get("product") or "auto"
        ).lower()

        def classify_trade(t: TradeRecord) -> str:
            """Return 'intraday' or 'delivery' for this trade.

            - If explicit productType is 'intraday' -> intraday.
            - If explicit productType is 'delivery' -> delivery.
            - If auto/default:
              - Any trade whose entry and exit are on the same calendar day is
                treated as intraday.
              - Any trade that spans days is treated as delivery, regardless of
                side.
            """

            entry_date = t.entry_timestamp.date()
            exit_date = t.exit_timestamp.date()

            if product_type == "intraday":
                return "intraday"
            if product_type == "delivery":
                return "delivery"

            return "intraday" if entry_date == exit_date else "delivery"

        total_costs = 0.0
        per_trade_costs: List[tuple[datetime, float]] = []
        trades_net: List[TradeRecord] = []

        for t in trades:
            side = t.side.lower()
            qty = float(t.size)
            entry_price = float(t.entry_price)
            exit_price = float(t.exit_price)

            if qty <= 0 or entry_price <= 0 or exit_price <= 0:
                trades_net.append(t)
                continue

            if side == "long":
                buy_notional = entry_price * qty
                sell_notional = exit_price * qty
            else:
                # For shorts, treat the sell at entry and buy at exit.
                buy_notional = exit_price * qty
                sell_notional = entry_price * qty

            turnover = buy_notional + sell_notional
            kind = classify_trade(t)

            # Constants derived from Zerodha's public charges for equity cash.
            # We track buy/sell side components separately so that entry/exit
            # costs can be shown in the trades table.
            brokerage_buy = 0.0
            brokerage_sell = 0.0
            stt_buy = 0.0
            stt_sell = 0.0
            tx_buy = 0.0
            tx_sell = 0.0
            sebi_buy = 0.0
            sebi_sell = 0.0
            stamp_buy = 0.0
            stamp_sell = 0.0
            dp_sell = 0.0

            if kind == "intraday":
                # Brokerage: 0.03% or Rs. 20 per executed order (per side).
                def _intraday_brokerage(notional: float) -> float:
                    return min(0.0003 * notional, 20.0)

                brokerage_buy = _intraday_brokerage(buy_notional)
                brokerage_sell = _intraday_brokerage(sell_notional)

                # STT: 0.025% on sell side.
                stt_sell = 0.00025 * sell_notional

                # Transaction charges (NSE): ~0.00297% of turnover.
                tx_buy = 0.0000297 * buy_notional
                tx_sell = 0.0000297 * sell_notional

                # SEBI: Rs. 10 per crore of turnover.
                sebi_buy = (10.0 / 10_000_000.0) * buy_notional
                sebi_sell = (10.0 / 10_000_000.0) * sell_notional

                # Stamp duty: 0.003% on buy side.
                stamp_buy = 0.00003 * buy_notional
            else:
                # Delivery (CNC): zero brokerage.
                brokerage_buy = 0.0
                brokerage_sell = 0.0

                # STT: effectively 0.1% of turnover, charged on the sell leg.
                stt_buy = 0.0
                stt_sell = 0.001 * turnover

                # Transaction charges (NSE): ~0.00297% of turnover, split per side.
                tx_buy = 0.0000297 * buy_notional
                tx_sell = 0.0000297 * sell_notional

                # SEBI: Rs. 10 per crore of turnover, split per side.
                sebi_buy = (10.0 / 10_000_000.0) * buy_notional
                sebi_sell = (10.0 / 10_000_000.0) * sell_notional

                # Stamp duty: 0.015% on buy side.
                stamp_buy = 0.00015 * buy_notional
                # DP charges: flat fee per sell transaction (delivery sell).
                dp_sell = 15.93

            # GST: 18% on (brokerage + SEBI + transaction charges) per side.
            gst_buy = 0.18 * (brokerage_buy + sebi_buy + tx_buy)
            gst_sell = 0.18 * (brokerage_sell + sebi_sell + tx_sell)

            entry_cost = (
                brokerage_buy + stt_buy + tx_buy + sebi_buy + stamp_buy + gst_buy
            )
            exit_cost = (
                brokerage_sell
                + stt_sell
                + tx_sell
                + sebi_sell
                + stamp_sell
                + gst_sell
                + dp_sell
            )

            cost = entry_cost + exit_cost
            total_costs += cost
            per_trade_costs.append((t.exit_timestamp, cost))

            # Order type reflects the broker product:
            # - intraday trades -> MIS
            # - multi-day trades -> CNC
            entry_order_type = "MIS" if kind == "intraday" else "CNC"
            exit_order_type = entry_order_type

            entry_reason = t.entry_reason
            exit_reason = t.exit_reason

            # Flag trades that violate common Indian cash-equity constraints,
            # such as overnight shorts / CNC shorts, so that strategy authors
            # can see where broker rules would have intervened.
            if (
                kind == "delivery"
                and t.side == "short"
                and t.entry_timestamp.date() != t.exit_timestamp.date()
            ):
                note = (
                    "overnight short in cash segment using CNC; not allowed by "
                    "broker, treated as delivery for costs"
                )
                entry_reason = f"{note}; {entry_reason}" if entry_reason else note
                exit_reason = f"{note}; {exit_reason}" if exit_reason else note

            trades_net.append(
                TradeRecord(
                    symbol=t.symbol,
                    side=t.side,
                    size=t.size,
                    entry_timestamp=t.entry_timestamp,
                    entry_price=t.entry_price,
                    exit_timestamp=t.exit_timestamp,
                    exit_price=t.exit_price,
                    pnl=t.pnl - cost,
                    entry_order_type=entry_order_type,
                    exit_order_type=exit_order_type,
                    entry_brokerage=entry_cost,
                    exit_brokerage=exit_cost,
                    entry_reason=entry_reason,
                    exit_reason=exit_reason,
                )
            )

        if total_costs == 0.0:
            return equity_curve, trades, 0.0

        # Adjust equity curve by subtracting cumulative costs once a trade
        # completes, so that the final equity matches the net PnL.
        per_trade_costs.sort(key=lambda x: x[0])
        i = 0
        running_costs = 0.0
        equity_net: List[EquityPoint] = []

        for pt in equity_curve:
            ts = pt.timestamp
            while i < len(per_trade_costs) and per_trade_costs[i][0] <= ts:
                running_costs += per_trade_costs[i][1]
                i += 1
            equity_net.append(
                EquityPoint(timestamp=ts, equity=pt.equity - running_costs)
            )

        return equity_net, trades_net, total_costs

    def _compute_equity_metrics(
        self,
        equity_curve: List[EquityPoint] | None,
        *,
        timeframe: str,
    ) -> Dict[str, float]:
        """Compute risk/return metrics from an equity curve."""

        # Always return a dictionary containing the expected keys so callers
        # can rely on their presence even in edge cases with too few points.
        metrics: Dict[str, float] = {
            "total_return": 0.0,
            "max_drawdown": 0.0,
            "volatility": 0.0,
            "sharpe": 0.0,
            "sortino": 0.0,
            "annual_return": 0.0,
            "calmar": 0.0,
        }

        if not equity_curve:
            return metrics

        eq_values = [pt.equity for pt in equity_curve if pt.equity is not None]
        if len(eq_values) < 2:
            return metrics

        start_equity = eq_values[0]
        end_equity = eq_values[-1]
        if start_equity > 0:
            total_return = (end_equity / start_equity) - 1.0
            metrics["total_return"] = total_return

        # Max drawdown based on running peak.
        peak = eq_values[0]
        max_dd = 0.0
        for v in eq_values:
            if v > peak:
                peak = v
            if peak > 0:
                dd = (peak - v) / peak
                if dd > max_dd:
                    max_dd = dd
        metrics["max_drawdown"] = max_dd

        # Per-bar returns for volatility/Sharpe/Sortino.
        returns: List[float] = []
        for prev, cur in zip(eq_values[:-1], eq_values[1:], strict=True):
            if prev > 0:
                returns.append((cur / prev) - 1.0)

        if not returns:
            return metrics

        mean_r = mean(returns)
        # Population standard deviation to avoid small-sample bias swings.
        vol = pstdev(returns) if len(returns) > 1 else 0.0
        metrics["volatility"] = vol

        metrics["sharpe"] = mean_r / vol if vol > 0 else 0.0

        downside = [min(r, 0.0) for r in returns]
        if any(downside):
            downside_var = mean(d * d for d in downside)
            downside_dev = sqrt(downside_var)
            if downside_dev > 0:
                metrics["sortino"] = mean_r / downside_dev
            else:
                metrics["sortino"] = 0.0

        # Simple annualisation for Calmar: assume ~252 trading days for 1d
        # timeframe and scale proportionally for intraday bars.
        minutes = _TIMEFRAME_MINUTES.get(timeframe.lower())
        if minutes is not None and minutes > 0:
            bars_per_day = (60 * 24) / minutes
            days_per_year = 252.0
            bars_per_year = bars_per_day * days_per_year
            periods = float(len(returns))
            if periods > 0 and start_equity > 0:
                # Effective return per bar and annualised return.
                r_per_bar = (end_equity / start_equity) ** (1.0 / periods) - 1.0
                r_ann = (1.0 + r_per_bar) ** bars_per_year - 1.0
                metrics["annual_return"] = r_ann
                metrics["calmar"] = r_ann / max_dd if max_dd > 0 else 0.0

        return metrics

    def _compute_trade_metrics(
        self,
        trades: List[TradeRecord] | None,
    ) -> Dict[str, float]:
        """Compute aggregate trade-level metrics."""

        if not trades:
            return {}

        pnls = [t.pnl for t in trades if isinstance(t, TradeRecord)]
        if not pnls:
            return {}

        metrics: Dict[str, float] = {}
        metrics["trade_count"] = float(len(pnls))

        wins = [p for p in pnls if p > 0]
        losses = [p for p in pnls if p < 0]
        if wins:
            metrics["avg_win"] = sum(wins) / len(wins)
        if losses:
            metrics["avg_loss"] = sum(losses) / len(losses)
        if wins or losses:
            total = len(wins) + len(losses)
            metrics["win_rate"] = len(wins) / float(total) if total > 0 else 0.0

        return metrics

    def _aggregate_from_lower_timeframe(
        self,
        prices_db: Session,
        *,
        symbol: str,
        target_timeframe: str,
        start: datetime,
        end: datetime,
    ) -> Optional[pd.DataFrame]:
        """Aggregate bars from a finer timeframe into the requested timeframe.

        For example, if 1d bars are not available but 1h bars are present, this
        will resample 1h into 1d using standard OHLCV aggregation.
        """

        target_minutes = _TIMEFRAME_MINUTES.get(target_timeframe.lower())
        target_freq = _PANDAS_FREQ.get(target_timeframe.lower())
        if target_minutes is None or target_freq is None:
            return None

        # Find available timeframes for this symbol in the requested window.
        available = (
            prices_db.query(PriceBar.timeframe)
            .filter(
                PriceBar.symbol == symbol,
                PriceBar.timestamp >= start,
                PriceBar.timestamp <= end,
            )
            .distinct()
            .all()
        )

        candidates: List[tuple[int, str]] = []
        for (tf,) in available:
            minutes = _TIMEFRAME_MINUTES.get(tf.lower())
            if minutes is None:
                continue
            if minutes < target_minutes and target_minutes % minutes == 0:
                candidates.append((minutes, tf))

        if not candidates:
            return None

        # Choose the finest available timeframe that can be aggregated up.
        candidates.sort(key=lambda x: x[0])
        _, source_tf = candidates[0]

        source_rows = (
            prices_db.query(PriceBar)
            .filter(
                PriceBar.symbol == symbol,
                PriceBar.timeframe == source_tf,
                PriceBar.timestamp >= start,
                PriceBar.timestamp <= end,
            )
            .order_by(PriceBar.timestamp.asc())
            .all()
        )

        if not source_rows:
            return None

        df_src = pd.DataFrame(
            {
                "open": [r.open for r in source_rows],
                "high": [r.high for r in source_rows],
                "low": [r.low for r in source_rows],
                "close": [r.close for r in source_rows],
                "volume": [r.volume or 0.0 for r in source_rows],
            },
            index=[r.timestamp for r in source_rows],
        )

        df_resampled = (
            df_src.resample(target_freq)
            .agg(
                {
                    "open": "first",
                    "high": "max",
                    "low": "min",
                    "close": "last",
                    "volume": "sum",
                }
            )
            .dropna(subset=["open", "high", "low", "close"])
        )

        if df_resampled.empty:
            return None

        return df_resampled
