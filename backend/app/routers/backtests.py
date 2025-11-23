from datetime import datetime, time
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..backtest_service import BacktestService
from ..database import get_db
from ..models import Backtest, BacktestEquityPoint, BacktestTrade, Strategy
from ..prices_database import get_prices_db
from ..prices_models import PriceBar
from ..schemas import (
    BacktestCreateRequest,
    BacktestChartDataResponse,
    BacktestChartPriceBar,
    BacktestEquityPointRead,
    BacktestRead,
    BacktestTradeRead,
)
from ..schemas_backtest_settings import BacktestSettingsUpdate

router = APIRouter(prefix="/api/backtests", tags=["Backtests"])


def _get_backtest_or_404(db: Session, backtest_id: int) -> Backtest:
    backtest = db.get(Backtest, backtest_id)
    if backtest is None:
        raise HTTPException(status_code=404, detail="Backtest not found")
    return backtest


@router.post("", response_model=BacktestRead, status_code=201)
async def create_backtest(
    payload: BacktestCreateRequest,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> BacktestRead:
    """Run a backtest synchronously and persist the Backtest record."""

    service = BacktestService()

    try:
        # If explicit intraday times are not provided, default to the standard
        # India cash market session of 09:15–15:30.
        default_start_time = time(9, 15)
        default_end_time = time(15, 30)
        start_time = payload.start_time or default_start_time
        end_time = payload.end_time or default_end_time

        backtest = service.run_single_backtest(
            meta_db=meta_db,
            prices_db=prices_db,
            strategy_id=payload.strategy_id,
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            start=datetime.combine(payload.start_date, start_time),
            end=datetime.combine(payload.end_date, end_time),
            initial_capital=payload.initial_capital,
            params=payload.params,
            params_id=payload.params_id,
            price_source=payload.price_source,
            label=payload.label,
            notes=payload.notes,
            risk_config=payload.risk_config,
            costs_config=payload.costs_config,
            visual_config=payload.visual_config,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Likely missing backtrader or misconfigured engine.
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return BacktestRead.model_validate(backtest)


@router.patch("/{backtest_id}/settings", response_model=BacktestRead)
async def update_backtest_settings(
    backtest_id: int,
    payload: BacktestSettingsUpdate,
    meta_db: Session = Depends(get_db),
) -> BacktestRead:
    """Update non-engine backtest settings such as label, notes, and configs."""

    backtest = _get_backtest_or_404(meta_db, backtest_id)

    if payload.label is not None:
        backtest.label = payload.label
    if payload.notes is not None:
        backtest.notes = payload.notes
    if payload.risk_config is not None:
        backtest.risk_config_json = payload.risk_config
    if payload.costs_config is not None:
        backtest.costs_config_json = payload.costs_config
    if payload.visual_config is not None:
        backtest.visual_config_json = payload.visual_config

    meta_db.add(backtest)
    meta_db.commit()
    meta_db.refresh(backtest)

    return BacktestRead.model_validate(backtest)


@router.get("", response_model=List[BacktestRead])
async def list_backtests(
    meta_db: Session = Depends(get_db),
) -> List[BacktestRead]:
    """List backtests ordered by creation time (latest first)."""

    rows = meta_db.query(Backtest).order_by(Backtest.created_at.desc()).all()
    return [BacktestRead.model_validate(row) for row in rows]


@router.get("/{backtest_id}", response_model=BacktestRead)
async def get_backtest(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> BacktestRead:
    backtest = _get_backtest_or_404(meta_db, backtest_id)
    return BacktestRead.model_validate(backtest)


@router.get("/{backtest_id}/equity", response_model=List[BacktestEquityPointRead])
async def get_backtest_equity(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> List[BacktestEquityPointRead]:
    _ = _get_backtest_or_404(meta_db, backtest_id)
    points = (
        meta_db.query(BacktestEquityPoint)
        .filter(BacktestEquityPoint.backtest_id == backtest_id)
        .order_by(BacktestEquityPoint.timestamp.asc())
        .all()
    )
    return [
        BacktestEquityPointRead(timestamp=p.timestamp, equity=p.equity) for p in points
    ]


@router.get("/{backtest_id}/trades", response_model=List[BacktestTradeRead])
async def get_backtest_trades(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> List[BacktestTradeRead]:
    _ = _get_backtest_or_404(meta_db, backtest_id)
    trades = (
        meta_db.query(BacktestTrade)
        .filter(BacktestTrade.backtest_id == backtest_id)
        .order_by(BacktestTrade.id.asc())
        .all()
    )
    return [BacktestTradeRead.model_validate(t) for t in trades]


@router.get("/{backtest_id}/chart-data", response_model=BacktestChartDataResponse)
async def get_backtest_chart_data(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
    prices_db: Session = Depends(get_prices_db),
) -> BacktestChartDataResponse:
    """Return aggregated chart data for a backtest.

    This includes price bars, basic indicators, equity curve, a simple
    projection curve, and enriched trades suitable for charting.
    """

    backtest = _get_backtest_or_404(meta_db, backtest_id)

    if not backtest.symbols_json:
        raise HTTPException(
            status_code=400,
            detail="Backtest has no associated symbols",
        )
    symbol = backtest.symbols_json[0]

    # Load price bars for the backtest window.
    price_rows = (
        prices_db.query(PriceBar)
        .filter(
            PriceBar.symbol == symbol,
            PriceBar.timeframe == backtest.timeframe,
            PriceBar.timestamp >= backtest.start_date,
            PriceBar.timestamp <= backtest.end_date,
        )
        .order_by(PriceBar.timestamp.asc())
        .all()
    )
    if not price_rows:
        raise HTTPException(
            status_code=404,
            detail="No price bars found for backtest window",
        )

    price_bars = [
        BacktestChartPriceBar(
            timestamp=row.timestamp,
            open=row.open,
            high=row.high,
            low=row.low,
            close=row.close,
            volume=row.volume,
        )
        for row in price_rows
    ]

    closes = [row.close for row in price_rows]
    timestamps = [row.timestamp for row in price_rows]

    indicators: dict[str, List[dict[str, datetime | float]]] = {}

    def _sma(series: List[float], period: int) -> List[float | None]:
        out: List[float | None] = []
        window_sum = 0.0
        for i, v in enumerate(series):
            window_sum += v
            if i >= period:
                window_sum -= series[i - period]
            if i >= period - 1 and period > 0:
                out.append(window_sum / float(period))
            else:
                out.append(None)
        return out

    # Default indicators: fast/slow SMA on close.
    sma_fast = _sma(closes, 5)
    sma_slow = _sma(closes, 20)
    indicators["sma_5"] = [
        {"timestamp": ts, "value": val}
        for ts, val in zip(timestamps, sma_fast, strict=False)
        if val is not None
    ]
    indicators["sma_20"] = [
        {"timestamp": ts, "value": val}
        for ts, val in zip(timestamps, sma_slow, strict=False)
        if val is not None
    ]

    # For Zero Lag Trend MTF runs, compute an approximate band for charting so
    # the frontend can render the basis and bands as overlays.
    strategy = meta_db.get(Strategy, backtest.strategy_id)
    engine_code = strategy.engine_code if strategy is not None else None
    params_effective = backtest.params_effective_json or {}

    if engine_code == "ZeroLagTrendMtfStrategy":
        length = int(params_effective.get("length", 70))
        mult = float(params_effective.get("mult", 1.2))
        if length > 1:
            lag = max((length - 1) // 2, 1)
            zlema_values: List[float] = []
            volatility_values: List[float] = []
            atr_values: List[float] = []

            prev_close: float | None = None
            for row in price_rows:
                high = float(row.high)
                low = float(row.low)
                close_price = float(row.close)
                if prev_close is None:
                    tr = high - low
                else:
                    tr = max(
                        high - low,
                        abs(high - prev_close),
                        abs(low - prev_close),
                    )
                atr_values.append(tr)
                prev_close = close_price

            atr_smoothed: List[float | None] = []
            atr_sum = 0.0
            for i, tr in enumerate(atr_values):
                atr_sum += tr
                if i >= length:
                    atr_sum -= atr_values[i - length]
                if i >= length - 1:
                    atr_smoothed.append(atr_sum / float(length))
                else:
                    atr_smoothed.append(None)

            highest_window = length * 3
            for i, close_price in enumerate(closes):
                if i >= lag:
                    src_lag = closes[i - lag]
                else:
                    src_lag = close_price
                de_lagged = close_price + (close_price - src_lag)

                if i == 0:
                    z = de_lagged
                else:
                    prev = zlema_values[-1]
                    alpha = 2.0 / (length + 1.0)
                    z = alpha * de_lagged + (1.0 - alpha) * prev
                zlema_values.append(z)

                if i >= highest_window - 1:
                    window = [
                        v
                        for v in atr_smoothed[i - highest_window + 1 : i + 1]
                        if v is not None
                    ]
                    highest = max(window) if window else 0.0
                else:
                    highest = 0.0
                volatility_values.append(highest * mult)

            indicators["zl_basis"] = [
                {"timestamp": ts, "value": z}
                for ts, z in zip(timestamps, zlema_values, strict=False)
            ]
            indicators["zl_upper"] = [
                {"timestamp": ts, "value": z + v}
                for ts, z, v in zip(
                    timestamps, zlema_values, volatility_values, strict=False
                )
            ]
            indicators["zl_lower"] = [
                {"timestamp": ts, "value": z - v}
                for ts, z, v in zip(
                    timestamps, zlema_values, volatility_values, strict=False
                )
            ]

    equity_points = (
        meta_db.query(BacktestEquityPoint)
        .filter(BacktestEquityPoint.backtest_id == backtest_id)
        .order_by(BacktestEquityPoint.timestamp.asc())
        .all()
    )
    equity_curve = [
        BacktestEquityPointRead(timestamp=p.timestamp, equity=p.equity)
        for p in equity_points
    ]

    trades = (
        meta_db.query(BacktestTrade)
        .filter(BacktestTrade.backtest_id == backtest_id)
        .order_by(BacktestTrade.id.asc())
        .all()
    )

    # Simple aggregated projection curve: for each price bar, compute the
    # hypothetical equity if all trades were held from their entry until that
    # bar, ignoring actual exits.
    projection_curve: List[BacktestEquityPointRead] = []
    initial_capital = backtest.initial_capital
    for bar in price_bars:
        close_price = bar.close
        ts = bar.timestamp
        # Aggregate unrealised PnL for all trades that have opened by this time.
        hold_pnl = 0.0
        for trade in trades:
            if trade.entry_timestamp > ts:
                continue
            direction = 1.0 if trade.side == "long" else -1.0
            hold_pnl += direction * (close_price - trade.entry_price) * trade.size
        projection_curve.append(
            BacktestEquityPointRead(timestamp=ts, equity=initial_capital + hold_pnl)
        )

    # Adapt indicators dict to IndicatorPoint lists for the response model.
    indicator_series = {
        name: [
            {"timestamp": item["timestamp"], "value": item["value"]} for item in series
        ]
        for name, series in indicators.items()
    }

    return BacktestChartDataResponse(
        backtest=BacktestRead.model_validate(backtest),
        price_bars=price_bars,
        indicators=indicator_series,
        equity_curve=equity_curve,
        projection_curve=projection_curve,
        trades=[BacktestTradeRead.model_validate(t) for t in trades],
    )


@router.get("/{backtest_id}/trades/export")
async def export_backtest_trades_csv(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> Response:
    """Export backtest trades as CSV."""

    _ = _get_backtest_or_404(meta_db, backtest_id)
    trades = (
        meta_db.query(BacktestTrade)
        .filter(BacktestTrade.backtest_id == backtest_id)
        .order_by(BacktestTrade.id.asc())
        .all()
    )

    import csv
    import io

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "symbol",
            "side",
            "size",
            "entry_timestamp",
            "entry_price",
            "exit_timestamp",
            "exit_price",
            "pnl",
            "pnl_pct",
            "holding_period_bars",
            "max_theoretical_pnl",
            "max_theoretical_pnl_pct",
            "pnl_capture_ratio",
            "entry_order_type",
            "exit_order_type",
            "entry_brokerage",
            "exit_brokerage",
            "entry_reason",
            "exit_reason",
        ]
    )
    for t in trades:
        writer.writerow(
            [
                t.id,
                t.symbol,
                t.side,
                t.size,
                t.entry_timestamp.isoformat(),
                t.entry_price,
                t.exit_timestamp.isoformat(),
                t.exit_price,
                t.pnl,
                t.pnl_pct,
                t.holding_period_bars,
                t.max_theoretical_pnl,
                t.max_theoretical_pnl_pct,
                t.pnl_capture_ratio,
                t.entry_order_type,
                t.exit_order_type,
                t.entry_brokerage,
                t.exit_brokerage,
                t.entry_reason,
                t.exit_reason,
            ]
        )

    output.seek(0)
    filename = f"backtest_{backtest_id}_trades.csv"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
    }
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers=headers,
    )


@router.delete("/{backtest_id}", status_code=204)
async def delete_backtest(
    backtest_id: int,
    meta_db: Session = Depends(get_db),
) -> Response:
    """Delete a backtest and its associated trades/equity points."""

    backtest = _get_backtest_or_404(meta_db, backtest_id)

    # Remove child rows first to avoid foreign key issues.
    meta_db.query(BacktestEquityPoint).filter(
        BacktestEquityPoint.backtest_id == backtest.id
    ).delete(synchronize_session=False)
    meta_db.query(BacktestTrade).filter(
        BacktestTrade.backtest_id == backtest.id
    ).delete(synchronize_session=False)

    meta_db.delete(backtest)
    meta_db.commit()

    return Response(status_code=204)
