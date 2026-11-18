pub mod demo_payload;
pub mod demo_routes;
pub mod explain;
pub mod feasibility;
pub mod input;
pub mod insights;
pub mod model;
pub mod number;
pub mod planner;

use insights::s;
pub use planner::plan_month;
use serde_json::{Value, json};
#[derive(Debug)]
pub struct Error {
    pub kind: &'static str,
    pub message: String,
}
impl Error {
    pub fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
    pub fn value(message: impl Into<String>) -> Self {
        Self::new("ValueError", message)
    }
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for Error {}
pub type Result<T, E = Error> = std::result::Result<T, E>;
fn arg(args: &Value, key: &str, default: i64) -> Result<i64> {
    let Some(value) = input::get(args, key)? else {
        return Ok(default);
    };
    if let Some(value) = value.as_i64() {
        return Ok(value);
    }
    Err(Error::value(format!("{key} must be an integer")))
}
fn calendar_arg(args: &Value, key: &str, default: i64) -> Result<i64> {
    input::get(args, key)?.map_or(Ok(default), |v| number::Num::parse(v)?.integer())
}
fn year_arg(args: &Value) -> Result<i32> {
    i32::try_from(calendar_arg(args, "year", 2042)?)
        .map_err(|_| Error::new("OverflowError", "year out of range"))
}
fn month_arg(args: &Value) -> Result<u32> {
    u32::try_from(calendar_arg(args, "month", 3)?)
        .map_err(|_| Error::value("month must be in 1..12"))
}
pub fn dispatch(request: &Value) -> Result<Value> {
    input::validate_limits(request)?;
    let a = &request["args"];
    match s(request, "op") {
        "plan_month" => plan_month(&a["payload"]),
        "month_insights" => insights::month_insights_with_compat(
            &a["payload"],
            s(a, "now"),
            a.get("projection_constraints").filter(|v| !v.is_null()),
            input::IsoCompatibility {
                midnight_24: request
                    .get("compat")
                    .and_then(|c| c.get("isoMidnight24"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                short_fraction: request
                    .get("compat")
                    .and_then(|c| c.get("isoShortFraction"))
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            },
        ),
        "explain_result" => Ok(json!(explain::explain_result(
            s(a, "status"),
            arg(a, "gap_minutes", 0)?
        ))),
        "explain_day" => {
            let p = json!({"dataOrigin":"synthetic","targetMinutes":0,"policy":{"weeklyLimitMinutes":0,"normalMinutes":0,"maxMinutes":0},"days":[input::item(a, "day")?.clone()]});
            let m = model::parse_projection(&p)?;
            let day = m
                .days()
                .first()
                .ok_or_else(|| Error::value("a day is required"))?;
            Ok(json!(explain::explain_day(
                day,
                arg(a, "additional", 0)?,
                arg(a, "daily_cap", 0)?
            )))
        }
        "normal_first" => demo_payload::normal_first(
            input::item(a, "result")?.clone(),
            input::item(a, "source")?,
            arg(a, "normal", 500)?,
        ),
        "month_payload" => demo_payload::month_payload(
            year_arg(a)?,
            month_arg(a)?,
            arg(a, "target", 7800)?,
            arg(a, "normal", 500)?,
            arg(a, "long", 719)?,
            arg(a, "short", 285)?,
            a.get("plans"),
        ),
        "demo_plan" => demo_payload::demo_plan(
            year_arg(a)?,
            month_arg(a)?,
            arg(a, "target", 7800)?,
            arg(a, "normal", 500)?,
            arg(a, "long", 719)?,
            arg(a, "short", 285)?,
            a["archive"] == true,
        ),
        "archive_payload" => demo_payload::archive_payload(),
        "nine_hour_target_minutes" => Ok(json!(demo_payload::nine_hour_target_minutes(
            year_arg(a)?,
            month_arg(a)?
        )?)),
        "route" => demo_routes::route(s(a, "method"), s(a, "path"), s(a, "query_string")),
        "additional_work_bounds" => Ok(json!(feasibility::additional_work_bounds(
            &model::parse_work_month(&a["payload"])?
        ))),
        _ => Err(Error::value("unknown operation")),
    }
}
