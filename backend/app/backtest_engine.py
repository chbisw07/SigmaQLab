from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from typing import Any, Dict, List

import pandas as pd

try:
    import backtrader as bt
except ImportError:  # pragma: no cover - optional dependency
    bt = None  # type: ignore[assignment]


@dataclass
class BacktestConfig:
    """Configuration for a single backtest run."""

    strategy_code: str
    symbol: str
    timeframe: str
    initial_capital: float
    params: Dict[str, Any]
    # Optional configs passed through from the API layer so the engine can
    # respect risk and broker settings (e.g. allowShortSelling,
    # productType=intraday/delivery).
    risk_config: Dict[str, Any] | None = None
    costs_config: Dict[str, Any] | None = None


@dataclass
class EquityPoint:
    """Single point on the equity curve."""

    timestamp: datetime
    equity: float


@dataclass
class TradeRecord:
    """Single closed trade."""

    symbol: str
    side: str  # 'long' or 'short'
    size: float
    entry_timestamp: datetime
    entry_price: float
    exit_timestamp: datetime
    exit_price: float
    pnl: float
    # Optional cost metadata; populated when a broker-specific cost model
    # (e.g. Zerodha equity) is applied.
    entry_order_type: str | None = None  # e.g. MIS / CNC
    exit_order_type: str | None = None
    entry_brokerage: float | None = None
    exit_brokerage: float | None = None
    # Optional human-readable reasons for this trade, used for diagnostics in
    # the UI (e.g. signal triggered, stop-loss hit, end-of-test flatten).
    entry_reason: str | None = None
    exit_reason: str | None = None


@dataclass
class BacktestResult:
    """Result of a backtest run."""

    strategy_code: str
    symbol: str
    timeframe: str
    equity_curve: List[EquityPoint]
    trades: List[TradeRecord]
    metrics: Dict[str, float]


