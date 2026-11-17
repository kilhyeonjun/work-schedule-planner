pub mod demo_payload;
pub mod demo_routes;
pub mod explain;
pub mod feasibility;
pub mod insights;
pub mod model;
pub mod planner;

use insights::{n, s};
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
fn arg(args: &Value, key: &str, default: i64) -> i64 {
    args.get(key).and_then(Value::as_i64).unwrap_or(default)
}
pub fn dispatch(request: &Value) -> Result<Value> {
    let a = &request["args"];
    match s(request, "op") {
        "plan_month" => plan_month(&a["payload"]),
        "month_insights" => insights::month_insights(
            &a["payload"],
            s(a, "now"),
            a.get("projection_constraints").filter(|v| !v.is_null()),
        ),
        "explain_result" => Ok(json!(explain::explain_result(
            s(a, "status"),
            n(a, "gap_minutes")
        ))),
        "explain_day" => {
            let mut p = json!({"dataOrigin":"synthetic","targetMinutes":0,"policy":{"weeklyLimitMinutes":0,"normalMinutes":0,"maxMinutes":0},"days":[a["day"].clone()]});
            p["days"][0]["availability"]["minWorkMinutes"] = a["day"]["availability"]
                .get("minWorkMinutes")
                .cloned()
                .unwrap_or(json!(0));
            let m = model::parse_work_month(&p)?;
            Ok(json!(explain::explain_day(
                &m.days[0],
                n(a, "additional"),
                n(a, "daily_cap")
            )))
        }
        "normal_first" => Ok(demo_payload::normal_first(
            a["result"].clone(),
            &a["source"],
            n(a, "normal"),
        )),
        "month_payload" => demo_payload::month_payload(
            arg(a, "year", 2042) as i32,
            arg(a, "month", 3) as u32,
            arg(a, "target", 7800),
            arg(a, "normal", 500),
            arg(a, "long", 719),
            arg(a, "short", 285),
            a.get("plans"),
        ),
        "demo_plan" => demo_payload::demo_plan(
            arg(a, "year", 2042) as i32,
            arg(a, "month", 3) as u32,
            arg(a, "target", 7800),
            arg(a, "normal", 500),
            arg(a, "long", 719),
            arg(a, "short", 285),
            a["archive"] == true,
        ),
        "archive_payload" => demo_payload::archive_payload(),
        "nine_hour_target_minutes" => Ok(json!(demo_payload::nine_hour_target_minutes(
            n(a, "year") as i32,
            n(a, "month") as u32
        )?)),
        "route" => demo_routes::route(s(a, "method"), s(a, "path"), s(a, "query_string")),
        "additional_work_bounds" => Ok(json!(feasibility::additional_work_bounds(
            &model::parse_work_month(&a["payload"])?
        ))),
        _ => Err(Error::value("unknown operation")),
    }
}
