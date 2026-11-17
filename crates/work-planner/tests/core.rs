use serde_json::{Value, json};
use work_planner::{feasibility::additional_work_bounds, model::parse_work_month, plan_month};

fn source() -> Value {
    json!({"dataOrigin":"synthetic","generator":{},"period":"2042-03","timezone":"UTC","targetMinutes":783,"policy":{"weeklyLimitMinutes":2400,"normalMinutes":500,"maxMinutes":719,"weekdayCaps":{},"dateOverrides":{}},"days":(3..7).map(|d|json!({"date":format!("2042-03-{d:02}"),"dayType":"workday","workedMinutes":0,"recognizedMinutes":0,"leaveMinutes":0,"availability":{"available":true,"minWorkMinutes":285,"maxWorkMinutes":719}})).collect::<Vec<_>>()})
}
#[test]
fn optional_minimum_is_never_partially_activated() {
    let result = plan_month(&source()).unwrap();
    let mut positive: Vec<i64> = result["days"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|d| d["plannedAdditionalMinutes"].as_i64().filter(|n| *n > 0))
        .collect();
    positive.sort();
    assert_eq!(positive, vec![391, 392]);
    assert_eq!(result["constraints"]["minimumWorkPassed"], true);
}
#[test]
fn allocation_is_input_order_invariant() {
    let input = source();
    let mut reversed = input.clone();
    reversed["days"].as_array_mut().unwrap().reverse();
    assert_eq!(plan_month(&input).unwrap(), plan_month(&reversed).unwrap());
}
#[test]
fn target_below_attendance_floor_leaves_explicit_gap() {
    let mut input = source();
    input["targetMinutes"] = json!(1);
    let result = plan_month(&input).unwrap();
    assert_eq!(result["plannedAdditionalMinutes"], 0);
    assert_eq!(result["gapMinutes"], 1);
}
#[test]
fn fixed_commitments_remain_above_target() {
    let mut input = source();
    input["targetMinutes"] = json!(1);
    input["policy"]["dateOverrides"] = json!({"2042-03-03":300});
    let result = plan_month(&input).unwrap();
    assert_eq!(result["status"], "over_target");
    assert_eq!(result["overTargetMinutes"], 299);
}
#[test]
fn invalid_availability_is_structured_infeasible() {
    let mut input = source();
    input["days"][0]["availability"]["maxWorkMinutes"] = json!(200);
    let result = plan_month(&input).unwrap();
    assert_eq!(result["infeasible"]["reason"], "invalid_availability");
    assert_eq!(result["plannedAdditionalMinutes"], 0);
}
#[test]
fn fixed_week_conflicts_have_no_bounds() {
    let mut input = source();
    input["policy"]["weeklyLimitMinutes"] = json!(100);
    input["policy"]["dateOverrides"] = json!({"2042-03-03":300});
    assert_eq!(
        additional_work_bounds(&parse_work_month(&input).unwrap()),
        None
    );
    assert_eq!(
        plan_month(&input).unwrap()["infeasible"]["reason"],
        "fixed_weekly_conflict"
    );
}
#[test]
fn weighted_loads_compare_exact_ratios() {
    let mut input = source();
    input["targetMinutes"] = json!(3);
    input["days"].as_array_mut().unwrap().truncate(2);
    for d in input["days"].as_array_mut().unwrap() {
        d["availability"]["minWorkMinutes"] = json!(0);
    }
    input["days"][0]["availability"]["maxWorkMinutes"] = json!(2);
    input["days"][1]["availability"]["maxWorkMinutes"] = json!(4);
    input["policy"]["allocationMode"] = json!("capacity_weighted");
    let result = plan_month(&input).unwrap();
    assert_eq!(result["days"][0]["plannedAdditionalMinutes"], 1);
    assert_eq!(result["days"][1]["plannedAdditionalMinutes"], 2);
}
#[test]
fn invalid_integer_rejects_booleans() {
    let mut input = source();
    input["targetMinutes"] = json!(true);
    let error = plan_month(&input).unwrap_err();
    assert_eq!(error.kind, "ValueError");
    assert_eq!(
        error.message,
        "targetMinutes must be a non-negative integer"
    );
}
#[test]
fn iso_week_crosses_calendar_year() {
    let mut input = source();
    input["days"][0]["date"] = json!("2021-01-01");
    let month = parse_work_month(&input).unwrap();
    assert_eq!(month.days[0].week_key, "2020-W53");
    assert_eq!(month.days[0].weekday, 4);
}
macro_rules! golden {
    ($test:ident,$name:literal) => {
        #[test]
        fn $test() {
            let input: Value = serde_json::from_str(include_str!(concat!(
                "../../../fixtures/scenarios/",
                $name,
                ".input.json"
            )))
            .unwrap();
            let expected: Value = serde_json::from_str(include_str!(concat!(
                "../../../public/demo-data/",
                $name,
                ".result.json"
            )))
            .unwrap();
            assert_eq!(plan_month(&input).unwrap(), expected["result"]);
        }
    };
}
golden!(balanced_month, "balanced-month");
golden!(weekday_cap, "weekday-cap");
golden!(partial_leave_weekly_cap, "partial-leave-weekly-cap");
golden!(infeasible_target, "infeasible-target");
golden!(input_order_determinism, "input-order-determinism");
