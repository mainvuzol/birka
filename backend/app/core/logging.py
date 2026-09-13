"""Structured logging.

JSON in deployed environments so logs are queryable; human-readable locally.
Every line carries the correlation id of the request that produced it.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

import structlog

from app.core.config import Settings
from app.core.correlation import get_correlation_id


def _add_correlation_id(
    _logger: Any, _method: str, event_dict: structlog.types.EventDict
) -> structlog.types.EventDict:
    correlation_id = get_correlation_id()
    if correlation_id:
        event_dict["request_id"] = correlation_id
    return event_dict


def configure_logging(settings: Settings) -> None:
    """Configure structlog and the stdlib root logger once, at startup."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    # uvicorn installs its own handlers; let records flow to the root logger
    for noisy in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(noisy).handlers.clear()
        logging.getLogger(noisy).propagate = True

    processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        # Deliberately the plain processors, not the structlog.stdlib ones:
        # this configuration writes directly (PrintLoggerFactory) rather than
        # through a stdlib logger, and add_logger_name needs a stdlib record.
        structlog.processors.add_log_level,
        _add_correlation_id,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    processors.append(
        structlog.processors.JSONRenderer()
        if settings.log_json
        else structlog.dev.ConsoleRenderer(colors=False)
    )

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> Any:
    """Logger bound to the calling module's name."""
    return structlog.get_logger().bind(logger=name)


__all__ = ["configure_logging", "get_logger"]
