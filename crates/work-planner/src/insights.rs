use crate::{
    Error, Result,
    feasibility::additional_work_bounds,
    input::{self, array, get, item, string},
    model::{date, parse_work_month, truthy, week_key},
    number::Num,
};
use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};
use serde_json::{Value, json};
use std::collections::BTreeMap;

// Accessors for internally generated demo values; public input uses fallible helpers.
pub(crate) fn n(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}
pub(crate) fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub(crate) fn rows(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn number(v: &Value, key: &str, default: i64) -> Result<Num> {
    get(v, key)?.map_or(Ok(Num::Int(default)), Num::parse)
}
fn required_number(v: &Value, key: &str) -> Result<Num> {
    Num::parse(item(v, key)?)
}
fn required_string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    string(item(v, key)?)
}
fn recognized(v: &Value) -> Result<Num> {
    let fallback = number(v, "work_minutes", 0)? + number(v, "timeoff_minutes", 0)?;
    get(v, "recognized_minutes")?.map_or(Ok(fallback), Num::parse)
}
fn ceil(minutes: Num, days: usize) -> Num {
    if days == 0 {
        Num::Int(0)
    } else {
        (minutes + days as i64 - 1).floor_div(days as i64)
    }
}
fn duration(minutes: Num) -> Result<String> {
    let minutes = minutes.format_integer()?;
    Ok(format!(
        "{}:{:02}",
        minutes.div_euclid(60),
        minutes.rem_euclid(60)
    ))
}
fn month_day(value: &str) -> Result<String> {
    let d = date(value)?;
    Ok(format!("{}/{}", d.month(), d.day()))
}
fn clock_slice(raw: &str, start: usize, end: usize) -> Result<i64> {
    let start = raw.char_indices().nth(start).map_or(raw.len(), |(i, _)| i);
    let end = raw.char_indices().nth(end).map_or(raw.len(), |(i, _)| i);
    input::int_string(raw.get(start..end).unwrap_or(""))
}
fn sum_numbers(mut values: impl Iterator<Item = Result<Num>>) -> Result<Num> {
    values.try_fold(Num::Int(0), |total, value| Ok(total + value?))
}
fn breaks(day: &Value) -> Result<Num> {
    let rest = number(day, "rest_minutes", 0)?;
    let start = get(day, "first_start")?.unwrap_or(&Value::Null);
    let end = get(day, "last_end")?.unwrap_or(&Value::Null);
    if !truthy(start) || !truthy(end) {
        return Ok(rest);
    }
    let start = string(start)?;
    let end = string(end)?;
    let start = clock_slice(start, 0, 2)? * 60 + clock_slice(start, 3, 5)?;
    let end = clock_slice(end, 0, 2)? * 60 + clock_slice(end, 3, 5)?;
    Ok(rest.max(
        Num::Int(end - start + if end < start { 1440 } else { 0 })
            - required_number(day, "work_minutes")?,
    ))
}
fn round1(value: f64) -> Result<f64> {
    format!("{value:.1}")
        .parse()
        .map_err(|_| Error::value("cannot round non-finite float"))
}
fn ledger(values: &Value) -> Result<BTreeMap<&str, &Value>> {
    array(values)?
        .iter()
        .map(|day| Ok((required_string(day, "date")?, day)))
        .collect()
}
fn target_progress(payload: &Value, today: &str) -> Result<Value> {
    let ledger = ledger(item(payload, "days")?)?;
    let mut workdays = Vec::new();
    for (&d, day) in &ledger {
        if item(day, "day_type")? == "workday" {
            workdays.push(d);
        }
    }
    let completed: Vec<_> = workdays.iter().copied().filter(|&d| d < today).collect();
    let remaining: Vec<_> = workdays.iter().copied().filter(|&d| d >= today).collect();
    let official = sum_numbers(
        ledger
            .iter()
            .filter(|(d, _)| **d < today)
            .map(|(_, d)| recognized(d)),
    )?;
    let effective = official
        + ledger
            .get(today)
            .map_or(Ok(Num::Int(0)), |d| recognized(d))?;
    let derived = item(payload, "derived")?;
    let empty = json!({});
    let planner = get(payload, "planner")?
        .filter(|v| truthy(v))
        .unwrap_or(&empty);
    let options = get(planner, "targetOptions")?.filter(|v| !v.is_null());
    let mut option_minutes = BTreeMap::new();
    if let Some(options) = options.filter(|v| truthy(v)) {
        for o in array(options)? {
            option_minutes.insert(required_string(o, "key")?, required_number(o, "minutes")?);
        }
    }
    let burn = if completed.is_empty() {
        None
    } else {
        Some((official.f() / completed.len() as f64).round_ties_even() as i64)
    };
    let projected = official + burn.unwrap_or(0) * remaining.len() as i64;
    let settings = get(planner, "settings")?.unwrap_or(&empty);
    let long = number(settings, "longDayMinutes", 719)?;
    let mut targets = Vec::new();
    for (key, label, minutes) in [
        (
            "base",
            "8시간(소정)",
            if options.is_some() {
                *option_minutes.get("target").unwrap_or(&Num::Int(0))
            } else {
                number(derived, "targetMinutes", 0)?
            },
        ),
        (
            "nine_hour",
            "9시간",
            *option_minutes
                .get("nine_hour")
                .unwrap_or(&Num::Int(workdays.len() as i64 * 540)),
        ),
        (
            "fixed_ot",
            "고정OT",
            if options.is_some() {
                *option_minutes.get("fixed_ot").unwrap_or(&Num::Int(0))
            } else {
                number(derived, "fixedOtMinutes", 0)?
            },
        ),
        (
            "max",
            "최대",
            if options.is_some() {
                *option_minutes.get("max").unwrap_or(&Num::Int(0))
            } else {
                number(derived, "maxMinutes", 0)?
            },
        ),
    ] {
        if minutes <= 0 {
            continue;
        }
        let required = ceil(Num::Int(0).max(minutes - official), remaining.len());
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
        targets.push(json!({"key":key,"label":label,"minutes":minutes,"achievedPercent":round1(effective.f()/minutes.f()*100.0)?,"officialPercent":round1(official.f()/minutes.f()*100.0)?,"requiredDailyMinutes":required,"requiredFeasible":required<=long,"etaDate":eta,"projectedMinutes":projected,"projectedPercent":round1(projected.f()/minutes.f()*100.0)?,"shortfallMinutes":Num::Int(0).max(minutes-projected)}));
    }
    Ok(
        json!({"pace":{"totalWorkdays":workdays.len(),"completedWorkdays":completed.len(),"remainingWorkdays":remaining.len(),"expectedPercent":if workdays.is_empty(){0.0}else{round1(completed.len() as f64/workdays.len() as f64*100.0)?}},"burnRateMinutes":burn,"targets":targets}),
    )
}
fn constrained_projection(
    payload: &Value,
    now: NaiveDateTime,
    leave_now: bool,
    constraints: Option<&Value>,
    compatibility: input::IsoCompatibility,
) -> Result<Option<(Num, Num)>> {
    let today = now.date().to_string();
    let empty = json!({});
    if let Some(c) = constraints {
        if get(c, "fixedConflict")?.is_some_and(truthy) {
            return Ok(None);
        }
        // Python always comprehends constraints["days"], even without leave_now.
        let mut days = Vec::new();
        for day in array(item(c, "days")?)? {
            if leave_now && item(day, "date")? == today.as_str() {
                let mut changed = input::object(day)?.clone();
                let mut availability = input::object(item(day, "availability")?)?.clone();
                availability.insert("available".into(), json!(false));
                availability.insert("maxWorkMinutes".into(), item(day, "workedMinutes")?.clone());
                changed.insert("availability".into(), Value::Object(availability));
                days.push(Value::Object(changed));
            } else {
                days.push(day.clone());
            }
        }
        let mut source = input::object(c)?.clone();
        source.insert("days".into(), json!(days));
        if leave_now {
            let mut policy = input::object(item(c, "policy")?)?.clone();
            let overrides = input::object(item(item(c, "policy")?, "dateOverrides")?)?;
            let overrides = overrides
                .iter()
                .filter(|(d, _)| d.as_str() != today)
                .map(|(d, v)| (d.clone(), v.clone()))
                .collect();
            policy.insert("dateOverrides".into(), Value::Object(overrides));
            source.insert("policy".into(), Value::Object(policy));
        }
        let bounds = if days.is_empty() {
            Some((0, 0))
        } else {
            additional_work_bounds(&parse_work_month(&Value::Object(source))?)
        };
        let Some((lower, upper)) = bounds else {
            return Ok(None);
        };
        let baseline = required_number(c, "recognizedBaselineMinutes")?;
        let maximum = baseline + upper;
        let maximum = if !leave_now {
            get(c, "capacityMaximumMinutes")?
                .filter(|v| !v.is_null())
                .map_or(Ok(maximum), Num::parse)?
        } else {
            maximum
        };
        return Ok(Some((baseline + lower, maximum)));
    }
    let settings = item(item(payload, "planner")?, "settings")?;
    let raw_normal = get(settings, "normalDayMinutes")?;
    let long = required_number(settings, "longDayMinutes")?;
    let normal = match raw_normal {
        Some(v) => Num::parse(v)?,
        None => Num::Int(500).min(long),
    };
    let short = required_number(settings, "shortDayMinutes")?;
    let mut days = Vec::new();
    let mut overrides = serde_json::Map::new();
    let mut baseline = Num::Int(0);
    for day in array(item(payload, "days")?)? {
        let d = required_string(day, "date")?;
        let parsed = date(d)?;
        let worked = number(day, "work_minutes", 0)?;
        let leave = number(day, "timeoff_minutes", 0)?;
        let recognition = recognized(day)?;
        baseline = baseline + recognition;
        let mut active = d >= today.as_str()
            && item(day, "day_type")? == "workday"
            && !(leave_now && d == today);
        if d > today.as_str() && (worked > 0 || leave >= short) {
            active = false;
        }
        let friday = parsed.weekday().num_days_from_monday() == 4;
        let mut cap = worked.max((if friday { normal } else { long }) - leave);
        let raw =
            get(get(settings, "dateOverrides")?.unwrap_or(&empty), d)?.unwrap_or(&Value::Null);
        let fixed = if raw.is_object() {
            get(raw, "minutes")?.unwrap_or(&Value::Null)
        } else {
            raw
        };
        if !fixed.is_null() && active {
            let fixed = input::py_int(fixed)?;
            input::minute_limit(&json!(fixed))?;
            cap = worked.max(cap.min(Num::Int(0).max(Num::Int(fixed) - leave)));
            overrides.insert(d.to_owned(), json!(cap));
        }
        if d == today && active {
            let mut end = if long == 719 {
                Num::Int(1180)
            } else if long >= 500 {
                long + 460
            } else {
                Num::Int(960)
            };
            if friday {
                end = if normal >= 500 {
                    normal + 460
                } else {
                    Num::Int(960)
                };
            }
            let left = Num::Int(0).max(
                end - i64::from(now.hour()) * 60
                    - i64::from(now.minute())
                    - i64::from(now.second() != 0 || now.nanosecond() != 0),
            );
            let mut possible = Num::Int(0);
            for (floor, ceiling) in [
                (Num::Int(0), Num::Int(239)),
                (Num::Int(30), Num::Int(479)),
                (Num::Int(60), cap),
            ] {
                let rest = number(day, "rest_minutes", 0)?;
                let extra = Num::Int(0)
                    .max(cap - worked)
                    .min(Num::Int(0).max(ceiling - worked))
                    .min(Num::Int(0).max(left - Num::Int(0).max(floor - rest)));
                let required = if worked + extra >= 480 {
                    60
                } else if worked + extra >= 240 {
                    30
                } else {
                    0
                };
                if extra + Num::Int(0).max(Num::Int(required) - rest) <= left {
                    possible = possible.max(extra);
                }
            }
            cap = worked + possible;
            if overrides.contains_key(d) {
                overrides.insert(d.to_owned(), json!(cap));
            }
        }
        let core =
            get(get(settings, "dateCoreTimes")?.unwrap_or(&empty), d)?.unwrap_or(&Value::Null);
        let mut minimum_total = short;
        if truthy(core) {
            let start = input::iso_time_with_compat(item(core, "start")?, compatibility)?;
            let end = input::iso_time_with_compat(item(core, "end")?, compatibility)?;
            let duration = i64::from(end.hour) * 60 + i64::from(end.minute)
                - i64::from(start.hour) * 60
                - i64::from(start.minute);
            if duration >= 240 {
                minimum_total = Num::Int(duration);
            }
        }
        let minimum = Num::Int(0).max(minimum_total - leave);
        if (d == today && leave >= Num::Int(480).min(normal)) || (worked == 0 && cap < minimum) {
            active = false;
            overrides.remove(d);
        }
        days.push(json!({"date":d,"dayType":item(day,"day_type")?,"workedMinutes":worked,"recognizedMinutes":recognition,"leaveMinutes":leave,"availability":{"available":active,"minWorkMinutes":if active{minimum}else{Num::Int(0)},"maxWorkMinutes":if active{cap}else{worked}}}));
    }
    if days.is_empty() {
        return Ok(Some((baseline, baseline)));
    }
    let source = json!({"dataOrigin":get(payload,"dataOrigin")?.unwrap_or(&json!("operational")),"period":now.format("%Y-%m").to_string(),"timezone":"Asia/Seoul","targetMinutes":baseline+31*719,"policy":{"weeklyLimitMinutes":3120,"normalMinutes":normal,"maxMinutes":long,"dateOverrides":overrides},"days":days});
    Ok(additional_work_bounds(&parse_work_month(&source)?)
        .map(|(l, u)| (baseline + l, baseline + u)))
}
pub fn parse_now(raw: &str) -> Result<NaiveDateTime> {
    let split = [10, 8, 7].into_iter().find_map(|len| {
        raw.get(..len)
            .filter(|part| date(part).is_ok())
            .map(|part| (len, part))
    });
    let (len, part) = split.ok_or_else(|| Error::value("invalid datetime"))?;
    let day = date(part)?;
    let time = if raw.len() == len {
        input::IsoTime {
            hour: 0,
            minute: 0,
            second: 0,
            microsecond: 0,
            offset_microseconds: None,
        }
    } else {
        let rest = raw
            .get(len..)
            .ok_or_else(|| Error::value("invalid datetime"))?;
        let separator = rest
            .chars()
            .next()
            .ok_or_else(|| Error::value("invalid datetime"))?;
        input::iso_time(&json!(
            rest.get(separator.len_utf8()..)
                .ok_or_else(|| Error::value("invalid datetime"))?
        ))?
    };
    let mut result = day
        .and_hms_micro_opt(time.hour, time.minute, time.second, time.microsecond)
        .ok_or_else(|| Error::value("invalid datetime"))?;
    if let Some(offset) = time.offset_microseconds {
        result = result
            .checked_add_signed(Duration::microseconds(9 * 3600 * 1_000_000 - offset))
            .ok_or_else(|| Error::new("OverflowError", "date value out of range"))?;
    }
    if !(1..=9999).contains(&result.year()) {
        return Err(Error::new("OverflowError", "date value out of range"));
    }
    Ok(result)
}
fn friday_end(raw: &str) -> Result<Option<i64>> {
    let parse = || -> Option<i64> {
        // Python re's Unicode whitespace also includes the four information
        // separators, unlike Rust char::is_whitespace.
        let mut chars = raw
            .trim_end_matches(|c: char| c.is_whitespace() || ('\u{1c}'..='\u{1f}').contains(&c))
            .chars()
            .rev();
        let ones = input::decimal(chars.next()?)?;
        let tens = input::decimal(chars.next()?)?;
        if chars.next()? != ':' {
            return None;
        }
        let mut hour = input::decimal(chars.next()?)?;
        if let Some(tens) = chars.next().and_then(input::decimal) {
            hour += tens * 10;
        }
        Some(i64::from(hour) * 60 + i64::from(tens * 10 + ones))
    };
    Ok(parse())
}
pub fn month_insights(
    payload: &Value,
    raw_now: &str,
    constraints: Option<&Value>,
) -> Result<Value> {
    month_insights_with_compat(
        payload,
        raw_now,
        constraints,
        input::IsoCompatibility::default(),
    )
}
/// Match the calling Python runtime's ISO syntax while retaining a 3.11 default.
pub fn month_insights_with_compat(
    payload: &Value,
    raw_now: &str,
    constraints: Option<&Value>,
    compatibility: input::IsoCompatibility,
) -> Result<Value> {
    input::validate_limits(payload)?;
    if let Some(c) = constraints {
        input::validate_limits(c)?;
    }
    let empty = json!({});
    let planner = get(payload, "planner")?
        .filter(|v| truthy(v))
        .unwrap_or(&empty);
    let plan = get(planner, "plan")?.unwrap_or(&Value::Null);
    if plan.is_null() {
        return Ok(Value::Null);
    }
    let now = parse_now(raw_now)?;
    let today = now.date().to_string();
    let ledger = ledger(item(payload, "days")?)?;
    let planned = self::ledger(item(plan, "days")?)?;
    let mut future = Vec::new();
    for (&d, day) in &ledger {
        if d > today.as_str() && item(day, "day_type")? == "workday" {
            future.push(d);
        }
    }
    let year = number(payload, "year", i64::from(now.year()))?.integer()?;
    let month = number(payload, "month", i64::from(now.month()))?.integer()?;
    let year = i32::try_from(year)
        .map_err(|_| Error::new("OverflowError", "Python int too large to convert to C long"))?;
    let month = u32::try_from(month).map_err(|_| Error::value("month must be in 1..12"))?;
    if !(1..=9999).contains(&year) {
        return Err(Error::value("year out of range"));
    }
    let start = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| Error::value("month must be in 1..12"))?;
    let next = if month == 12 {
        NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .ok_or_else(|| Error::value("invalid month"))?;
    let end = next - Duration::days(1);
    let mut limits = BTreeMap::new();
    for w in array(item(item(plan, "summary")?, "weekly")?)? {
        limits.insert(
            required_string(w, "key")?,
            required_number(w, "weeklyMaxMinutes")?,
        );
    }
    let mut totals: BTreeMap<String, Num> = BTreeMap::new();
    let mut mondays = BTreeMap::new();
    for (table, field) in [
        (&ledger, "work_minutes"),
        (&planned, "plannedAdditionalMinutes"),
    ] {
        for (&d, row) in table {
            let parsed = date(d)?;
            if parsed.year() == year && parsed.month() == month {
                let key = week_key(parsed);
                let monday =
                    parsed - Duration::days(i64::from(parsed.weekday().num_days_from_monday()));
                mondays.insert(key.clone(), monday);
                let total = totals.entry(key).or_insert(Num::Int(0));
                *total = *total + number(row, field, 0)?;
            }
        }
    }
    let mut guards: Vec<(String, Value)> = Vec::new();
    for (key, minutes) in totals {
        let limit = *limits.get(key.as_str()).unwrap_or(&Num::Int(3120));
        if minutes < limit - 240 {
            continue;
        }
        let monday = *mondays
            .get(&key)
            .ok_or_else(|| Error::value("invalid ISO week"))?;
        let a = monday.max(start);
        let b = (monday + Duration::days(6)).min(end);
        let span = format!(
            "{}–{}",
            month_day(&a.to_string())?,
            month_day(&b.to_string())?
        );
        let label = if minutes > limit {
            format!("{span} 주 52시간 {} 초과 예상", duration(minutes - limit)?)
        } else {
            format!("{span} 주 52시간까지 {} 남음", duration(limit - minutes)?)
        };
        guards.push((a.to_string(),json!({"key":"weekly_max","level":if minutes>limit{"breach"}else{"risk"},"weekKey":key,"label":label,"minutes":minutes,"limitMinutes":limit})));
    }
    for (&d, day) in &planned {
        if d <= today.as_str()
            || date(d)?.weekday().num_days_from_monday() != 4
            || required_number(day, "plannedAdditionalMinutes")? <= 0
        {
            continue;
        }
        if let Some(minutes) = friday_end(required_string(day, "window")?)?
            && minutes > 960
        {
            guards.push((d.to_owned(),json!({"key":"friday_cap","level":"breach","date":d,"label":format!("{}(금) {:02}:{:02} 퇴근 계획 · 16:00 상한 초과",month_day(d)?,minutes/60,minutes%60),"minutes":minutes,"limitMinutes":960})));
        }
    }
    for (&d, day) in &ledger {
        if d > today.as_str() || (d == today && !get(day, "is_ongoing")?.is_some_and(truthy)) {
            continue;
        }
        let worked = required_number(day, "work_minutes")?;
        let required = if worked >= 480 {
            60
        } else if worked >= 240 {
            30
        } else {
            0
        };
        let rest = breaks(day)?;
        if rest < required {
            guards.push((d.to_owned(),json!({"key":"rest_break","level":if d==today{"risk"}else{"breach"},"date":d,"label":format!("{} 휴게 {} · 필요 {}",month_day(d)?,duration(rest)?,duration(Num::Int(required))?),"minutes":rest,"limitMinutes":required})));
        }
    }
    guards.sort_by(|(ad, a), (bd, b)| {
        (s(a, "level") != "breach", ad).cmp(&(s(b, "level") != "breach", bd))
    });
    let action = get(plan, "todayAction")?
        .filter(|v| truthy(v))
        .unwrap_or(&empty);
    let remaining = number(action, "remainingTodayMinutes", 0)?;
    let mut leave = Value::Null;
    if let Some(day) = ledger.get(today.as_str())
        && get(day, "day_type")? == Some(&json!("workday"))
        && remaining > 0
    {
        let count = future.len();
        let mut before = Num::Int(0);
        for d in &future {
            if let Some(day) = planned.get(d) {
                before = before + number(day, "plannedAdditionalMinutes", 0)?;
            }
        }
        let bounds = constrained_projection(payload, now, true, constraints, compatibility)?;
        let required = if let Some(c) = constraints.filter(|c| truthy(c)) {
            required_number(c, "forecastMinutes")?
        } else {
            sum_numbers(ledger.values().map(|d| recognized(d)))? + before + remaining
        };
        let shortfall = Num::Int(0).max(required - bounds.map_or(Num::Int(0), |b| b.1));
        // dict.get evaluates its fallback even when workedMinutes is present.
        let fallback = item(day, "work_minutes")?;
        let worked = get(action, "workedMinutes")?.unwrap_or(fallback);
        leave = json!({"date":today,"workedMinutes":worked,"todayRemainingMinutes":remaining,"remainingWorkdays":count,"averageDailyBeforeMinutes":ceil(before,count),"averageDailyAfterMinutes":ceil(before+remaining,count),"additionalPerDayMinutes":ceil(remaining,count),"feasible":shortfall==0,"shortfallMinutes":shortfall});
    }
    let current = sum_numbers(
        ledger
            .iter()
            .filter(|(d, _)| **d <= today.as_str())
            .map(|(_, d)| recognized(d)),
    )?;
    let bounds = constrained_projection(payload, now, false, constraints, compatibility)?;
    let mut expected = current
        + sum_numbers(
            ledger
                .iter()
                .filter(|(d, _)| **d > today.as_str())
                .map(|(_, d)| recognized(d)),
        )?
        + sum_numbers(
            planned
                .iter()
                .filter(|(d, _)| **d >= today.as_str())
                .map(|(_, d)| number(d, "plannedAdditionalMinutes", 0)),
        )?;
    if let Some(c) = constraints {
        expected = required_number(c, "forecastMinutes")?;
    }
    let mut forecast = json!({"recognizedMinutes":current,"expectedMinutes":expected,"minMinutes":bounds.map(|b|b.0),"maxMinutes":bounds.map(|b|b.1)});
    if bounds.is_none() {
        forecast["fixedConflict"] = json!(true);
    }
    if let Some(c) = constraints {
        forecast["basis"] = get(c, "basis")?
            .cloned()
            .unwrap_or(json!("target_eligible"));
    }
    let progress = target_progress(payload, &today)?;
    Ok(
        json!({"asOf":now.format("%Y-%m-%dT%H:%M").to_string(),"pace":item(&progress,"pace")?,"burnRateMinutes":item(&progress,"burnRateMinutes")?,"targets":item(&progress,"targets")?,"guards":guards.into_iter().map(|(_,g)|g).collect::<Vec<_>>(),"leaveNow":leave,"forecast":forecast}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decimal_rounding_matches_python_binary_float_ties() {
        assert_eq!(round1(2.25).unwrap(), 2.2);
        assert_eq!(round1(2.35).unwrap(), 2.4);
        assert_eq!(round1(0.15).unwrap(), 0.1);
    }
    #[test]
    fn offset_dates_are_converted_to_kst() {
        assert_eq!(
            parse_now("2042-03-03T15:00:00+00:00").unwrap().to_string(),
            "2042-03-04 00:00:00"
        );
    }
}
