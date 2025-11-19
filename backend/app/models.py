from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


class Strategy(Base):
    __tablename__ = "strategies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    code = Column(String, nullable=False, unique=True, index=True)
    category = Column(String, nullable=True)
    description = Column(Text, nullable=True)
    status = Column(String, nullable=True)
    tags = Column(JSON, nullable=True)
    linked_sigma_trader_id = Column(String, nullable=True)
    linked_tradingview_template = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
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
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    strategy = relationship("Strategy", back_populates="parameters")
    backtests = relationship("Backtest", back_populates="parameters")


class Backtest(Base):
    __tablename__ = "backtests"

    id = Column(Integer, primary_key=True, index=True)
    strategy_id = Column(Integer, ForeignKey("strategies.id"), nullable=False)
    params_id = Column(Integer, ForeignKey("strategy_parameters.id"), nullable=True)
    engine = Column(String, nullable=False, default="backtrader")
    symbols_json = Column(JSON, nullable=False)
    timeframe = Column(String, nullable=False)
    start_date = Column(DateTime, nullable=False)
    end_date = Column(DateTime, nullable=False)
    initial_capital = Column(Float, nullable=False)
    starting_portfolio_json = Column(JSON, nullable=True)
    status = Column(String, nullable=False, default="pending")
    metrics_json = Column(JSON, nullable=True)
    data_source = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    finished_at = Column(DateTime, nullable=True)

    strategy = relationship("Strategy", back_populates="backtests")
    parameters = relationship("StrategyParameter", back_populates="backtests")
