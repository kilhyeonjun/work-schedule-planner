use chrono::{Datelike, NaiveDate};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

use crate::{Error, Result, input};

pub const MAX_TARGET_MINUTES: i64 = 44_640;
pub const MAX_WEEKLY_MINUTES: i64 = 10_080;
pub const MAX_DAILY_MINUTES: i64 = 1_440;
pub const MAX_MONTH_DAYS: usize = 31;

#[derive(Clone, Debug)]
pub struct Availability {
    pub available: bool,
    pub min_work_minutes: i64,
    pub max_work_minutes: i64,
}
#[derive(Clone, Debug)]
pub struct Day {
    pub date: String,
    pub day_type: String,
    pub worked_minutes: i64,
    pub recognized_minutes: i64,
    pub leave_minutes: i64,
    pub availability: Availability,
    pub weekday: u32,
    pub week_key: String,
}
#[derive(Clone, Debug)]
pub struct Policy {
    weekly_limit_minutes: i64,
    normal_minutes: i64,
    max_minutes: i64,
    allocation_mode: String,
    date_overrides: BTreeMap<String, i64>,
    weekday_caps: BTreeMap<i64, i64>,
}
#[derive(Clone, Debug)]
pub struct WorkMonth {
    data_origin: String,
    generator: Value,
    period: String,
    timezone: String,
    target_minutes: i64,
    policy: Policy,
    days: Vec<Day>,
}
impl Policy {
    pub fn weekly_limit_minutes(&self) -> i64 {
        self.weekly_limit_minutes
    }
    pub fn normal_minutes(&self) -> i64 {
        self.normal_minutes
    }
    pub fn max_minutes(&self) -> i64 {
        self.max_minutes
    }
    pub fn allocation_mode(&self) -> &str {
        &self.allocation_mode
    }
    pub fn date_overrides(&self) -> &BTreeMap<String, i64> {
        &self.date_overrides
    }
    pub fn weekday_caps(&self) -> &BTreeMap<i64, i64> {
        &self.weekday_caps
    }
}
impl WorkMonth {
    pub fn data_origin(&self) -> &str {
        &self.data_origin
    }
    pub fn generator(&self) -> &Value {
        &self.generator
    }
    pub fn period(&self) -> &str {
        &self.period
    }
    pub fn timezone(&self) -> &str {
        &self.timezone
    }
    pub fn target_minutes(&self) -> i64 {
        self.target_minutes
    }
    pub fn policy(&self) -> &Policy {
        &self.policy
    }
    pub fn days(&self) -> &[Day] {
        &self.days
    }
}
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64() != Some(0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}
pub fn text(v: &Value) -> String {
    if !truthy(v) {
        return String::new();
    }
    v.as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| v.to_string())
}
pub fn integer(v: &Value, name: &str) -> Result<i64> {
    input::minute_limit(v)?;
    v.as_i64()
        .filter(|n| *n >= 0)
        .ok_or_else(|| Error::value(format!("{name} must be a non-negative integer")))
}
fn bounded_minutes(v: &Value, name: &str, maximum: i64) -> Result<i64> {
    let minutes = integer(v, name)?;
    if minutes > maximum {
        return Err(Error::value(format!("{name} must be at most {maximum}")));
    }
    Ok(minutes)
}
pub fn date(value: &str) -> Result<NaiveDate> {
    let fail = || Error::value(format!("Invalid isoformat string: {}", input::repr(value)));
    let digits = |s: &str| -> Result<u32> {
        if !s.bytes().all(|b| b.is_ascii_digit()) {
            return Err(fail());
        }
        s.parse().map_err(|_| fail())
    };
    let year = value.get(..4).ok_or_else(fail).and_then(digits)?;
    if !(1..=9999).contains(&year) {
        return Err(fail());
    }
    if matches!(value.len(), 7..=10) && value.contains('W') {
        let tail = value.get(4..).ok_or_else(fail)?;
        let extended = tail.starts_with("-W");
        let tail = if extended {
            tail.strip_prefix("-W")
        } else {
            tail.strip_prefix('W')
        }
        .ok_or_else(fail)?;
        let week = digits(tail.get(..2).ok_or_else(fail)?)?;
        let rest = tail.get(2..).ok_or_else(fail)?;
        let rest = if extended && !rest.is_empty() {
            rest.strip_prefix('-').ok_or_else(fail)?
        } else {
            rest
        };
        let weekday = if rest.is_empty() {
            1
        } else if rest.len() == 1 {
            digits(rest)?
        } else {
            return Err(fail());
        };
        let weekday = match weekday {
            1 => chrono::Weekday::Mon,
            2 => chrono::Weekday::Tue,
            3 => chrono::Weekday::Wed,
            4 => chrono::Weekday::Thu,
            5 => chrono::Weekday::Fri,
            6 => chrono::Weekday::Sat,
            7 => chrono::Weekday::Sun,
            _ => return Err(fail()),
        };
        return NaiveDate::from_isoywd_opt(year as i32, week, weekday).ok_or_else(fail);
    }
    let (month, day) = match value.as_bytes() {
        [_, _, _, _, b'-', _, _, b'-', _, _] => (
            digits(value.get(5..7).ok_or_else(fail)?)?,
            digits(value.get(8..10).ok_or_else(fail)?)?,
        ),
        [_, _, _, _, _, _, _, _] => (
            digits(value.get(4..6).ok_or_else(fail)?)?,
            digits(value.get(6..8).ok_or_else(fail)?)?,
        ),
        _ => return Err(fail()),
    };
    NaiveDate::from_ymd_opt(year as i32, month, day).ok_or_else(fail)
}
pub fn week_key(date: NaiveDate) -> String {
    let iso = date.iso_week();
    format!("{:04}-W{:02}", iso.year(), iso.week())
}
pub fn parse_work_month(payload: &Value) -> Result<WorkMonth> {
    input::validate_limits(payload)?;
    let origin = text(input::get(payload, "dataOrigin")?.unwrap_or(&Value::Null));
    if origin != "synthetic" && origin != "operational" {
        return Err(Error::value("dataOrigin must be synthetic or operational"));
    }
    let p = input::get(payload, "policy")?.unwrap_or(&Value::Null);
    let raw_days = input::get(payload, "days")?
        .and_then(Value::as_array)
        .filter(|d| !d.is_empty());
    let (Some(_), Some(raw_days)) = (p.as_object(), raw_days) else {
        return Err(Error::value("policy and at least one day are required"));
    };
    // Preserve Python's validation order, including non-coercing minute fields.
    if raw_days.len() > MAX_MONTH_DAYS {
        return Err(Error::value(format!(
            "days must contain at most {MAX_MONTH_DAYS} entries"
        )));
    }
    let weekly_limit_minutes = bounded_minutes(
        &p["weeklyLimitMinutes"],
        "weeklyLimitMinutes",
        MAX_WEEKLY_MINUTES,
    )?;
    let normal_minutes = bounded_minutes(&p["normalMinutes"], "normalMinutes", MAX_DAILY_MINUTES)?;
    let max_minutes = bounded_minutes(&p["maxMinutes"], "maxMinutes", MAX_DAILY_MINUTES)?;
    let mut overrides = BTreeMap::new();
    for (k, v) in input::dictionary(&p["dateOverrides"])? {
        let minutes = bounded_minutes(&v, &format!("dateOverrides.{k}"), MAX_DAILY_MINUTES)?;
        overrides.insert(k, minutes);
    }
    let mut weekday_caps = BTreeMap::new();
    for (k, v) in input::dictionary(&p["weekdayCaps"])? {
        weekday_caps.insert(
            input::int_string(&k)?,
            bounded_minutes(&v, &format!("weekdayCaps.{k}"), MAX_DAILY_MINUTES)?,
        );
    }
    let policy = Policy {
        weekly_limit_minutes,
        normal_minutes,
        max_minutes,
        allocation_mode: if truthy(&p["allocationMode"]) {
            text(&p["allocationMode"])
        } else {
            "equal".into()
        },
        date_overrides: overrides,
        weekday_caps,
    };
    let mut days = Vec::with_capacity(raw_days.len());
    let mut dates = BTreeSet::new();
    for raw in raw_days {
        let a = &raw["availability"];
        if !raw.is_object() || !a.is_object() {
            return Err(Error::new(
                "TypeError",
                "each day requires an availability object",
            ));
        }
        let d = text(&raw["date"]);
        let worked_minutes =
            bounded_minutes(&raw["workedMinutes"], "workedMinutes", MAX_DAILY_MINUTES)?;
        let recognized_minutes = bounded_minutes(
            &raw["recognizedMinutes"],
            "recognizedMinutes",
            MAX_DAILY_MINUTES,
        )?;
        let leave_minutes =
            bounded_minutes(&raw["leaveMinutes"], "leaveMinutes", MAX_DAILY_MINUTES)?;
        let availability = Availability {
            available: truthy(&a["available"]),
            min_work_minutes: bounded_minutes(
                a.get("minWorkMinutes").unwrap_or(&json!(0)),
                "minWorkMinutes",
                MAX_DAILY_MINUTES,
            )?,
            max_work_minutes: bounded_minutes(
                &a["maxWorkMinutes"],
                "maxWorkMinutes",
                MAX_DAILY_MINUTES,
            )?,
        };
        let parsed = date(&d)?;
        if !dates.insert(parsed) {
            return Err(Error::value("day dates must be unique"));
        }
        days.push(Day {
            date: d,
            day_type: text(&raw["dayType"]),
            worked_minutes,
            recognized_minutes,
            leave_minutes,
            availability,
            weekday: parsed.weekday().num_days_from_monday(),
            week_key: week_key(parsed),
        });
    }
    days.sort_by(|a, b| a.date.cmp(&b.date));
    Ok(WorkMonth {
        data_origin: origin,
        generator: Value::Object(input::dictionary(&payload["generator"])?),
        period: text(&payload["period"]),
        timezone: text(&payload["timezone"]),
        target_minutes: bounded_minutes(
            &payload["targetMinutes"],
            "targetMinutes",
            MAX_TARGET_MINUTES,
        )?,
        policy,
        days,
    })
}
