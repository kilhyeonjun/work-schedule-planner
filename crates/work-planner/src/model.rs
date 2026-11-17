use chrono::{Datelike, NaiveDate};
use serde_json::{Value, json};
use std::collections::BTreeMap;

use crate::{Error, Result};

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
    pub weekly_limit_minutes: i64,
    pub normal_minutes: i64,
    pub max_minutes: i64,
    pub allocation_mode: String,
    pub date_overrides: BTreeMap<String, i64>,
    pub weekday_caps: BTreeMap<u32, i64>,
}
#[derive(Clone, Debug)]
pub struct WorkMonth {
    pub data_origin: String,
    pub generator: Value,
    pub period: String,
    pub timezone: String,
    pub target_minutes: i64,
    pub policy: Policy,
    pub days: Vec<Day>,
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
    v.as_i64()
        .filter(|n| *n >= 0)
        .ok_or_else(|| Error::value(format!("{name} must be a non-negative integer")))
}
pub fn date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .or_else(|_| NaiveDate::parse_from_str(value, "%Y%m%d"))
        .or_else(|_| NaiveDate::parse_from_str(value, "%G-W%V-%u"))
        .map_err(|_| Error::value(format!("Invalid isoformat string: '{value}'")))
}
pub fn week_key(date: NaiveDate) -> String {
    let iso = date.iso_week();
    format!("{:04}-W{:02}", iso.year(), iso.week())
}
pub fn parse_work_month(payload: &Value) -> Result<WorkMonth> {
    let origin = text(&payload["dataOrigin"]);
    if origin != "synthetic" && origin != "operational" {
        return Err(Error::value("dataOrigin must be synthetic or operational"));
    }
    let p = &payload["policy"];
    let raw_days = payload["days"].as_array().filter(|d| !d.is_empty());
    if !p.is_object() || raw_days.is_none() {
        return Err(Error::value("policy and at least one day are required"));
    }
    let mut overrides = BTreeMap::new();
    if let Some(o) = p["dateOverrides"].as_object() {
        for (k, v) in o {
            overrides.insert(k.clone(), integer(v, &format!("dateOverrides.{k}"))?);
        }
    }
    let mut weekday_caps = BTreeMap::new();
    if let Some(o) = p["weekdayCaps"].as_object() {
        for (k, v) in o {
            let key: i64 = k.parse().map_err(|_| {
                Error::value(format!("invalid literal for int() with base 10: '{k}'"))
            })?;
            weekday_caps.insert(key as u32, integer(v, &format!("weekdayCaps.{k}"))?);
        }
    }
    let policy = Policy {
        weekly_limit_minutes: integer(&p["weeklyLimitMinutes"], "weeklyLimitMinutes")?,
        normal_minutes: integer(&p["normalMinutes"], "normalMinutes")?,
        max_minutes: integer(&p["maxMinutes"], "maxMinutes")?,
        allocation_mode: if truthy(&p["allocationMode"]) {
            text(&p["allocationMode"])
        } else {
            "equal".into()
        },
        date_overrides: overrides,
        weekday_caps,
    };
    let mut days = Vec::new();
    for raw in raw_days.unwrap() {
        let a = &raw["availability"];
        if !raw.is_object() || !a.is_object() {
            return Err(Error::new(
                "TypeError",
                "each day requires an availability object",
            ));
        }
        let d = text(&raw["date"]);
        let parsed = date(&d)?;
        days.push(Day {
            date: d,
            day_type: text(&raw["dayType"]),
            worked_minutes: integer(&raw["workedMinutes"], "workedMinutes")?,
            recognized_minutes: integer(&raw["recognizedMinutes"], "recognizedMinutes")?,
            leave_minutes: integer(&raw["leaveMinutes"], "leaveMinutes")?,
            availability: Availability {
                available: truthy(&a["available"]),
                min_work_minutes: integer(
                    a.get("minWorkMinutes").unwrap_or(&json!(0)),
                    "minWorkMinutes",
                )?,
                max_work_minutes: integer(&a["maxWorkMinutes"], "maxWorkMinutes")?,
            },
            weekday: parsed.weekday().num_days_from_monday(),
            week_key: week_key(parsed),
        });
    }
    days.sort_by(|a, b| a.date.cmp(&b.date));
    if days.windows(2).any(|w| w[0].date == w[1].date) {
        return Err(Error::value("day dates must be unique"));
    }
    Ok(WorkMonth {
        data_origin: origin,
        generator: if truthy(&payload["generator"]) {
            payload["generator"].clone()
        } else {
            json!({})
        },
        period: text(&payload["period"]),
        timezone: text(&payload["timezone"]),
        target_minutes: integer(&payload["targetMinutes"], "targetMinutes")?,
        policy,
        days,
    })
}
