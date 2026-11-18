"""Generous cross-backend safety limits, independent of the stricter JSON schema."""
from __future__ import annotations

import math

MAX_MINUTES = 10_000_000
MAX_DAYS = 366


def validate_limits(value, *, minute_value=False):
    """Reject out-of-domain magnitudes before either backend performs arithmetic.

    Metadata (including generator seeds) is not a minute quantity. Numeric strings
    retain the receiving operation's normal coercion rules; int() coercion sites
    validate their converted value separately.
    """
    if (
        minute_value and isinstance(value, (int, float)) and not isinstance(value, bool)
        and (abs(value) > MAX_MINUTES or (isinstance(value, float) and not math.isfinite(value)))
    ):
        raise ValueError(f"minute quantities must be finite and within +/-{MAX_MINUTES}")
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "days" and isinstance(child, list) and len(child) > MAX_DAYS:
                raise ValueError(f"days must contain at most {MAX_DAYS} entries")
            bounded = minute_value or "minute" in str(key).lower() or key in {
                "dateOverrides", "weekdayCaps", "target", "normal", "long", "short",
                "additional", "daily_cap", "gap_minutes",
            }
            validate_limits(child, minute_value=bounded)
    elif isinstance(value, (list, tuple)):
        for child in value:
            validate_limits(child, minute_value=minute_value)
