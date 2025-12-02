from __future__ import annotations

import argparse
from datetime import date
from pathlib import Path
import sys


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        msg = f"Invalid date '{value}', expected YYYY-MM-DD"
        raise argparse.ArgumentTypeError(msg) from exc


def main() -> None:
    """CLI entry point for ingesting Screener.in fundamentals CSV into the meta DB."""

    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    from app.database import SessionLocal
    from app.services_fundamentals import FundamentalsIngestionService

    default_csv = backend_root / "data" / "fundamentals" / "latest_screener.csv"

    parser = argparse.ArgumentParser(
        description=(
            "Ingest fundamentals from a Screener.in CSV export into the "
            "fundamentals_snapshot table."
        )
    )
    parser.add_argument(
        "--csv-path",
        type=str,
        default=str(default_csv),
        help=(
            "Path to Screener.in CSV file. Defaults to "
            "backend/data/fundamentals/latest_screener.csv"
        ),
    )
    parser.add_argument(
        "--as-of-date",
        type=_parse_date,
        required=True,
        help="Fundamentals as-of date in YYYY-MM-DD format.",
    )
    parser.add_argument(
        "--report-type",
        type=str,
        default="consolidated",
        help="Report type label to store on the run (consolidated/standalone/unknown).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse and validate the CSV but roll back without committing changes.",
    )

    args = parser.parse_args()

    session = SessionLocal()
    try:
        service = FundamentalsIngestionService()
        summary = service.ingest_screener_csv(
            session,
            csv_path=args.csv_path,
            as_of_date=args.as_of_date,
            report_type=args.report_type,
            dry_run=args.dry_run,
        )
        print(
            f"Ingestion run {summary.run_id} ({summary.as_of_date}): "
            f"processed={summary.symbols_processed}, "
            f"created={summary.symbols_created}, "
            f"updated={summary.symbols_updated}, "
            f"skipped={summary.symbols_skipped}",
        )
        if args.dry_run:
            print("Dry run enabled; no changes were committed.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
