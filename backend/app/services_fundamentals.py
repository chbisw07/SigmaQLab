from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from .models import FundamentalsSnapshot, FundamentalsSnapshotRun, Stock
from .symbol_resolution import ResolvedSymbol, resolve_symbol


@dataclass
class IngestionSummary:
    """Lightweight summary of a fundamentals ingestion run."""

    run_id: int
    as_of_date: date
    source: str
    csv_filename: str | None
    symbols_processed: int
    symbols_created: int
    symbols_updated: int
    symbols_skipped: int


class FundamentalsIngestionService:
    """Service for ingesting fundamentals from Screener.in-style CSV exports."""

    def __init__(self, *, source: str = "screener_csv") -> None:
        self._source = source

    @staticmethod
    def _parse_float(raw: str | None) -> float | None:
        if raw is None:
            return None
        txt = raw.strip()
        if not txt or txt in {"-", "NA", "N/A"}:
            return None
        try:
            return float(txt.replace(",", ""))
        except ValueError:
            return None

    def _ensure_stock(
        self,
        db: Session,
        *,
        resolved: ResolvedSymbol,
        name: str | None,
        sector: str | None,
        industry: str | None,
    ) -> Stock:
        """Get or create a Stock row for the resolved symbol."""

        stock = (
            db.query(Stock)
            .filter(
                Stock.symbol == resolved.symbol,
                Stock.exchange == (resolved.exchange or "NSE"),
            )
            .one_or_none()
        )
        if stock is None:
            stock = Stock(
                symbol=resolved.symbol,
                exchange=resolved.exchange or "NSE",
                segment=None,
                name=name,
                sector=sector,
                tags=None,
                is_active=True,
            )
            db.add(stock)
            db.flush()
        else:
            # Keep basic metadata in sync with the latest CSV.
            if name:
                stock.name = name
            if sector:
                stock.sector = sector
        return stock

    def ingest_screener_csv(
        self,
        meta_db: Session,
        *,
        csv_path: str | Path,
        as_of_date: date,
        report_type: str = "consolidated",
        dry_run: bool = False,
    ) -> IngestionSummary:
        """Ingest fundamentals from a Screener.in-style CSV file.

        - Creates or updates Stock rows for all NSE codes in the CSV.
        - Upserts FundamentalsSnapshot rows for (symbol, as_of_date).
        - Records a FundamentalsSnapshotRun for lineage.
        """

        path = Path(csv_path)
        if not path.exists():
            msg = f"CSV file not found: {path}"
            raise FileNotFoundError(msg)

        # Create a run row up-front so callers can always identify this batch.
        run = FundamentalsSnapshotRun(
            as_of_date=as_of_date,
            source=self._source,
            csv_filename=str(path),
            report_type=report_type,
            ingested_symbol_count=None,
            notes=None,
            created_at=datetime.now(timezone.utc),
        )
        meta_db.add(run)
        meta_db.flush()

        symbols_processed = 0
        symbols_created = 0
        symbols_updated = 0
        symbols_skipped = 0

        required_columns = {
            "NSE Code",
            "Name",
            "Industry Group",
            "Industry",
            "Market Capitalization",
            "Price to Earning",
            "Price to book value",
            "Return on equity",
            "Return on capital employed",
            "Debt to equity",
            "Sales",
            "Sales preceding year",
            "Profit after tax",
            "Profit after tax preceding year",
            "EPS growth 3Years",
            "OPM",
            "NPM last year",
            "Interest Coverage Ratio",
            "Promoter holding",
            "FII holding",
            "DII holding",
        }

        with path.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames is None:
                raise ValueError("CSV file has no header row.")

            header_set = set(name.strip() for name in reader.fieldnames if name)
            missing = sorted(col for col in required_columns if col not in header_set)
            if missing:
                msg = f"Screener CSV is missing required columns: {', '.join(missing)}"
                raise ValueError(msg)

            for row in reader:
                nse_code = (row.get("NSE Code") or "").strip()
                if not nse_code:
                    symbols_skipped += 1
                    continue

                resolved = resolve_symbol(meta_db, nse_code)
                if not resolved.resolved or not resolved.symbol:
                    symbols_skipped += 1
                    continue

                name = (row.get("Name") or "").strip() or None
                sector = (row.get("Industry Group") or "").strip() or None
                industry = (row.get("Industry") or "").strip() or None

                stock = self._ensure_stock(
                    meta_db,
                    resolved=resolved,
                    name=name,
                    sector=sector,
                    industry=industry,
                )

                market_cap = self._parse_float(row.get("Market Capitalization"))
                pe = self._parse_float(row.get("Price to Earning"))
                pb = self._parse_float(row.get("Price to book value"))
                roe = self._parse_float(row.get("Return on equity"))
                roce = self._parse_float(row.get("Return on capital employed"))
                debt_to_equity = self._parse_float(row.get("Debt to equity"))
                sales = self._parse_float(row.get("Sales"))
                sales_prev = self._parse_float(row.get("Sales preceding year"))
                pat = self._parse_float(row.get("Profit after tax"))
                pat_prev = self._parse_float(row.get("Profit after tax preceding year"))
                eps_growth_3y = self._parse_float(row.get("EPS growth 3Years"))
                opm = self._parse_float(row.get("OPM"))
                npm = self._parse_float(row.get("NPM last year"))
                interest_cov = self._parse_float(row.get("Interest Coverage Ratio"))
                promoter = self._parse_float(row.get("Promoter holding"))
                fii = self._parse_float(row.get("FII holding"))
                dii = self._parse_float(row.get("DII holding"))

                sales_growth_yoy = None
                if sales is not None and sales_prev and sales_prev > 0.0:
                    sales_growth_yoy = (sales - sales_prev) / sales_prev * 100.0

                profit_growth_yoy = None
                if pat is not None and pat_prev and pat_prev > 0.0:
                    profit_growth_yoy = (pat - pat_prev) / pat_prev * 100.0

                ps = None
                if market_cap is not None and sales and sales > 0.0:
                    ps = market_cap / sales

                snapshot = (
                    meta_db.query(FundamentalsSnapshot)
                    .filter(
                        FundamentalsSnapshot.symbol == stock.symbol,
                        FundamentalsSnapshot.as_of_date == as_of_date,
                    )
                    .one_or_none()
                )

                if snapshot is None:
                    snapshot = FundamentalsSnapshot(
                        symbol=stock.symbol,
                        as_of_date=as_of_date,
                    )
                    meta_db.add(snapshot)
                    symbols_created += 1
                else:
                    symbols_updated += 1

                snapshot.market_cap = market_cap
                snapshot.pe = pe
                snapshot.pb = pb
                snapshot.ps = ps
                snapshot.roe = roe
                snapshot.roce = roce
                snapshot.debt_to_equity = debt_to_equity
                snapshot.sales_growth_yoy = sales_growth_yoy
                snapshot.profit_growth_yoy = profit_growth_yoy
                snapshot.eps_growth_3y = eps_growth_3y
                snapshot.operating_margin = opm
                snapshot.net_margin = npm
                snapshot.interest_coverage = interest_cov
                snapshot.promoter_holding = promoter
                snapshot.fii_holding = fii
                snapshot.dii_holding = dii
                snapshot.sector = sector
                snapshot.industry = industry

                symbols_processed += 1

        run.ingested_symbol_count = symbols_processed

        if dry_run:
            meta_db.rollback()
        else:
            meta_db.commit()

        return IngestionSummary(
            run_id=run.id,
            as_of_date=as_of_date,
            source=self._source,
            csv_filename=str(path),
            symbols_processed=symbols_processed,
            symbols_created=symbols_created,
            symbols_updated=symbols_updated,
            symbols_skipped=symbols_skipped,
        )
