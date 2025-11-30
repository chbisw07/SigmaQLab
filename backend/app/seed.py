from __future__ import annotations

from decimal import Decimal

from sqlalchemy.orm import Session

from .models import (
    Stock,
    StockGroup,
    StockGroupMember,
    Strategy,
    StrategyParameter,
)


def seed_preset_strategies(session: Session) -> None:
    """Seed a small set of preset strategies and parameter sets.

    This is idempotent: running it multiple times will not create duplicates
    for the same `code` / `label` combinations.
    """

    presets = [
        {
            "code": "SMA_X",
            "name": "SMA Crossover v1",
            "category": "trend",
            "description": "Simple SMA crossover (fast vs slow) using Backtrader.",
            "status": "candidate",
            "tags": ["sma", "crossover"],
            "engine_code": "SmaCrossStrategy",
            "params": [
                {
                    "label": "default",
                    "params": {"fast": 10, "slow": 30},
                    "notes": "Classic 10/30 daily crossover.",
                },
                {
                    "label": "aggressive",
                    "params": {"fast": 5, "slow": 20},
                    "notes": "Faster entries, more trades.",
                },
            ],
        },
        {
            "code": "SMA_X_SERVICE",
            "name": "SMA Crossover Test",
            "category": "trend",
            "description": "Internal/test SMA crossover used in engine/service tests.",
            "status": "experimental",
            "tags": ["test"],
            "engine_code": "SmaCrossStrategy",
            "params": [
                {
                    "label": "default",
                    "params": {"fast": 5, "slow": 20},
                    "notes": "Test params used in service tests.",
                },
            ],
        },
        {
            "code": "SMA_X_API",
            "name": "SMA API Test",
            "category": "trend",
            "description": "API-focused SMA crossover example for backtests API.",
            "status": "experimental",
            "tags": None,
            "engine_code": "SmaCrossStrategy",
            "params": [
                {
                    "label": "api_default",
                    "params": {"fast": 5, "slow": 20},
                    "notes": "Default params used in API tests.",
                },
            ],
        },
        {
            "code": "ZLAG_MTF",
            "name": "Zero Lag Trend MTF (default)",
            "category": "trend",
            "description": (
                "Zero Lag Trend Strategy (MTF-style) backed by "
                "ZeroLagTrendMtfStrategy."
            ),
            "status": "experimental",
            "tags": ["zerolag", "trend"],
            "engine_code": "ZeroLagTrendMtfStrategy",
            "params": [
                {
                    "label": "default",
                    "params": {
                        "length": 70,
                        "mult": 1.2,
                        "stop_loss_pct": 2.0,
                        "take_profit_pct": 4.0,
                        "take_long_only": False,
                        "pyramid_limit": 2,
                    },
                    "notes": "Defaults derived from zero_lag_trend_strategy_mtf.pine.",
                }
            ],
        },
    ]

    for preset in presets:
        strategy = (
            session.query(Strategy)
            .filter(Strategy.code == preset["code"])
            .one_or_none()
        )
        if strategy is None:
            strategy = Strategy(
                name=preset["name"],
                code=preset["code"],
                category=preset["category"],
                description=preset["description"],
                status=preset["status"],
                tags=preset["tags"],
                linked_sigma_trader_id=None,
                linked_tradingview_template=None,
                engine_code=preset["engine_code"],
            )
            session.add(strategy)
            session.commit()
            session.refresh(strategy)
        else:
            # Ensure engine_code is populated for existing rows with this code.
            if strategy.engine_code is None:
                strategy.engine_code = preset["engine_code"]
                session.add(strategy)
                session.commit()

        for param_def in preset["params"]:
            existing_param = (
                session.query(StrategyParameter)
                .filter(
                    StrategyParameter.strategy_id == strategy.id,
                    StrategyParameter.label == param_def["label"],
                )
                .first()
            )
        if existing_param is None:
            param = StrategyParameter(
                strategy_id=strategy.id,
                label=param_def["label"],
                params_json=param_def["params"],
                notes=param_def.get("notes"),
            )
            session.add(param)
            session.commit()


