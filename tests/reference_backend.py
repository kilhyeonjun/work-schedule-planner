"""Line-oriented reference process, always launched with the Python backend."""
from __future__ import annotations

import datetime as dt
import json
import sys

from work_planner import month_insights, plan_month
from work_planner.demo_payload import archive_payload, month_payload
from work_planner.demo_routes import route
from work_planner.explain import explain_day, explain_result
from work_planner.feasibility import additional_work_bounds
from work_planner.model import parse_work_month


def dispatch(request):
    op, args = request["op"], request["args"]
    if op == "plan_month":
        return plan_month(args["payload"])
    if op == "month_insights":
        return month_insights(args["payload"], now=dt.datetime.fromisoformat(args["now"]),
                              projection_constraints=args.get("projection_constraints"))
    if op == "month_payload":
        return month_payload(**args)
    if op == "archive_payload":
        return archive_payload()
    if op in {"route", "route_text"}:
        status, headers, body = route(**args)
        if op == "route" and headers["Content-Type"].startswith("application/json"):
            body = json.loads(body)
        return [status, headers, body]
    if op == "explain_result":
        return explain_result(**args)
    if op == "explain_day":
        source = {"dataOrigin": "synthetic", "targetMinutes": 0,
                  "policy": {"weeklyLimitMinutes": 0, "normalMinutes": 0, "maxMinutes": 0},
                  "days": [args["day"]]}
        return explain_day(parse_work_month(source).days[0], args["additional"], args["daily_cap"])
    if op == "additional_work_bounds":
        return additional_work_bounds(parse_work_month(args["payload"]))
    raise ValueError(f"unknown operation: {op}")


def main():
    for line in sys.stdin:
        try:
            response = {"ok": True, "result": dispatch(json.loads(line))}
        except (ValueError, TypeError, AssertionError) as error:
            response = {"ok": False, "error": {"type": type(error).__name__, "message": str(error)}}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
