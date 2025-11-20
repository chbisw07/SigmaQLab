from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..backtest_service import BacktestService
from ..database import get_db
from ..models import Backtest, BacktestEquityPoint, BacktestTrade
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
        backtest = service.run_single_backtest(
            meta_db=meta_db,
            prices_db=prices_db,
            strategy_id=payload.strategy_id,
            symbol=payload.symbol,
            timeframe=payload.timeframe,
            start=datetime.combine(payload.start_date, datetime.min.time()),
            end=datetime.combine(payload.end_date, datetime.max.time()),
            initial_capital=payload.initial_capital,
            params=payload.params,
            params_id=payload.params_id,
            price_source=payload.price_source,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Likely missing backtrader or misconfigured engine.
        raise HTTPException(status_code=500, detail=str(exc)) from exc

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

    # Basic indicators: fast/slow SMA on close. These can be expanded later.
    closes = [row.close for row in price_rows]
    timestamps = [row.timestamp for row in price_rows]

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

    indicators: dict[str, List[dict[str, datetime | float]]] = {}
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
