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
    assert_eq!(month.days()[0].week_key, "2020-W53");
    assert_eq!(month.days()[0].weekday, 4);
}

#[test]
fn schema_minute_limits_are_inclusive_and_enforced() {
    for (path, maximum) in [
        ("/targetMinutes", 44_640),
        ("/policy/weeklyLimitMinutes", 10_080),
        ("/policy/normalMinutes", 1_440),
        ("/policy/maxMinutes", 1_440),
        ("/days/0/workedMinutes", 1_440),
        ("/days/0/recognizedMinutes", 1_440),
        ("/days/0/leaveMinutes", 1_440),
        ("/days/0/availability/minWorkMinutes", 1_440),
        ("/days/0/availability/maxWorkMinutes", 1_440),
    ] {
        let mut input = source();
        *input.pointer_mut(path).unwrap() = json!(maximum);
        assert!(parse_work_month(&input).is_ok(), "{path}");
        *input.pointer_mut(path).unwrap() = json!(maximum + 1);
        assert!(parse_work_month(&input).is_err(), "{path}");
    }
    for (policy, key) in [("dateOverrides", "2042-03-03"), ("weekdayCaps", "0")] {
        let mut input = source();
        input["policy"][policy][key] = json!(1440);
        assert!(parse_work_month(&input).is_ok());
        input["policy"][policy][key] = json!(1441);
        assert!(parse_work_month(&input).is_err());
    }
}

#[test]
fn month_size_and_date_identity_are_bounded() {
    let mut input = source();
    let day = input["days"][0].clone();
    let days = input["days"].as_array_mut().unwrap();
    days.clear();
    days.extend((1..=31).map(|i| {
        let mut row = day.clone();
        row["date"] = json!(format!("2042-03-{i:02}"));
        row
    }));
    assert!(parse_work_month(&input).is_ok());
    input["days"].as_array_mut().unwrap().push(day);
    assert_eq!(
        parse_work_month(&input).unwrap_err().message,
        "days must contain at most 31 entries"
    );

    let mut input = source();
    input["days"][1]["date"] = json!("20420303");
    assert_eq!(
        parse_work_month(&input).unwrap_err().message,
        "day dates must be unique"
    );
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

#[test]
fn python_int_coercions_are_explicit_and_fallible() {
    use work_planner::input::py_int;
    for value in [
        json!(500),
        json!(500.0),
        json!(500.9),
        json!("5_00"),
        json!(" +500 "),
    ] {
        assert_eq!(py_int(&value).unwrap(), 500);
    }
    assert_eq!(py_int(&json!(-500.9)).unwrap(), -500);
    assert_eq!(py_int(&json!("500.0")).unwrap_err().kind, "ValueError");
    assert_eq!(py_int(&json!([])).unwrap_err().kind, "TypeError");
}

#[test]
fn iso_times_follow_python_311_and_explicit_runtime_compatibility() {
    use work_planner::input::{IsoCompatibility, iso_time, iso_time_with_compat};
    for raw in [
        "0900",
        "09:00",
        "T090000",
        "09:00:00.1234567",
        "09:00+09:00",
        "09.5",
    ] {
        let value = iso_time(&json!(raw)).unwrap();
        assert_eq!((value.hour, value.minute), (9, 0));
    }
    assert!(iso_time(&json!("24:00")).is_err());
    let newer = IsoCompatibility {
        midnight_24: true,
        short_fraction: false,
    };
    assert_eq!(
        iso_time_with_compat(&json!("24:00"), newer).unwrap().hour,
        0
    );
    assert!(iso_time_with_compat(&json!("09.5"), newer).is_err());
    assert!(iso_time(&json!("24:01")).is_err());
}

#[test]
fn arbitrary_json_integers_are_rejected_before_arithmetic() {
    let mut input = source();
    input["days"][0]["workedMinutes"] = serde_json::from_str("922337203685477580700").unwrap();
    assert_eq!(plan_month(&input).unwrap_err().kind, "ValueError");
}

#[test]
fn malformed_projection_days_are_an_error_not_a_panic() {
    let input = json!({
        "days": [], "derived": {}, "planner": {
            "settings": {"shortDayMinutes":285,"longDayMinutes":600},
            "plan": {"days":[],"summary":{"weekly":[]}}
        }
    });
    let result = work_planner::insights::month_insights(
        &input,
        "2042-03-04T12:00:00+09:00",
        Some(&json!({"days":null})),
    );
    assert_eq!(result.unwrap_err().kind, "TypeError");
    assert!(plan_month(&source()).is_ok());
}

#[test]
fn strict_iso_dates_do_not_accept_unpadded_calendar_fields() {
    use work_planner::model::date;
    for value in ["2042-3-03", "2042-03-3", "2042W10-1", "0000-01-01"] {
        assert!(date(value).is_err(), "{value}");
    }
    assert_eq!(date("2042-W10").unwrap(), date("2042W101").unwrap());
}
