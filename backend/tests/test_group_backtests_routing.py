from datetime import datetime, timedelta

import pandas as pd
import pytest

from app.backtest_engine import EquityPoint, TradeRecord
from app.backtest_service import BacktestService


pytest.importorskip(
    "backtrader",
    reason="backtrader not installed; skipping group routing tests",
)


def _simple_price_df(start: datetime, days: int, price: float = 100.0) -> pd.DataFrame:
    idx = pd.date_range(start, periods=days, freq="D")
    series = pd.Series(price, index=idx)
    return pd.DataFrame(
        {
            "open": series,
            "high": series,
            "low": series,
            "close": series,
            "volume": 1_000.0,
        },
        index=idx,
    )


def test_portfolio_simulator_respects_max_position_and_short_flag() -> None:
    """_run_portfolio_simulator honours maxPositionSizePct and allowShortSelling."""

    service = BacktestService()
    start = datetime(2024, 1, 1)
    df_a = _simple_price_df(start, days=5, price=100.0)
    df_b = _simple_price_df(start, days=5, price=100.0)

    # Two candidates on the first bar: one long, one short.
    ts_entry = df_a.index[0].to_pydatetime()
    ts_exit = ts_entry + timedelta(days=1)
    candidates = [
        TradeRecord(
            symbol="AAA",
            side="long",
            size=10_000.0,  # very large; sizing should clamp to risk limits
            entry_timestamp=ts_entry,
            entry_price=100.0,
            exit_timestamp=ts_exit,
            exit_price=110.0,
            pnl=0.0,
        ),
        TradeRecord(
            symbol="BBB",
            side="short",
            size=10_000.0,
            entry_timestamp=ts_entry,
            entry_price=100.0,
            exit_timestamp=ts_exit,
            exit_price=90.0,
            pnl=0.0,
        ),
    ]

    initial_capital = 100_000.0
    risk_config = {
        "maxPositionSizePct": 20.0,  # max 20% of equity per symbol
        "perTradeRiskPct": None,
        "allowShortSelling": False,  # short candidate must be skipped
        "stopLossPct": None,
        "useStopLoss": False,
    }

    equity_curve, trades, routing = service._run_portfolio_simulator(  # type: ignore[attr-defined]
        initial_capital=initial_capital,
        timeframe="1d",
        price_data_by_symbol={"AAA": df_a, "BBB": df_b},
        candidate_trades=candidates,
        risk_config=risk_config,
    )

    # Only the long trade should be admitted.
    assert len(trades) == 1
    trade = trades[0]
    assert trade.symbol == "AAA"
    assert trade.side == "long"

    # Max position size: 20% of 100k at price 100 => 200 shares.
    assert trade.size <= 200.0

    # Equity curve should start at initial capital.
    assert isinstance(equity_curve[0], EquityPoint)
    assert equity_curve[0].equity == pytest.approx(initial_capital)

    # Routing diagnostics should reflect 2 candidates, 1 accepted.
    assert routing["total_candidates"] == 2.0
    assert routing["total_accepted"] == 1.0
    # At least one per-bar entry with candidates/accepted counts.
    assert routing["per_bar"]


def test_costs_model_sets_mis_vs_cnc_order_types() -> None:
    """_apply_costs_indian_equity should classify MIS vs CNC correctly."""

    service = BacktestService()
    start = datetime(2024, 1, 1)

    # Simple flat equity curve – values are irrelevant for this test.
    equity_curve = [
        EquityPoint(timestamp=start, equity=100_000.0),
        EquityPoint(timestamp=start + timedelta(days=1), equity=100_000.0),
    ]

    # One intraday trade (entry/exit same day), one delivery trade (spans days).
    t_intraday = TradeRecord(
        symbol="TEST",
        side="long",
        size=10.0,
        entry_timestamp=start,
        entry_price=100.0,
        exit_timestamp=start + timedelta(hours=1),
        exit_price=101.0,
        pnl=10.0,
    )
    t_delivery = TradeRecord(
        symbol="TEST",
        side="long",
        size=10.0,
        entry_timestamp=start,
        entry_price=100.0,
        exit_timestamp=start + timedelta(days=2),
        exit_price=105.0,
        pnl=50.0,
    )

    costs_config = {"broker": "zerodha", "productType": "auto"}

    _, trades_net, total_costs = service._apply_costs_indian_equity(  # type: ignore[attr-defined]
        equity_curve=equity_curve,
        trades=[t_intraday, t_delivery],
        costs_config=costs_config,
    )

    assert total_costs > 0.0
    assert len(trades_net) == 2

    intraday = next(
        t for t in trades_net if t.exit_timestamp == t_intraday.exit_timestamp
    )
    delivery = next(
        t for t in trades_net if t.exit_timestamp == t_delivery.exit_timestamp
    )

    assert intraday.entry_order_type == "MIS"
    assert intraday.exit_order_type == "MIS"

    assert delivery.entry_order_type == "CNC"
    assert delivery.exit_order_type == "CNC"
