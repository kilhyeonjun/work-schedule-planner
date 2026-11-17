use crate::{
    Result,
    insights::{month_insights, n, rows, s},
    model::{date, week_key},
    planner::plan_month,
};
use chrono::{Datelike, Duration, NaiveDate};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const DEMO_YEAR: i32 = 2042;
pub const DEMO_MONTH: u32 = 3;
pub const DEFAULT_TARGET: i64 = 7800;
pub const TODAY: &str = "2042-03-04";
const WEEKDAYS: [&str; 7] = ["월", "화", "수", "목", "금", "토", "일"];
pub fn month_dates(year: i32, month: u32) -> Result<Vec<NaiveDate>> {
    let start = NaiveDate::from_ymd_opt(year, month, 1)
        .ok_or_else(|| crate::Error::value("month must be in 1..12"))?;
    Ok((0..31)
        .map(|i| start + Duration::days(i))
        .take_while(|d| d.month() == month)
        .collect())
}
pub fn nine_hour_target_minutes(year: i32, month: u32) -> Result<i64> {
    Ok(month_dates(year, month)?
        .iter()
        .filter(|d| d.weekday().num_days_from_monday() < 5)
        .count() as i64
        * 540)
}
fn clock(minutes: i64) -> String {
    format!(
        "{:02}:{:02}",
        minutes.div_euclid(60),
        minutes.rem_euclid(60)
    )
}
pub fn window(minutes: i64) -> String {
    match minutes {
        719 => "06:40–19:40".into(),
        500 => "06:40–16:00".into(),
        285 => "10:45–16:00".into(),
        m if m >= 500 => format!("06:40–{}", clock(960.max(400 + m + 60))),
        m => {
            let rest = if m >= 480 {
                60
            } else if m >= 240 {
                30
            } else {
                0
            };
            format!("{}–16:00", clock(960 - m - rest))
        }
    }
}
fn kind(minutes: i64, normal: i64, long: i64, short: i64) -> &'static str {
    if minutes == normal {
        "normal"
    } else if long > normal && minutes == long {
        "long"
    } else if short < normal && minutes == short {
        "short"
    } else {
        "adjust"
    }
}
pub fn source(
    year: i32,
    month: u32,
    target: i64,
    normal: i64,
    long: i64,
    short: i64,
    archive: bool,
) -> Result<Value> {
    let mut days = Vec::new();
    for d in month_dates(year, month)? {
        let key = d.to_string();
        let workday = d.weekday().num_days_from_monday() < 5;
        let past = archive || key.as_str() <= TODAY;
        let mut worked = if workday && past { 420 } else { 0 };
        let leave = if key == "2042-03-03" { 120 } else { 0 };
        if key == TODAY {
            worked = 240;
        }
        days.push(json!({"date":key,"dayType":if workday{"workday"}else{"weekend"},"workedMinutes":worked,"recognizedMinutes":worked+leave,"leaveMinutes":leave,"availability":{"available":workday && (archive || key.as_str()>=TODAY),"minWorkMinutes":(short-leave).max(0),"maxWorkMinutes":long}}));
    }
    Ok(
        json!({"dataOrigin":"synthetic","generator":{"name":"constraint-work-planner-demo","version":"1","seed":7601},"period":format!("{year:04}-{month:02}"),"timezone":"UTC","targetMinutes":target,"policy":{"weeklyLimitMinutes":2400,"normalMinutes":normal,"maxMinutes":long,"allocationMode":"capacity_weighted","dateOverrides":{},"weekdayCaps":{"4":normal}},"days":days}),
    )
}
fn combinations(indices: &[usize], size: usize) -> Vec<Vec<usize>> {
    fn visit(
        indices: &[usize],
        size: usize,
        start: usize,
        selected: &mut Vec<usize>,
        out: &mut Vec<Vec<usize>>,
    ) {
        if selected.len() == size {
            out.push(selected.clone());
            return;
        }
        for j in start..indices.len() {
            selected.push(indices[j]);
            visit(indices, size, j + 1, selected, out);
            selected.pop();
        }
    }
    let mut out = Vec::new();
    visit(indices, size, 0, &mut Vec::new(), &mut out);
    out
}
pub fn normal_first(mut result: Value, source: &Value, normal: i64) -> Value {
    let source_days: BTreeMap<&str, &Value> = rows(&source["days"])
        .iter()
        .map(|d| (s(d, "date"), d))
        .collect();
    let rs = result["days"].as_array_mut().unwrap();
    let mut weeks: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, row) in rs.iter().enumerate() {
        weeks.entry(s(row, "week").to_owned()).or_default().push(i);
    }
    for indices in weeks.values() {
        let total: i64 = indices
            .iter()
            .map(|&i| n(&rs[i], "plannedAdditionalMinutes"))
            .sum();
        let mut eligible = Vec::new();
        let mut bounds = BTreeMap::new();
        for &i in indices {
            let row = &rs[i];
            let a = &source_days[s(row, "date")]["availability"];
            if a["available"] != true {
                continue;
            }
            let worked = n(row, "workedMinutes");
            let minimum = (n(a, "minWorkMinutes") - worked).max(0);
            let capacity = (n(row, "dailyWorkCapMinutes") - worked).max(0);
            let normal_additional =
                minimum.max(capacity.min(normal - worked - n(row, "leaveMinutes")));
            eligible.push(i);
            bounds.insert(i, [minimum, normal_additional, capacity]);
        }
        let mut selected = None;
        for size in (1..=eligible.len()).rev() {
            selected = combinations(&eligible, size).into_iter().find(|g| {
                g.iter().map(|i| bounds[i][0]).sum::<i64>() <= total
                    && total <= g.iter().map(|i| bounds[i][2]).sum::<i64>()
            });
            if selected.is_some() {
                break;
            }
        }
        let Some(selected) = selected else {
            continue;
        };
        let mut allocation: BTreeMap<usize, i64> = eligible.iter().map(|&i| (i, 0)).collect();
        let normal_total: i64 = selected.iter().map(|i| bounds[i][1]).sum();
        let target_bound = if total >= normal_total { 2 } else { 1 };
        for &i in &selected {
            allocation.insert(i, bounds[&i][if target_bound == 2 { 1 } else { 0 }]);
        }
        let mut remaining = total - allocation.values().sum::<i64>();
        for &i in &selected {
            let added = remaining.min(bounds[&i][target_bound] - allocation[&i]);
            *allocation.get_mut(&i).unwrap() += added;
            remaining -= added;
            if remaining == 0 {
                break;
            }
        }
        for i in eligible {
            let a = allocation[&i];
            let row = &mut rs[i];
            row["plannedAdditionalMinutes"] = json!(a);
            row["plannedWorkMinutes"] = json!(n(row, "workedMinutes") + a);
            row["projectedRecognizedMinutes"] = json!(n(row, "recognizedMinutes") + a);
            row["reasons"] = if a != 0 {
                json!(["normal_work_first"])
            } else {
                json!([])
            };
        }
    }
    result
}
pub fn demo_plan(
    year: i32,
    month: u32,
    target: i64,
    normal: i64,
    long: i64,
    short: i64,
    archive: bool,
) -> Result<Value> {
    let src = source(year, month, target, normal, long, short, archive)?;
    Ok(normal_first(plan_month(&src)?, &src, normal))
}
fn weekly(
    rs: &[Value],
    actual: &BTreeMap<&str, i64>,
    normal: i64,
    long: i64,
    short: i64,
) -> Result<Vec<Value>> {
    let mut groups: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
    for row in rs {
        groups
            .entry(week_key(date(s(row, "date"))?))
            .or_default()
            .push(row);
    }
    let mut out = Vec::new();
    for (key, items) in groups {
        let dates: Vec<&str> = items.iter().map(|d| s(d, "date")).collect();
        let added: i64 = items.iter().map(|d| n(d, "plannedAdditionalMinutes")).sum();
        let worked: i64 = dates.iter().map(|d| actual.get(d).unwrap_or(&0)).sum();
        let kinds: Vec<&str> = items
            .iter()
            .filter(|d| n(d, "plannedWorkMinutes") > 0)
            .map(|d| kind(n(d, "plannedWorkMinutes"), normal, long, short))
            .collect();
        let start = date(dates[0])?;
        let end = date(dates[dates.len() - 1])?;
        out.push(json!({"key":key,"label":format!("{}/{}–{}/{}",start.month(),start.day(),end.month(),end.day()),"plannedAdditionalMinutes":added,"plannedMinutes":worked+added,"actualMinutes":worked,"projectedActualMinutes":worked+added,"weeklyMaxMinutes":2400,"remainingToWeeklyMaxMinutes":(2400-worked-added).max(0),"longDays":kinds.iter().filter(|&&k|k=="long").count(),"normalDays":kinds.iter().filter(|&&k|k=="normal").count(),"shortDays":kinds.iter().filter(|&&k|k=="short").count(),"adjustDays":kinds.iter().filter(|&&k|k=="adjust").count(),"todayIncluded":dates.contains(&TODAY),"fridayNormal":true,"dates":dates}));
    }
    Ok(out)
}
fn comparison(
    key: &str,
    label: &str,
    target: i64,
    selected: i64,
    plan: &Value,
    settings: [i64; 3],
) -> Value {
    let [normal, long, short] = settings;
    let planned: Vec<&Value> = rows(&plan["days"])
        .iter()
        .filter(|d| n(d, "plannedAdditionalMinutes") > 0)
        .collect();
    let kinds: Vec<&str> = planned
        .iter()
        .map(|d| kind(n(d, "plannedWorkMinutes"), normal, long, short))
        .collect();
    json!({"key":key,"label":label,"targetMinutes":target,"selected":target==selected,"status":plan["status"],"remainingMinutes":(target-n(plan,"recognizedBaselineMinutes")).max(0),"gapMinutes":plan["gapMinutes"],"effortLabel":match key{"target"=>"낮음","fixed_ot"=>"보통",_=>"높음"},"effortMessage":"합성 데이터 기반 시뮬레이션","projectedExtraPayAfterTaxKrw":0,"summary":{"plannedDays":planned.len(),"longDays":kinds.iter().filter(|&&k|k=="long").count(),"normalDays":kinds.iter().filter(|&&k|k=="normal").count(),"shortDays":kinds.iter().filter(|&&k|k=="short").count(),"adjustDays":kinds.iter().filter(|&&k|k=="adjust").count(),"averageDailyMinutes":if planned.is_empty(){0}else{planned.iter().map(|d|n(d,"plannedWorkMinutes")).sum::<i64>()/planned.len() as i64}},"feasibility":{"status":plan["status"],"gapMinutes":plan["gapMinutes"]}})
}
// Optional precomputed plans preserve the Python facade's observable LRU cache.
pub fn month_payload(
    year: i32,
    month: u32,
    target: i64,
    normal: i64,
    long: i64,
    short: i64,
    plans: Option<&Value>,
) -> Result<Value> {
    let (year, month) = (year, month).min((DEMO_YEAR, DEMO_MONTH));
    let archive = (year, month) != (DEMO_YEAR, DEMO_MONTH);
    let mut src = source(year, month, target, normal, long, short, archive)?;
    let baseline: i64 = rows(&src["days"])
        .iter()
        .map(|d| n(d, "recognizedMinutes"))
        .sum();
    let target = target.max(baseline);
    src["targetMinutes"] = json!(target);
    let get_plan = |t: i64| -> Result<Value> {
        if let Some(p) = plans.and_then(|p| p.get(t.to_string())) {
            Ok(p.clone())
        } else {
            demo_plan(year, month, t, normal, long, short, archive)
        }
    };
    let result = get_plan(target)?;
    let raw_days = rows(&src["days"]);
    let actual: BTreeMap<&str, i64> = raw_days
        .iter()
        .map(|d| (s(d, "date"), n(d, "workedMinutes")))
        .collect();
    let total_actual: i64 = actual.values().sum();
    let collected = if archive {
        format!("{year:04}-{month:02}-{:02}T07:00:00Z", raw_days.len())
    } else {
        "2042-03-04T07:00:00Z".into()
    };
    let mut days = Vec::new();
    let mut planner_days = Vec::new();
    for (raw, planned) in raw_days.iter().zip(rows(&result["days"])) {
        let d = s(raw, "date");
        let date = date(d)?;
        let weekday = date.weekday().num_days_from_monday() as usize;
        let worked = n(raw, "workedMinutes");
        let leave = n(raw, "leaveMinutes");
        let ongoing = d == TODAY && !archive;
        days.push(json!({"date":d,"weekday":WEEKDAYS[weekday],"day_type":raw["dayType"],"badge":if weekday<5{"근무일"}else{"주말"},"work_minutes":worked,"recognized_minutes":raw["recognizedMinutes"],"office_minutes":if d=="2042-03-03"{(worked-120).max(0)}else{worked},"remote_minutes":if d=="2042-03-03"{120.min(worked)}else{0},"timeoff_minutes":leave,"rest_minutes":if worked!=0{if ongoing{30}else{60}}else{0},"night_minutes":0,"first_start":if worked!=0{Some("09:00")}else{None},"last_end":if ongoing{Some("13:30")}else if worked!=0{Some("17:00")}else{None},"intervals":if worked==0{json!([])}else if ongoing{json!(["09:00–12:00","12:30–13:30"])}else{json!(["09:00–12:00","13:00–17:00"])},"notes":if worked!=0{json!(["합성 데모 기록"])}else{json!([])},"is_ongoing":ongoing,"is_on_break":false}));
        let additional = n(planned, "plannedAdditionalMinutes");
        let total = worked + additional;
        planner_days.push(json!({"date":d,"weekday":WEEKDAYS[weekday],"kind":if total>0{kind(total,normal,long,short)}else{"off"},"window":if total>0{window(total)}else{"—".into()},"plannedMinutes":total,"plannedAdditionalMinutes":additional,"currentWorkedMinutes":worked,"timeoffMinutes":leave,"isToday":d==TODAY,"isDateOverride":false}));
    }
    let current_office: i64 = days
        .iter()
        .filter(|d| s(d, "date") <= TODAY)
        .map(|d| n(d, "office_minutes") + n(d, "timeoff_minutes"))
        .sum();
    let projected_office = current_office
        + days
            .iter()
            .filter(|d| s(d, "date") > TODAY)
            .map(|d| n(d, "timeoff_minutes"))
            .sum::<i64>()
        + n(&result, "plannedAdditionalMinutes");
    let mut base = json!({"ok":true,"dataOrigin":"synthetic","year":year,"month":month,"collectedAt":collected,"derived":{"actualMinutes":total_actual,"recognizedMinutes":baseline,"timeOffMinutes":raw_days.iter().map(|d|n(d,"leaveMinutes")).sum::<i64>(),"targetMinutes":target,"fixedOtMinutes":7800,"maxMinutes":9000,"statutoryMaxMinutes":9000},"days":days,"ui":{"readOnly":true,"archiveMode":archive,"targetConfiguration":{"enabled":!archive}},"sync":{"lastSyncAt":collected,"ageMinutes":0,"stale":false,"lastError":null},"truth":{"current":{"sourceActualMinutes":total_actual,"inProgressActualMinutes":0,"effectiveActualMinutes":total_actual,"sourceRecognizedMinutes":baseline,"effectiveRecognizedMinutes":baseline,"remainingToSelectedTargetMinutes":(target-baseline).max(0),"selectedTargetMinutes":target,"officialAsOf":collected,"isOngoing":!archive,"isOnBreak":false}},"notifications":{"items":[{"topicTitle":"데모 알림","latestText":"합성 데이터 알림","createdAt":collected}]}});
    if archive {
        return Ok(base);
    }
    let options = [
        ("target", "최소 기준", 7200),
        ("nine_hour", "9시간", nine_hour_target_minutes(year, month)?),
        ("fixed_ot", "수당 기준선", 7800),
        ("max", "상한", 9000),
    ];
    let mut comparisons = Vec::new();
    for (key, label, value) in options {
        let p = if value == target {
            result.clone()
        } else {
            get_plan(value)?
        };
        comparisons.push(comparison(
            key,
            label,
            value,
            target,
            &p,
            [normal, long, short],
        ));
    }
    let long_days = planner_days
        .iter()
        .filter(|d| s(d, "kind") == "long")
        .count();
    let adjust_last = planner_days
        .iter()
        .rev()
        .find(|d| s(d, "kind") == "adjust")
        .map(|d| d["date"].clone());
    let today_index = planner_days
        .iter()
        .position(|d| s(d, "date") == TODAY)
        .unwrap();
    let today_window = window(n(&planner_days[today_index], "plannedMinutes"));
    planner_days[today_index]["window"] = json!(today_window);
    let today_plan = planner_days[today_index].clone();
    let count = |k: &str| planner_days.iter().filter(|d| s(d, "kind") == k).count();
    base["planner"] = json!({"targetOptions":options.iter().map(|(key,label,value)|json!({"key":key,"label":label,"minutes":value})).collect::<Vec<_>>(),"selectedTargetMinutes":target,"settings":{"normalDayMinutes":normal,"longDayMinutes":long,"shortDayMinutes":short},"comparisons":comparisons,"strategy":{"mode":"commute","distributionMode":"commute_concentrated","title":"보통근무 우선","message":"보통근무를 우선 유지하고, 부족분은 롱데이에 집중하며, 초과분은 늦게 출근해 16시에 퇴근하도록 조정합니다.","frontLoadedLongDays":long_days,"fridayLongDays":0,"bufferDate":adjust_last,"longDays":long_days,"projectedExtraPayAfterTaxKrw":0},"plan":{"status":result["status"],"targetMinutes":target,"recognizedMinutes":baseline,"sourceRecognizedMinutes":baseline,"inProgressRecognizedMinutes":0,"officeMinimum":{"requiredMinutes":7200,"currentMinutes":current_office,"remainingMinutes":(7200-current_office).max(0),"satisfied":current_office>=7200,"projectedMinutes":projected_office,"projectedSatisfied":projected_office>=7200,"deferredRemoteMinutes":if current_office<7200{120}else{0},"remoteCountsAfterMinimum":true},"remainingMinutes":(target-baseline).max(0),"plannedTotalMinutes":result["plannedAdditionalMinutes"],"forecastMinutes":baseline+n(&result,"plannedAdditionalMinutes"),"gapMinutes":result["gapMinutes"],"projectedOverFixedMinutes":0,"projectedExtraPayPreTaxKrw":0,"projectedExtraPayAfterTaxKrw":0,"summary":{"plannedDays":planner_days.len()-count("off"),"longDays":count("long"),"normalDays":count("normal"),"shortDays":count("short"),"adjustDays":count("adjust"),"averageDailyMinutes":0,"weekly":weekly(rows(&result["days"]),&actual,normal,long,short)?},"days":planner_days,"feasibility":{"status":result["status"],"possibleTargetMinutes":target-n(&result,"gapMinutes"),"gapMinutes":result["gapMinutes"],"targetReductionMinutes":result["gapMinutes"],"requiredLongDayMinutes":0,"requiredLongDayFeasible":n(&result,"gapMinutes")==0},"todayAction":{"kind":"workday","date":today_plan["date"],"window":today_window,"decisionTitle":"오늘은 계획대로 진행","message":"합성 데이터 기반 권장","workedMinutes":today_plan["currentWorkedMinutes"],"remainingTodayMinutes":today_plan["plannedAdditionalMinutes"],"recommendedLeaveTime":&today_window[today_window.len()-5..],"minimumTargetRemainingTodayMinutes":today_plan["plannedAdditionalMinutes"]}}});
    src["recognizedBaselineMinutes"] = json!(baseline);
    src["forecastMinutes"] = json!(baseline + n(&result, "plannedAdditionalMinutes"));
    src["basis"] = json!("ledger");
    base["planner"]["insights"] = month_insights(&base, "2042-03-04T12:00:00+09:00", Some(&src))?;
    Ok(base)
}
pub fn archive_payload() -> Result<Value> {
    let mut months = Vec::new();
    for month in [3, 2] {
        let detail = month_payload(2042, month, 7800, 500, 719, 285, None)?;
        months.push(json!({"key":format!("2042-{month:02}"),"year":2042,"month":month,"collectedAt":detail["collectedAt"],"targetMinutes":detail["derived"]["targetMinutes"],"recognizedMinutes":detail["derived"]["recognizedMinutes"]}));
    }
    Ok(json!({"ok":true,"dataOrigin":"synthetic","months":months}))
}
