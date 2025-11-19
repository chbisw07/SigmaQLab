from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
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


@dataclass
class EquityPoint:
    """Single point on the equity curve."""

    timestamp: datetime
    equity: float


@dataclass
class BacktestResult:
    """Result of a backtest run."""

    strategy_code: str
    symbol: str
    timeframe: str
    equity_curve: List[EquityPoint]
    metrics: Dict[str, float]


if bt is not None:

    class SmaCrossStrategy(bt.Strategy):  # type: ignore[misc]
        """Reference Backtrader strategy: simple SMA crossover."""

        params = dict(fast=10, slow=30)

        def __init__(self) -> None:
            sma_fast = bt.ind.SMA(self.data.close, period=self.p.fast)
            sma_slow = bt.ind.SMA(self.data.close, period=self.p.slow)
            self.crossover = bt.ind.CrossOver(sma_fast, sma_slow)
            self._equity_curve: List[EquityPoint] = []

        def next(self) -> None:  # type: ignore[override]
            # Record equity on every bar.
            dt = self.data.datetime.datetime(0)
            self._equity_curve.append(
                EquityPoint(timestamp=dt, equity=self.broker.getvalue())
            )

            if not self.position:
                if self.crossover > 0:
                    self.buy()
            elif self.crossover < 0:
                self.sell()

else:  # pragma: no cover - used only when backtrader missing

    class SmaCrossStrategy:  # type: ignore[no-redef]
        """Placeholder when backtrader is not installed."""

        pass


STRATEGY_REGISTRY: Dict[str, type] = {
    # Primary production code used by real strategies.
    "SMA_X": SmaCrossStrategy,
    # Test-only aliases so that engine/service/API tests can register
    # distinct Strategy codes without colliding with user-created rows.
    "SMA_X_SERVICE": SmaCrossStrategy,
    "SMA_X_API": SmaCrossStrategy,
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

        # Apply params to strategy.
        cerebro.addstrategy(strat_cls, **config.params)

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

        # Our strategy records equity in `._equity_curve` on each bar.
        strat: SmaCrossStrategy = cerebro.runstrats[0][0]  # type: ignore[attr-defined]

        final_value = cerebro.broker.getvalue()
        equity_curve = strat._equity_curve

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
            metrics=metrics,
        )
