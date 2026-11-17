use crate::{
    Error, Result,
    feasibility::additional_work_bounds,
    model::{date, parse_work_month, truthy, week_key},
};
use chrono::{Datelike, Duration, FixedOffset, NaiveDate, NaiveDateTime, Timelike};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub(crate) fn n(v: &Value, key: &str) -> i64 {
    v[key].as_i64().unwrap_or(0)
}
pub(crate) fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub(crate) fn rows(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn default_n(v: &Value, key: &str, default: i64) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(default)
}
fn recognized(v: &Value) -> i64 {
    v.get("recognized_minutes")
        .and_then(Value::as_i64)
        .unwrap_or(n(v, "work_minutes") + n(v, "timeoff_minutes"))
}
fn ceil(minutes: i64, days: usize) -> i64 {
    if days == 0 {
        0
    } else {
        (minutes + days as i64 - 1) / days as i64
    }
}
fn duration(minutes: i64) -> String {
    format!("{}:{:02}", minutes.div_euclid(60), minutes.rem_euclid(60))
}
fn month_day(value: &str) -> Result<String> {
    let d = date(value)?;
    Ok(format!("{}/{}", d.month(), d.day()))
}
fn clock(value: &str) -> i64 {
    let mut parts = value.split(':');
    parts
        .next()
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0)
        * 60
        + parts
            .next()
            .and_then(|s| s.get(..2))
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0)
}
fn breaks(day: &Value) -> i64 {
    let rest = n(day, "rest_minutes");
    let (start, end) = (s(day, "first_start"), s(day, "last_end"));
    if start.is_empty() || end.is_empty() {
        return rest;
    }
    let (start, end) = (clock(start), clock(end));
    rest.max(end - start + if end < start { 1440 } else { 0 } - n(day, "work_minutes"))
}
// Formatting rounds the exact binary value to decimal, as Python round(x, 1) does.
fn round1(value: f64) -> f64 {
    format!("{value:.1}").parse().unwrap()
}
fn target_progress(payload: &Value, today: &str) -> Value {
    let ledger: BTreeMap<&str, &Value> = rows(&payload["days"])
        .iter()
        .map(|d| (s(d, "date"), d))
        .collect();
    let workdays: Vec<&str> = ledger
        .iter()
        .filter(|(_, d)| s(d, "day_type") == "workday")
        .map(|(&d, _)| d)
        .collect();
    let completed: Vec<&str> = workdays.iter().copied().filter(|&d| d < today).collect();
    let remaining: Vec<&str> = workdays.iter().copied().filter(|&d| d >= today).collect();
    let official: i64 = ledger
        .iter()
        .filter(|(d, _)| **d < today)
        .map(|(_, d)| recognized(d))
        .sum();
    let effective = official + ledger.get(today).map(|d| recognized(d)).unwrap_or(0);
    let planner = &payload["planner"];
    let options = planner.get("targetOptions");
    let option_minutes: BTreeMap<&str, i64> = rows(options.unwrap_or(&Value::Null))
        .iter()
        .map(|o| (s(o, "key"), n(o, "minutes")))
        .collect();
    let burn = if completed.is_empty() {
        None
    } else {
        Some((official as f64 / completed.len() as f64).round_ties_even() as i64)
    };
    let projected = official + burn.unwrap_or(0) * remaining.len() as i64;
    let long = default_n(&planner["settings"], "longDayMinutes", 719);
    let derived = &payload["derived"];
    let mut targets = Vec::new();
    for (key, label, minutes) in [
        (
            "base",
            "8시간(소정)",
            if options.is_some() {
                *option_minutes.get("target").unwrap_or(&0)
            } else {
                n(derived, "targetMinutes")
            },
        ),
        (
            "nine_hour",
            "9시간",
            *option_minutes
                .get("nine_hour")
                .unwrap_or(&(workdays.len() as i64 * 540)),
        ),
        (
            "fixed_ot",
            "고정OT",
            if options.is_some() {
                *option_minutes.get("fixed_ot").unwrap_or(&0)
            } else {
                n(derived, "fixedOtMinutes")
            },
        ),
        (
            "max",
            "최대",
            if options.is_some() {
                *option_minutes.get("max").unwrap_or(&0)
            } else {
                n(derived, "maxMinutes")
            },
        ),
    ] {
        if minutes <= 0 {
            continue;
        }
        let required = ceil((minutes - official).max(0), remaining.len());
        let eta = if official >= minutes {
            Some(*completed.last().unwrap_or(&today))
        } else if let Some(b) = burn {
            remaining
                .iter()
                .enumerate()
                .find(|(i, _)| official + b * (*i as i64 + 1) >= minutes)
                .map(|(_, d)| *d)
        } else {
            None
        };
        targets.push(json!({"key":key,"label":label,"minutes":minutes,"achievedPercent":round1(effective as f64/minutes as f64*100.0),"officialPercent":round1(official as f64/minutes as f64*100.0),"requiredDailyMinutes":required,"requiredFeasible":required<=long,"etaDate":eta,"projectedMinutes":projected,"projectedPercent":round1(projected as f64/minutes as f64*100.0),"shortfallMinutes":(minutes-projected).max(0)}));
    }
    json!({"pace":{"totalWorkdays":workdays.len(),"completedWorkdays":completed.len(),"remainingWorkdays":remaining.len(),"expectedPercent":if workdays.is_empty(){0.0}else{round1(completed.len() as f64/workdays.len() as f64*100.0)}},"burnRateMinutes":burn,"targets":targets})
}
fn constrained_projection(
    payload: &Value,
    now: NaiveDateTime,
    leave_now: bool,
    constraints: Option<&Value>,
) -> Result<Option<(i64, i64)>> {
    let today = now.date().to_string();
    if let Some(c) = constraints {
        if truthy(&c["fixedConflict"]) {
            return Ok(None);
        }
        let mut source = c.clone();
        if leave_now {
            for d in source["days"].as_array_mut().unwrap() {
                if s(d, "date") == today {
                    d["availability"]["available"] = json!(false);
                    d["availability"]["maxWorkMinutes"] = d["workedMinutes"].clone();
                }
            }
            if let Some(overrides) = source["policy"]["dateOverrides"].as_object_mut() {
                overrides.remove(&today);
            }
        }
        let bounds = if rows(&source["days"]).is_empty() {
            Some((0, 0))
        } else {
            additional_work_bounds(&parse_work_month(&source)?)
        };
        let baseline = n(c, "recognizedBaselineMinutes");
        return Ok(bounds.map(|(lower, upper)| {
            (
                baseline + lower,
                if !leave_now {
                    c["capacityMaximumMinutes"]
                        .as_i64()
                        .unwrap_or(baseline + upper)
                } else {
                    baseline + upper
                },
            )
        }));
    }
    let settings = &payload["planner"]["settings"];
    let long = n(settings, "longDayMinutes");
    let normal = default_n(settings, "normalDayMinutes", 500.min(long));
    let short = n(settings, "shortDayMinutes");
    let mut days = Vec::new();
    let mut overrides = serde_json::Map::new();
    let mut baseline = 0;
    for day in rows(&payload["days"]) {
        let d = s(day, "date");
        let parsed = date(d)?;
        let worked = n(day, "work_minutes");
        let leave = n(day, "timeoff_minutes");
        let recognized = recognized(day);
        baseline += recognized;
        let mut active =
            d >= today.as_str() && s(day, "day_type") == "workday" && !(leave_now && d == today);
        if d > today.as_str() && (worked > 0 || leave >= short) {
            active = false;
        }
        let friday = parsed.weekday().num_days_from_monday() == 4;
        let mut cap = worked.max((if friday { normal } else { long }) - leave);
        let raw = &settings["dateOverrides"][d];
        let fixed = if raw.is_object() {
            &raw["minutes"]
        } else {
            raw
        };
        if !fixed.is_null() && active {
            let fixed = fixed
                .as_i64()
                .or_else(|| fixed.as_str().and_then(|s| s.parse().ok()))
                .unwrap_or(0);
            cap = worked.max(cap.min((fixed - leave).max(0)));
            overrides.insert(d.to_owned(), json!(cap));
        }
        if d == today && active {
            let mut end = if long == 719 {
                1180
            } else if long >= 500 {
                400 + long + 60
            } else {
                960
            };
            if friday {
                end = if normal >= 500 {
                    400 + normal + 60
                } else {
                    960
                };
            }
            let left = (end
                - i64::from(now.hour()) * 60
                - i64::from(now.minute())
                - i64::from(now.second() != 0 || now.nanosecond() != 0))
            .max(0);
            let mut possible = 0;
            for (floor, ceiling) in [(0, 239), (30, 479), (60, cap)] {
                let extra = (cap - worked)
                    .max(0)
                    .min((ceiling - worked).max(0))
                    .min((left - (floor - n(day, "rest_minutes")).max(0)).max(0));
                let required = if worked + extra >= 480 {
                    60
                } else if worked + extra >= 240 {
                    30
                } else {
                    0
                };
                if extra + (required - n(day, "rest_minutes")).max(0) <= left {
                    possible = possible.max(extra);
                }
            }
            cap = worked + possible;
            if overrides.contains_key(d) {
                overrides.insert(d.to_owned(), json!(cap));
            }
        }
        let core = &settings["dateCoreTimes"][d];
        let mut minimum_total = short;
        if truthy(core) {
            let duration = clock(s(core, "end")) - clock(s(core, "start"));
            if duration >= 240 {
                minimum_total = duration;
            }
        }
        let minimum = (minimum_total - leave).max(0);
        if (d == today && leave >= 480.min(normal)) || (worked == 0 && cap < minimum) {
            active = false;
            overrides.remove(d);
        }
        days.push(json!({"date":d,"dayType":day["day_type"],"workedMinutes":worked,"recognizedMinutes":recognized,"leaveMinutes":leave,"availability":{"available":active,"minWorkMinutes":if active{minimum}else{0},"maxWorkMinutes":if active{cap}else{worked}}}));
    }
    if days.is_empty() {
        return Ok(Some((baseline, baseline)));
    }
    let source = json!({"dataOrigin":payload.get("dataOrigin").unwrap_or(&json!("operational")),"period":&today[..7],"timezone":"Asia/Seoul","targetMinutes":baseline+31*719,"policy":{"weeklyLimitMinutes":3120,"normalMinutes":normal,"maxMinutes":long,"dateOverrides":overrides},"days":days});
    Ok(additional_work_bounds(&parse_work_month(&source)?)
        .map(|(l, u)| (baseline + l, baseline + u)))
}
pub fn parse_now(raw: &str) -> Result<NaiveDateTime> {
    if let Ok(aware) = chrono::DateTime::parse_from_rfc3339(raw) {
        return Ok(aware
            .with_timezone(&FixedOffset::east_opt(9 * 3600).unwrap())
            .naive_local());
    }
    NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M:%S%.f")
        .or_else(|_| NaiveDateTime::parse_from_str(raw, "%Y-%m-%dT%H:%M"))
        .map_err(|_| Error::value("invalid datetime"))
}
pub fn month_insights(
    payload: &Value,
    raw_now: &str,
    constraints: Option<&Value>,
) -> Result<Value> {
    let plan = &payload["planner"]["plan"];
    if plan.is_null() {
        return Ok(Value::Null);
    }
    let now = parse_now(raw_now)?;
    let today = now.date().to_string();
    let ledger: BTreeMap<&str, &Value> = rows(&payload["days"])
        .iter()
        .map(|d| (s(d, "date"), d))
        .collect();
    let planned: BTreeMap<&str, &Value> = rows(&plan["days"])
        .iter()
        .map(|d| (s(d, "date"), d))
        .collect();
    let future: Vec<&str> = ledger
        .iter()
        .filter(|(d, v)| **d > today.as_str() && s(v, "day_type") == "workday")
        .map(|(&d, _)| d)
        .collect();
    let year = default_n(payload, "year", i64::from(now.year())) as i32;
    let month = default_n(payload, "month", i64::from(now.month())) as u32;
    let start =
        NaiveDate::from_ymd_opt(year, month, 1).ok_or_else(|| Error::value("invalid month"))?;
    let end = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .unwrap()
        - Duration::days(1);
    let limits: BTreeMap<&str, i64> = rows(&plan["summary"]["weekly"])
        .iter()
        .map(|w| (s(w, "key"), n(w, "weeklyMaxMinutes")))
        .collect();
    let mut totals: BTreeMap<String, i64> = BTreeMap::new();
    for (table, field) in [
        (&ledger, "work_minutes"),
        (&planned, "plannedAdditionalMinutes"),
    ] {
        for (&d, row) in table {
            let parsed = date(d)?;
            if parsed.year() == year && parsed.month() == month {
                *totals.entry(week_key(parsed)).or_default() += n(row, field);
            }
        }
    }
    let mut guards: Vec<(String, Value)> = Vec::new();
    for (key, minutes) in totals {
        let limit = *limits.get(key.as_str()).unwrap_or(&3120);
        if minutes < limit - 240 {
            continue;
        }
        let (y, w) = key.split_once("-W").unwrap();
        let monday = NaiveDate::from_isoywd_opt(
            y.parse().unwrap(),
            w.parse().unwrap(),
            chrono::Weekday::Mon,
        )
        .unwrap();
        let a = monday.max(start);
        let b = (monday + Duration::days(6)).min(end);
        let span = format!(
            "{}–{}",
            month_day(&a.to_string())?,
            month_day(&b.to_string())?
        );
        let label = if minutes > limit {
            format!("{span} 주 52시간 {} 초과 예상", duration(minutes - limit))
        } else {
            format!("{span} 주 52시간까지 {} 남음", duration(limit - minutes))
        };
        guards.push((a.to_string(),json!({"key":"weekly_max","level":if minutes>limit{"breach"}else{"risk"},"weekKey":key,"label":label,"minutes":minutes,"limitMinutes":limit})));
    }
    for (&d, day) in &planned {
        if d <= today.as_str()
            || date(d)?.weekday().num_days_from_monday() != 4
            || n(day, "plannedAdditionalMinutes") <= 0
        {
            continue;
        }
        let window = s(day, "window").trim_end();
        let end = window.rsplit(['–', ' ', '-']).next().unwrap_or("");
        if end.contains(':') && end.len() >= 4 {
            let minutes = clock(end);
            if minutes > 960 {
                guards.push((d.to_owned(),json!({"key":"friday_cap","level":"breach","date":d,"label":format!("{}(금) {:02}:{:02} 퇴근 계획 · 16:00 상한 초과",month_day(d)?,minutes/60,minutes%60),"minutes":minutes,"limitMinutes":960})));
            }
        }
    }
    for (&d, day) in &ledger {
        if d > today.as_str() || (d == today && !truthy(&day["is_ongoing"])) {
            continue;
        }
        let worked = n(day, "work_minutes");
        let required = if worked >= 480 {
            60
        } else if worked >= 240 {
            30
        } else {
            0
        };
        let rest = breaks(day);
        if rest < required {
            guards.push((d.to_owned(),json!({"key":"rest_break","level":if d==today{"risk"}else{"breach"},"date":d,"label":format!("{} 휴게 {} · 필요 {}",month_day(d)?,duration(rest),duration(required)),"minutes":rest,"limitMinutes":required})));
        }
    }
    guards.sort_by(|(ad, a), (bd, b)| {
        (s(a, "level") != "breach", ad).cmp(&(s(b, "level") != "breach", bd))
    });
    let action = &plan["todayAction"];
    let remaining = n(action, "remainingTodayMinutes");
    let mut leave = Value::Null;
    if ledger
        .get(today.as_str())
        .is_some_and(|d| s(d, "day_type") == "workday")
        && remaining > 0
    {
        let count = future.len();
        let before: i64 = future
            .iter()
            .map(|d| {
                planned
                    .get(d)
                    .map(|v| n(v, "plannedAdditionalMinutes"))
                    .unwrap_or(0)
            })
            .sum();
        let bounds = constrained_projection(payload, now, true, constraints)?;
        let required = constraints
            .filter(|c| truthy(c))
            .map(|c| n(c, "forecastMinutes"))
            .unwrap_or_else(|| {
                ledger.values().map(|d| recognized(d)).sum::<i64>() + before + remaining
            });
        let shortfall = (required - bounds.map(|b| b.1).unwrap_or(0)).max(0);
        leave = json!({"date":today,"workedMinutes":action.get("workedMinutes").unwrap_or(&ledger[today.as_str()]["work_minutes"]),"todayRemainingMinutes":remaining,"remainingWorkdays":count,"averageDailyBeforeMinutes":ceil(before,count),"averageDailyAfterMinutes":ceil(before+remaining,count),"additionalPerDayMinutes":ceil(remaining,count),"feasible":shortfall==0,"shortfallMinutes":shortfall});
    }
    let current: i64 = ledger
        .iter()
        .filter(|(d, _)| **d <= today.as_str())
        .map(|(_, d)| recognized(d))
        .sum();
    let bounds = constrained_projection(payload, now, false, constraints)?;
    let mut expected = current
        + ledger
            .iter()
            .filter(|(d, _)| **d > today.as_str())
            .map(|(_, d)| recognized(d))
            .sum::<i64>()
        + planned
            .iter()
            .filter(|(d, _)| **d >= today.as_str())
            .map(|(_, d)| n(d, "plannedAdditionalMinutes"))
            .sum::<i64>();
    if let Some(c) = constraints {
        expected = n(c, "forecastMinutes");
    }
    let mut forecast = json!({"recognizedMinutes":current,"expectedMinutes":expected,"minMinutes":bounds.map(|b|b.0),"maxMinutes":bounds.map(|b|b.1)});
    if bounds.is_none() {
        forecast["fixedConflict"] = json!(true);
    }
    if let Some(c) = constraints {
        forecast["basis"] = c.get("basis").cloned().unwrap_or(json!("target_eligible"));
    }
    let mut result = target_progress(payload, &today);
    result["asOf"] = json!(now.format("%Y-%m-%dT%H:%M").to_string());
    result["guards"] = json!(guards.into_iter().map(|(_, g)| g).collect::<Vec<_>>());
    result["leaveNow"] = leave;
    result["forecast"] = forecast;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decimal_rounding_matches_python_binary_float_ties() {
        assert_eq!(round1(2.25), 2.2);
        assert_eq!(round1(2.35), 2.4);
        assert_eq!(round1(0.15), 0.1);
    }
    #[test]
    fn offset_dates_are_converted_to_kst() {
        assert_eq!(
            parse_now("2042-03-03T15:00:00+00:00").unwrap().to_string(),
            "2042-03-04 00:00:00"
        );
    }
}
