"""Deterministic, synthetic-only constraint work planner."""

from work_planner_rust import install as _install_backend

from .insights import month_insights
from .planner import InfeasiblePlanError, plan_month

__all__ = ["InfeasiblePlanError", "month_insights", "plan_month"]

# The opt-in transport owns process/environment access, not the pure Python core.
_install_backend()
del _install_backend
