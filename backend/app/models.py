from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from .database import Base


class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False, unique=True, index=True)
    # Optional engine implementation key, e.g. 'SmaCrossStrategy'. Multiple
    # business-level strategy codes can share the same engine_code.
    engine_code = Column(String, nullable=True)
    category = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=True)
    tags = Column(JSON, nullable=True)
    linked_sigma_trader_id = Column(String, nullable=True)
    linked_tradingview_template = Column(String, nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    parameters = relationship("StrategyParameter", back_populates="strategy")
    backtests = relationship("Backtest", back_populates="strategy")


class StrategyParameter(Base):
    __tablename__ = "strategy_parameters"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=False)
    label = Column(String, nullable=False)
    params_json = Column(JSON, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    strategy = relationship("Strategy", back_populates="parameters")
    backtests = relationship("Backtest", back_populates="parameters")


class Backtest(Base):
    __tablename__ = "backtests"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=False)
    params_id = Column(Integer, ForeignKey("strategy_parameters.id"), nullable=True)
    engine = Column(String, nullable=False, default="backtrader")
    # Optional link to a stock group when this is a portfolio/group backtest.
    group_id = Column(Integer, ForeignKey("stock_groups.id"), nullable=True)
    # Universe mode: 'single' for single-symbol runs, 'group' for group/portfolio.
    universe_mode = Column(String, nullable=True)
    # Optional human-friendly label and notes for this run.
    label = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    symbols_json = Column(JSON, nullable=False)
    timeframe = Column(String, nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    initial_capital = Column(Float, nullable=False)
    starting_portfolio_json = Column(JSON, nullable=True)
    # Effective parameters and configuration used for this run. These are
    # stored as JSON blobs so we can fully reconstruct the backtest context.
    params_effective_json = Column(JSON, nullable=True)
    risk_config_json = Column(JSON, nullable=True)
    costs_config_json = Column(JSON, nullable=True)
    visual_config_json = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="pending")
    metrics_json = Column(JSON, nullable=True)
    data_source = Column(String, nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    finished_at = Column(DateTime, nullable=True)

    strategy = relationship("Strategy", back_populates="backtests")
    parameters = relationship("StrategyParameter", back_populates="backtests")
    group = relationship("StockGroup", back_populates="backtests")


class BacktestEquityPoint(Base):
    __tablename__ = "backtest_equity_points"

    id = Column(Integer, primary_key=True, index=True)
    backtest_id = Column(
        Integer, ForeignKey("backtests.id"), nullable=False, index=True
    )
    timestamp = Column(DateTime, nullable=False)
    equity = Column(Float, nullable=False)

    backtest = relationship("Backtest", backref="equity_points")


class BacktestTrade(Base):
    __tablename__ = "backtest_trades"

    id = Column(Integer, primary_key=True, index=True)
    backtest_id = Column(
        Integer, ForeignKey("backtests.id"), nullable=False, index=True
    )
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)  # 'long' or 'short'
    size = Column(Float, nullable=False)
    entry_timestamp = Column(DateTime, nullable=False)
    entry_price = Column(Float, nullable=False)
    exit_timestamp = Column(DateTime, nullable=False)
    exit_price = Column(Float, nullable=False)
    pnl = Column(Float, nullable=False)
    # Optional derived metrics per trade.
    pnl_pct = Column(Float, nullable=True)
    holding_period_bars = Column(Integer, nullable=True)
    max_theoretical_pnl = Column(Float, nullable=True)
    max_theoretical_pnl_pct = Column(Float, nullable=True)
    pnl_capture_ratio = Column(Float, nullable=True)
    # Optional Indian-equity specific metadata when a Zerodha-style cost model
    # is applied.
    entry_order_type = Column(String, nullable=True)  # e.g. MIS / CNC
    exit_order_type = Column(String, nullable=True)
    entry_brokerage = Column(Float, nullable=True)
    exit_brokerage = Column(Float, nullable=True)
    entry_reason = Column(String, nullable=True)
    exit_reason = Column(String, nullable=True)

    backtest = relationship("Backtest", backref="trades")


class Stock(Base):
    """Universe of instruments that SigmaQLab can work with."""

    __tablename__ = "stocks"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, nullable=False, index=True)
    exchange = Column(String, nullable=False, index=True)
    segment = Column(String, nullable=True)
    # Optional market capitalisation expressed in INR crores.
    market_cap_crore = Column(Float, nullable=True)
    name = Column(String, nullable=True)
    sector = Column(String, nullable=True)
    tags = Column(JSON, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    group_memberships = relationship("StockGroupMember", back_populates="stock")


class StockGroup(Base):
    """Named basket of stocks drawn from the universe."""

    __tablename__ = "stock_groups"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    tags = Column(JSON, nullable=True)
    composition_mode = Column(String, nullable=False, default="weights")
    total_investable_amount = Column(Numeric(20, 4), nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    members = relationship("StockGroupMember", back_populates="group")
    backtests = relationship("Backtest", back_populates="group")


class StockGroupMember(Base):
    """Membership link between StockGroup and Stock."""

    __tablename__ = "stock_group_members"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("stock_groups.id"), nullable=False)
    stock_id = Column(Integer, ForeignKey("stocks.id"), nullable=False)
    target_weight_pct = Column(Numeric(10, 4), nullable=True)
    target_qty = Column(Numeric(20, 4), nullable=True)
    target_amount = Column(Numeric(20, 4), nullable=True)

    group = relationship("StockGroup", back_populates="members")
    stock = relationship("Stock", back_populates="group_memberships")


class Portfolio(Base):
    """High-level portfolio definition built on top of the stock universe."""

    __tablename__ = "portfolios"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    base_currency = Column(String, nullable=False, default="INR")
    # Universe scoping, e.g. 'group:1' or 'universe:custom'.
    universe_scope = Column(String, nullable=True)
    # Optional list of allowed strategy IDs or codes.
    allowed_strategies_json = Column(JSON, nullable=True)
    # Snapshot of risk profile configuration for this portfolio.
    risk_profile_json = Column(JSON, nullable=True)
    # Snapshot of rebalancing policy (frequency, triggers, etc.).
    rebalance_policy_json = Column(JSON, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class PortfolioBacktest(Base):
    """Portfolio-level backtest driven by a Portfolio definition."""

    __tablename__ = "portfolio_backtests"

    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolios.id"), nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    timeframe = Column(String, nullable=False)
    initial_capital = Column(Float, nullable=False)
    # Snapshot of the portfolio configuration and risk profile used.
    config_snapshot_json = Column(JSON, nullable=True)
    risk_profile_snapshot_json = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="pending")
    metrics_json = Column(JSON, nullable=True)
    created_at = Column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    finished_at = Column(DateTime, nullable=True)

    portfolio = relationship("Portfolio", backref="backtests")
