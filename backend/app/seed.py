from __future__ import annotations

from sqlalchemy.orm import Session

from .models import Strategy, StrategyParameter


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