if bt is not None:

    class SigmaBaseStrategy(bt.Strategy):  # type: ignore[misc]
        """Base Backtrader strategy that records equity and trades."""

        params = dict(
            broker_product_type="auto",  # intraday, delivery, auto
            allow_short=True,
            session_close_time="15:15",
            # Risk sizing defaults (can be overridden via risk_config).
            max_position_size_pct=100.0,
            per_trade_risk_pct=None,
            # Whether to apply stop-loss / take-profit overlays driven by
            # risk_config. Strategies that do not implement explicit SL/TP
            # exits will simply ignore these flags.
            use_stop_loss=True,
            use_take_profit=True,
        )

        def __init__(self) -> None:
            super().__init__()
            self._equity_curve: List[EquityPoint] = []
            # Use a distinct attribute name to avoid clashing with Backtrader's
            # own internal _trades structure.
            self._sigma_trades: List[TradeRecord] = []
            # Track open trades by Backtrader trade reference so that we can
            # reconstruct entry information when the trade is later closed.
            # Mapping: trade_ref -> (size, entry_timestamp, entry_price, entry_reason)
            self._open_trades: Dict[int, tuple[float, datetime, float, str | None]] = {}
            # Optional annotations set by concrete strategies immediately before
            # placing orders so we can attach human-readable reasons to trades.
            self._pending_entry_reason: str | None = None
            self._pending_exit_reason: str | None = None
            # When broker constraints force a square-off, we remember the logical
            # exit timestamp here so trades can be stamped with the intended
            # EOD close, not the next-bar fill time.
            self._forced_exit_timestamp: datetime | None = None

            # Broker/risk constraints derived from strategy params. These are
            # populated by BacktraderEngine based on BacktestConfig.
            self._product_type: str = str(self.p.broker_product_type).lower()
            self._allow_short: bool = bool(self.p.allow_short)
            close_cfg = self.p.session_close_time
            self._session_close_time: time | None
            if isinstance(close_cfg, str):
                try:
                    hour_str, minute_str = close_cfg.split(":")
                    self._session_close_time = datetime.strptime(
                        f"{hour_str}:{minute_str}", "%H:%M"
                    ).time()
                except ValueError:
                    self._session_close_time = datetime.strptime(
                        "15:15", "%H:%M"
                    ).time()
            else:
                self._session_close_time = close_cfg

        # Helper to enforce broker constraints such as intraday square-off and
        # disallowing overnight shorts in the cash segment.
        def _enforce_broker_constraints(self) -> None:
            if self.position.size == 0 or self._session_close_time is None:
                return

            dt = self.data.datetime.datetime(0)
            current_time = dt.time()

            is_short = self.position.size < 0
            is_intraday_product = self._product_type == "intraday"

            # Close positions that cannot be held overnight:
            # - Any position when product=intraday (MIS).
            # - Any short position in cash-equity, regardless of product.
            if current_time >= self._session_close_time and (
                is_intraday_product or is_short
            ):
                if is_intraday_product and is_short:
                    reason = "intraday square-off (MIS short)"
                elif is_intraday_product:
                    reason = "intraday square-off (MIS long)"
                elif is_short:
                    reason = "intraday square-off for short in cash segment"
                else:
                    reason = "intraday square-off"
                self._pending_exit_reason = reason
                self._forced_exit_timestamp = dt
                self.close()

        def _compute_order_size(self, side: str | None = None) -> int:
            """Compute order size based on risk_config and capital.

            - `max_position_size_pct` caps total notional exposure per symbol.
            - `per_trade_risk_pct` combined with `stop_loss_pct` caps
              risk per trade.
            """

            price = float(self.data.close[0])
            if price <= 0.0:
                return 1

            capital = float(self.broker.getvalue())

            # Maximum notional allowed for this position.
            max_notional = capital * float(self.p.max_position_size_pct) / 100.0

            # If we are adding in the same direction, honour existing exposure;
            # if we are flipping direction (e.g. long -> short), assume the
            # previous leg is being fully closed first so the full slot becomes
            # available for the new side.
            desired_side = side or ("long" if self.position.size >= 0 else "short")
            same_direction = (self.position.size > 0 and desired_side == "long") or (
                self.position.size < 0 and desired_side == "short"
            )
            current_notional = (
                abs(float(self.position.size)) * price if same_direction else 0.0
            )
            remaining_notional = max(0.0, max_notional - current_notional)
            if remaining_notional <= 0.0:
                return 0

            max_qty_by_notional = remaining_notional / price
            qty = max_qty_by_notional

            # Risk-based sizing using per-trade risk and stop-loss distance.
            per_risk_pct = self.p.per_trade_risk_pct
            sl_pct = getattr(self.p, "stop_loss_pct", None)
            use_sl = getattr(self.p, "use_stop_loss", True)
            if (
                per_risk_pct is not None
                and use_sl
                and sl_pct is not None
                and float(sl_pct) > 0.0
            ):
                risk_capital = capital * float(per_risk_pct) / 100.0
                per_share_risk = price * float(sl_pct) / 100.0
                if per_share_risk > 0.0:
                    qty_risk = risk_capital / per_share_risk
                    qty = min(qty, qty_risk)

            size = int(qty)
            if size < 1:
                size = 1
            return size

        def next(self) -> None:  # type: ignore[override]
            # Record equity on every bar.
            dt = self.data.datetime.datetime(0)
            self._equity_curve.append(
                EquityPoint(timestamp=dt, equity=self.broker.getvalue())
            )

        def stop(self) -> None:  # type: ignore[override]
            """Ensure any open position is closed at the end of the run.

            This makes realised PnL and the recorded trades consistent with the
            final equity value reported by the broker, which already includes
            mark-to-market gains/losses on open positions.
            """

            # Flatten any residual position so Backtrader emits a closed trade
            # via `notify_trade`. This is similar to how many backtest engines
            # implicitly close positions at the end of the test window.
            if self.position.size != 0:
                self._pending_exit_reason = "end of backtest window"
                self.close()
            # Call the base implementation last in case future versions add
            # behaviour there.
            super().stop()

        def notify_trade(self, trade: "bt.Trade") -> None:  # type: ignore[override]
            ref = getattr(trade, "ref", id(trade))

            # When a trade opens or changes size (isclosed is False), remember
            # its entry information. Backtrader keeps `trade.size` non-zero
            # while the trade is open and resets it to 0 once closed.
            if not trade.isclosed:
                size = float(trade.size or 0.0)
                if size == 0.0:
                    return
                entry_dt = trade.data.datetime.datetime(0)
                entry_price = float(trade.price)
                entry_reason = self._pending_entry_reason
                self._pending_entry_reason = None
                self._open_trades[ref] = (size, entry_dt, entry_price, entry_reason)
                return

            # For closed trades, recover the original size and entry
            # information from the cache.
            info = self._open_trades.pop(ref, None)
            if info is None:
                # If we cannot match this trade to a previous open event,
                # skip recording rather than guessing.
                return

            size, entry_dt, entry_price, entry_reason = info
            if size == 0.0:
                return

            side = "long" if size > 0 else "short"
            # Use a forced timestamp when broker constraints initiated the
            # square-off; otherwise fall back to the bar time when Backtrader
            # reports the trade as closed.
            exit_dt = (
                self._forced_exit_timestamp
                if self._forced_exit_timestamp is not None
                else trade.data.datetime.datetime(0)
            )
            self._forced_exit_timestamp = None

            exit_reason = self._pending_exit_reason
            self._pending_exit_reason = None

            record = TradeRecord(
                symbol=self.data._name or "",  # type: ignore[attr-defined]
                side=side,
                size=abs(size),
                entry_timestamp=entry_dt,
                entry_price=entry_price,
                exit_timestamp=exit_dt,
                exit_price=float(trade.price),
                pnl=float(trade.pnlcomm),
                entry_reason=entry_reason,
                exit_reason=exit_reason,
            )
            self._sigma_trades.append(record)

    class SmaCrossStrategy(SigmaBaseStrategy):
        """Reference Backtrader strategy: simple SMA crossover."""

        params = dict(fast=10, slow=30)

        def __init__(self) -> None:
            super().__init__()
            sma_fast = bt.ind.SMA(self.data.close, period=self.p.fast)
            sma_slow = bt.ind.SMA(self.data.close, period=self.p.slow)
            self.crossover = bt.ind.CrossOver(sma_fast, sma_slow)

        def next(self) -> None:  # type: ignore[override]
            super().next()

            if not self.position:
                if self.crossover > 0:
                    # New long position on bullish crossover.
                    self._pending_entry_reason = "signal: SMA fast crosses above slow"
                    size = self._compute_order_size(side="long")
                    if size > 0:
                        self.buy(size=size)
            elif self.crossover < 0:
                # Close existing long / open short on bearish crossover.
                self._pending_exit_reason = "signal: SMA fast crosses below slow"
                self._pending_entry_reason = "signal: SMA fast crosses below slow"
                if self._allow_short:
                    size = self._compute_order_size(side="short")
                    if size > 0:
                        self.sell(size=size)
                else:
                    # If shorting is disabled, only close existing long.
                    if self.position.size > 0:
                        self.close()

            # Apply broker constraints (e.g. intraday square-off) after strategy
            # logic for this bar has run.
            self._enforce_broker_constraints()

    class ZeroLagTrendMtfStrategy(SigmaBaseStrategy):
        """Zero Lag Trend Strategy (single timeframe version, MTF diagnostics later)."""

        params = dict(
            length=70,
            mult=1.2,
            stop_loss_pct=2.0,
            take_profit_pct=4.0,
            take_long_only=False,
            pyramid_limit=2,
        )

        def __init__(self) -> None:
            """Initialise zero-lag and ATR state.

            The Backtrader implementation proved tricky to keep in sync with the
            Pine logic (especially around NaN handling and min-period
            semantics), so this strategy now maintains its own ATR + zero-lag
            EMA calculations in plain Python. This keeps behaviour predictable
            and makes it easier to reason about why trades do or do not occur.
            """

            super().__init__()

            length = int(self.p.length)
            self._length = max(length, 1)
            self._alpha = 2.0 / (self._length + 1.0)
            self._lag = max((self._length - 1) // 2, 1)

            # Rolling state for ATR and zero-lag EMA.
            self._prev_close: float | None = None
            self._atr: float | None = None
            self._atr_sum: float = 0.0
            self._atr_count: int = 0

            self._closes: list[float] = []
            self._zlema: float | None = None

            # Discrete trend state (+1, 0, -1).
            self.trend = 0

        def next(self) -> None:  # type: ignore[override]
            super().next()

            close_price = float(self.data.close[0])
            high = float(self.data.high[0])
            low = float(self.data.low[0])

            # --- ATR (Wilder) update ---
            tr: float
            if self._prev_close is None:
                tr = high - low
            else:
                tr = max(
                    high - low,
                    abs(high - self._prev_close),
                    abs(low - self._prev_close),
                )
            self._prev_close = close_price

            self._atr_count += 1
            if self._atr is None:
                self._atr_sum += tr
                if self._atr_count >= self._length:
                    self._atr = self._atr_sum / float(self._length)
            else:
                self._atr = ((self._atr * float(self._length - 1)) + tr) / float(
                    self._length
                )

            # --- Zero-lag EMA update ---
            self._closes.append(close_price)
            if len(self._closes) > self._lag:
                src_lag = self._closes[-1 - self._lag]
            else:
                src_lag = close_price
            de_lagged = close_price + (close_price - src_lag)

            if self._zlema is None:
                self._zlema = de_lagged
            else:
                self._zlema = (
                    self._alpha * de_lagged + (1.0 - self._alpha) * self._zlema
                )

            if self._atr is None or self._zlema is None:
                # Not enough history yet.
                return

            z = self._zlema
            v = self._atr * float(self.p.mult)

            # Update trend based on crossings of price vs bands.
            prev_trend = self.trend
            if close_price > z + v and prev_trend != 1:
                self.trend = 1
            elif close_price < z - v and prev_trend != -1:
                self.trend = -1

            # Pine uses ta.crossover(trend, 0) / ta.crossunder(trend, 0),
            # which also fires when trend moves from 0 → +1 or 0 → -1.
            bull_reversal = prev_trend <= 0 and self.trend > 0
            bear_reversal = prev_trend >= 0 and self.trend < 0

            # Stop-loss / take-profit exits.
            use_sl = bool(getattr(self.p, "use_stop_loss", True))
            use_tp = bool(getattr(self.p, "use_take_profit", True))

            if self.position.size > 0:
                entry = float(self.position.price)
                stop = entry * (1.0 - float(self.p.stop_loss_pct) / 100.0)
                target = entry * (1.0 + float(self.p.take_profit_pct) / 100.0)
                low = float(self.data.low[0])
                high = float(self.data.high[0])
                if use_sl and low <= stop:
                    self._pending_exit_reason = "stop-loss hit (long)"
                    self.close()
                elif use_tp and high >= target:
                    self._pending_exit_reason = "take-profit hit (long)"
                    self.close()
            elif self.position.size < 0:
                entry = float(self.position.price)
                stop = entry * (1.0 + float(self.p.stop_loss_pct) / 100.0)
                target = entry * (1.0 - float(self.p.take_profit_pct) / 100.0)
                high = float(self.data.high[0])
                low = float(self.data.low[0])
                if use_sl and high >= stop:
                    self._pending_exit_reason = "stop-loss hit (short)"
                    self.close()
                elif use_tp and low <= target:
                    self._pending_exit_reason = "take-profit hit (short)"
                    self.close()

            # Entry logic on trend reversals.
            if bull_reversal:
                if self.position.size < 0:
                    self._pending_exit_reason = "trend reversal to long"
                    self.close()
                if self.position.size < int(self.p.pyramid_limit):
                    self._pending_entry_reason = "trend up entry"
                    size = self._compute_order_size(side="long")
                    if size > 0:
                        self.buy(size=size)

            if bear_reversal and not bool(self.p.take_long_only):
                if self.position.size > 0:
                    self._pending_exit_reason = "trend reversal to short"
                    self.close()
                if self._allow_short and self.position.size > -int(
                    self.p.pyramid_limit
                ):
                    self._pending_entry_reason = "trend down entry"
                    size = self._compute_order_size(side="short")
                    if size > 0:
                        self.sell(size=size)

            # Apply broker constraints (e.g. intraday square-off) after strategy
            # logic for this bar has run.
            self._enforce_broker_constraints()

else:  # pragma: no cover - used only when backtrader missing

    class SmaCrossStrategy:  # type: ignore[no-redef]
        """Placeholder when backtrader is not installed."""

        pass

    class ZeroLagTrendMtfStrategy:  # type: ignore[no-redef]
        """Placeholder when backtrader is not installed."""

        pass


STRATEGY_REGISTRY: Dict[str, type] = {
    # Canonical engine implementation key.
    "SmaCrossStrategy": SmaCrossStrategy,
    # Backwards-compatible aliases so existing business codes and tests
    # continue to work even before engine_code is populated everywhere.
    "SMA_X": SmaCrossStrategy,
    "SMA_X_SERVICE": SmaCrossStrategy,
    "SMA_X_API": SmaCrossStrategy,
    # Zero Lag Trend Strategy (MTF) engine.
    "ZeroLagTrendMtfStrategy": ZeroLagTrendMtfStrategy,
}


class BacktraderEngine:
    """Backtest engine implementation backed by Backtrader."""

    def run(
        self,
        config: BacktestConfig,
        price_data: pd.DataFrame,
    ) -> BacktestResult:
        """Run a single-symbol backtest and return an in-memory result.

        The `price_data` DataFrame must have a DatetimeIndex and OHLCV columns:
        open, high, low, close, volume.
        """

        if bt is None:
            msg = "backtrader is not installed; install it to run backtests"
            raise RuntimeError(msg)

        if config.strategy_code not in STRATEGY_REGISTRY:
            raise ValueError(f"Unknown strategy code: {config.strategy_code}")

        cerebro = bt.Cerebro()
        cerebro.broker.setcash(config.initial_capital)

        strat_cls = STRATEGY_REGISTRY[config.strategy_code]

        # Derive broker constraints from BacktestConfig so strategies can
        # enforce broker rules consistently (e.g. intraday square-off, whether
        # shorts are allowed).
        risk_cfg = config.risk_config or {}
        costs_cfg = config.costs_config or {}
        broker_product = str(
            costs_cfg.get("productType") or costs_cfg.get("product") or "auto"
        ).lower()
        allow_short = bool(risk_cfg.get("allowShortSelling", True))

        # Map high-level risk settings into engine/strategy params where
        # meaningful. For engines that support configurable SL/TP (like
        # ZeroLagTrendMtfStrategy), we let risk_config override their internal
        # defaults. We also propagate sizing-related settings and the flags
        # that decide whether SL/TP overlays are applied at all.
        strategy_params: Dict[str, Any] = dict(config.params)
        if config.strategy_code == "ZeroLagTrendMtfStrategy":
            sl_pct = risk_cfg.get("stopLossPct")
            tp_pct = risk_cfg.get("takeProfitPct")
            if isinstance(sl_pct, (int, float)):
                strategy_params["stop_loss_pct"] = float(sl_pct)
            if isinstance(tp_pct, (int, float)):
                strategy_params["take_profit_pct"] = float(tp_pct)
        use_sl = risk_cfg.get("useStopLoss")
        use_tp = risk_cfg.get("useTakeProfit")
        max_pos_pct = risk_cfg.get("maxPositionSizePct")
        per_trade_pct = risk_cfg.get("perTradeRiskPct")
        if isinstance(max_pos_pct, (int, float)):
            strategy_params["max_position_size_pct"] = float(max_pos_pct)
        if isinstance(per_trade_pct, (int, float)):
            strategy_params["per_trade_risk_pct"] = float(per_trade_pct)
        if isinstance(use_sl, bool):
            strategy_params["use_stop_loss"] = use_sl
        if isinstance(use_tp, bool):
            strategy_params["use_take_profit"] = use_tp

        broker_params = {
            "broker_product_type": broker_product,
            "allow_short": allow_short,
            # For now we assume the standard India cash session and square-off
            # intraday products at 15:15 IST.
            "session_close_time": "15:15",
        }

        # Apply params to strategy, including broker constraints.
        cerebro.addstrategy(strat_cls, **strategy_params, **broker_params)

        data_feed = bt.feeds.PandasData(
            dataname=price_data,
            open="open",
            high="high",
            low="low",
            close="close",
            volume="volume",
            datetime=None,
        )
        cerebro.adddata(data_feed, name=config.symbol)

        cerebro.run()

        # Our strategies record equity in `._equity_curve` and closed trades via
        # the SigmaBaseStrategy base class.
        strat = cerebro.runstrats[0][0]  # type: ignore[attr-defined]

        final_value = cerebro.broker.getvalue()
        equity_curve = strat._equity_curve
        trades = strat._sigma_trades

        metrics = {
            "final_value": float(final_value),
            "initial_capital": float(config.initial_capital),
            "pnl": float(final_value - config.initial_capital),
        }

        return BacktestResult(
            strategy_code=config.strategy_code,
            symbol=config.symbol,
            timeframe=config.timeframe,
            equity_curve=equity_curve,
            trades=trades,
            metrics=metrics,
        )
