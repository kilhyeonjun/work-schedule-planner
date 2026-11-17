use crate::model::Day;
pub fn explain_day(day: &Day, additional: i64, daily_cap: i64) -> Vec<&'static str> {
    let mut reasons = Vec::new();
    if day.leave_minutes != 0 {
        reasons.push("recognized_leave_retained");
    }
    if additional != 0 {
        reasons.push("lowest_projected_recognized_load");
    }
    if day.worked_minutes + additional == daily_cap {
        reasons.push("daily_cap_reached");
    }
    if additional == 0 && (day.day_type != "workday" || !day.availability.available) {
        reasons.push("unavailable");
    }
    if reasons.is_empty() {
        reasons.push("no_additional_work_required");
    }
    reasons
}
pub fn explain_result(status: &str, gap: i64) -> String {
    match status {
        "satisfied" => "The recognized baseline already meets the selected target.".into(),
        "insufficient_slots" => format!("Hard limits leave an explicit {gap}-minute gap."),
        _ => "Additional work is balanced by projected recognized load while hard limits remain intact.".into(),
    }
}
