"""Deterministic, synthetic-only constraint work planner."""

from .planner import InfeasiblePlanError, plan_month

__all__ = ["InfeasiblePlanError", "plan_month"]