def _get_or_create_stock(session: Session, symbol: str, exchange: str = "NSE") -> Stock:
    """Helper to ensure a Stock row exists for seeding groups."""

    symbol_norm = symbol.strip().upper()
    exchange_norm = exchange.strip().upper()
    stock = (
        session.query(Stock)
        .filter(Stock.symbol == symbol_norm, Stock.exchange == exchange_norm)
        .one_or_none()
    )
    if stock is None:
        stock = Stock(
            symbol=symbol_norm,
            exchange=exchange_norm,
            segment=None,
            name=None,
            sector=None,
            tags=None,
            is_active=True,
        )
        session.add(stock)
        session.commit()
        session.refresh(stock)
    return stock


def seed_example_stock_groups(session: Session) -> None:
    """Seed a few example stock groups/baskets in each composition mode.

    These are intended for manual experiments and automated tests. They are
    kept deliberately small and use synthetic symbols so they do not clash
    with a user's real universe.
    """

    group_defs = [
        {
            "code": "GRP_WEIGHTS",
            "name": "Example Weights Basket",
            "description": "Seeded basket with explicit target weights.",
            "composition_mode": "weights",
            "total_investable_amount": None,
            "members": [
                ("GRPWT1", Decimal("40.0")),
                ("GRPWT2", Decimal("30.0")),
                ("GRPWT3", Decimal("30.0")),
            ],
        },
        {
            "code": "GRP_QTY",
            "name": "Example Qty Basket",
            "description": "Seeded basket with quantity-based targets.",
            "composition_mode": "qty",
            "total_investable_amount": None,
            "members": [
                ("GRPQT1", Decimal("10")),
                ("GRPQT2", Decimal("20")),
                ("GRPQT3", Decimal("30")),
            ],
        },
        {
            "code": "GRP_AMOUNT",
            "name": "Example Amount Basket",
            "description": "Seeded basket with amount-based targets.",
            "composition_mode": "amount",
            "total_investable_amount": Decimal("100000"),
            "members": [
                ("GRPAM1", Decimal("40000")),
                ("GRPAM2", Decimal("30000")),
                ("GRPAM3", Decimal("30000")),
            ],
        },
    ]

    for cfg in group_defs:
        group = (
            session.query(StockGroup)
            .filter(StockGroup.code == cfg["code"])
            .one_or_none()
        )
        if group is None:
            group = StockGroup(
                code=cfg["code"],
                name=cfg["name"],
                description=cfg["description"],
                tags=None,
                composition_mode=cfg["composition_mode"],
                total_investable_amount=cfg["total_investable_amount"],
            )
            session.add(group)
            session.commit()
            session.refresh(group)
        else:
            # Ensure composition metadata is populated for existing rows.
            updated = False
            if not getattr(group, "composition_mode", None):
                group.composition_mode = cfg["composition_mode"]
                updated = True
            if (
                cfg["composition_mode"] == "amount"
                and group.total_investable_amount is None
            ):
                group.total_investable_amount = cfg["total_investable_amount"]
                updated = True
            if updated:
                session.add(group)
                session.commit()

        # Ensure member rows with appropriate targets exist.
        for symbol, target in cfg["members"]:
            stock = _get_or_create_stock(session, symbol)
            member = (
                session.query(StockGroupMember)
                .filter(
                    StockGroupMember.group_id == group.id,
                    StockGroupMember.stock_id == stock.id,
                )
                .one_or_none()
            )
            if member is None:
                member = StockGroupMember(group_id=group.id, stock_id=stock.id)

            if cfg["composition_mode"] == "weights":
                member.target_weight_pct = target
                member.target_qty = None
                member.target_amount = None
            elif cfg["composition_mode"] == "qty":
                member.target_weight_pct = None
                member.target_qty = target
                member.target_amount = None
            elif cfg["composition_mode"] == "amount":
                member.target_weight_pct = None
                member.target_qty = None
                member.target_amount = target

            session.add(member)

        session.commit()
