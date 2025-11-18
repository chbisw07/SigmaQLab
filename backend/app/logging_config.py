import logging
import sys
from datetime import datetime, timezone
from typing import Any, Dict


class JsonLogFormatter(logging.Formatter):
    """Simple JSON log formatter with timestamp, level, and message."""

    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        payload: Dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return self._to_json(payload)

    @staticmethod
    def _to_json(payload: Dict[str, Any]) -> str:
        # Minimal JSON construction to avoid extra dependencies.
        import json

        return json.dumps(payload, separators=(",", ":"))


def configure_logging(level: str = "INFO") -> None:
    """Configure root logging with JSON formatted output."""

    root = logging.getLogger()
    root.setLevel(level.upper())

    # Clear existing handlers to avoid duplicate logs when reloading.
    for handler in list(root.handlers):
        root.removeHandler(handler)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())
    root.addHandler(handler)


