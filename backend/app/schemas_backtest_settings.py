from typing import Any

from pydantic import BaseModel, Field


class BacktestSettingsUpdate(BaseModel):
    """Partial update payload for backtest settings/config fields."""

    label: str | None = Field(
        default=None,
        description="Optional human-friendly label for this backtest run",
    )
    notes: str | None = Field(
        default=None,
        description="Optional free-form notes about this backtest configuration",
    )
    risk_config: dict[str, Any] | None = Field(
        default=None,
        description="Optional risk settings (max position size, per-trade risk, etc.)",
    )
    costs_config: dict[str, Any] | None = Field(
        default=None,
        description=(
            "Optional costs/fees settings (commission, slippage, other charges)"
        ),
    )
    visual_config: dict[str, Any] | None = Field(
        default=None,
        description="Optional visualisation settings for the backtest chart",
    )
