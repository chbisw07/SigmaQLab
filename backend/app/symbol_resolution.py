from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Dict

from sqlalchemy.orm import Session

from .models import Stock


@dataclass
class ResolvedSymbol:
    symbol: str
    exchange: str | None
    resolved: bool
    reason: str | None = None


@lru_cache(maxsize=1)
def _load_override_map() -> Dict[str, str]:
    """Load global symbol→exchange overrides from JSON, if present.

    This allows us to pin edge-case symbols to a specific exchange when the
    automatic lookup is ambiguous or incomplete.
    """

    overrides_path = (
        Path(__file__).resolve().parent.parent
        / "config"
        / "symbol_exchange_overrides.json"
    )
    if not overrides_path.exists():
        return {}

    try:
        import json

        with overrides_path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
    except Exception:
        return {}

    normalized: Dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not isinstance(value, str):
            continue
        normalized[key.strip().upper()] = value.strip().upper()
    return normalized


def _normalise_symbol(raw_symbol: str) -> str:
    """Normalise raw symbol strings from CSVs or user input.

    - Trim whitespace.
    - Upper-case.
    - Strip common TradingView-style suffixes like '.NS' / '.NSE' / '.BSE'.
    """

    symbol = raw_symbol.strip().upper()
    for suffix in (".NS", ".NSE", ".BSE"):
        if symbol.endswith(suffix):
            symbol = symbol[: -len(suffix)]
            break
    return symbol


def resolve_symbol(db: Session, raw_symbol: str) -> ResolvedSymbol:
    """Resolve a raw symbol into a canonical (symbol, exchange) pair.

    Resolution order:
    1. Normalise symbol.
    2. Check override map for a pinned exchange.
    3. Look for an existing Stock row; prefer NSE if multiple.
    4. If still unknown, return unresolved with a reason.
    """

    if not raw_symbol or not raw_symbol.strip():
        return ResolvedSymbol(
            symbol="", exchange=None, resolved=False, reason="Empty symbol"
        )

    symbol = _normalise_symbol(raw_symbol)
    overrides = _load_override_map()
    if symbol in overrides:
        return ResolvedSymbol(symbol=symbol, exchange=overrides[symbol], resolved=True)

    rows = db.query(Stock).filter(Stock.symbol == symbol).all()
    if rows:
        # Prefer NSE when multiple exchanges exist; otherwise use the first row.
        nse_row = next((row for row in rows if row.exchange.upper() == "NSE"), None)
        chosen = nse_row or rows[0]
        return ResolvedSymbol(
            symbol=chosen.symbol, exchange=chosen.exchange, resolved=True
        )

    # Default to NSE for previously unseen symbols so that CSV imports can
    # bootstrap the universe without requiring a pre-populated instruments
    # database. The calling code may still choose to log or surface the fact
    # that the symbol was not found in existing metadata.
    return ResolvedSymbol(
        symbol=symbol,
        exchange="NSE",
        resolved=True,
        reason="Symbol not found in universe; defaulting exchange to NSE",
    )
