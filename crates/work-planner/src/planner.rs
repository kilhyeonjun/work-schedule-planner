use crate::{
    Error, Result,
    explain::{explain_day, explain_result},
    feasibility::*,
    model::{MAX_TARGET_MINUTES, WorkMonth, parse_flex_allocation, parse_work_month},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn water_fill(
    month: &WorkMonth,
    caps: &[i64],
    weekly: &mut BTreeMap<String, i64>,
    allocated: &mut [i64],
    mut remaining: i64,
    activated: &[bool],
    allowed: Option<&[usize]>,
) -> i64 {
    while remaining > 0 {
        let selected = month
            .days()
            .iter()
            .enumerate()
            .filter(|(i, d)| {
                allowed.is_none_or(|a| a.contains(i))
                    && allocated[*i] < caps[*i]
                    && (minimum_additional_work(d) == 0 || activated[*i])
                    && *weekly.get(&d.week_key).unwrap_or(&0)
                        < month.policy().weekly_limit_minutes()
            })
            .min_by(|(i, a), (j, b)| {
                let left = a.recognized_minutes + allocated[*i];
                let right = b.recognized_minutes + allocated[*j];
                let order = if month.policy().allocation_mode() == "capacity_weighted" {
                    (i128::from(left) * i128::from(caps[*j]))
                        .cmp(&(i128::from(right) * i128::from(caps[*i])))
                } else {
                    left.cmp(&right)
                };
                order.then_with(|| a.date.cmp(&b.date))
            })
            .map(|(i, _)| i);
        let Some(index) = selected else {
            break;
        };
        allocated[index] += 1;
        let week = &month.days()[index].week_key;
        if let Some(total) = weekly.get_mut(week) {
            *total += 1;
        } else {
            weekly.insert(week.clone(), 1);
        }
        remaining -= 1;
    }
    remaining
}
#[derive(PartialEq, Eq, PartialOrd, Ord)]
struct BalanceKey(bool, i64, i64, i64, Vec<i64>, Vec<usize>);
fn balance_key(
    month: &WorkMonth,
    days: &[usize],
    caps: &[i64],
    weekly: &BTreeMap<String, i64>,
    preferred: &[i64],
    amount: i64,
    selected: &[usize],
) -> BalanceKey {
    let mut allocated = vec![0; month.days().len()];
    let mut simulated = weekly.clone();
    let mut activated = vec![false; month.days().len()];
    let mut remaining = amount;
    for &i in selected {
        activated[i] = true;
        let minimum = minimum_additional_work(&month.days()[i]);
        allocated[i] = minimum;
        *simulated
            .entry(month.days()[i].week_key.clone())
            .or_default() += minimum;
        remaining -= minimum;
    }
    remaining = water_fill(
        month,
        caps,
        &mut simulated,
        &mut allocated,
        remaining,
        &activated,
        Some(days),
    );
    let projected: Vec<i64> = days
        .iter()
        .copied()
        .filter(|&i| caps[i] > 0)
        .map(|i| month.days()[i].recognized_minutes + allocated[i])
        .collect();
    let distance = days
        .iter()
        .map(|&i| (allocated[i] - preferred[i]).abs())
        .sum();
    let maximum = projected.iter().copied().max().unwrap_or(0);
    let spread = maximum - projected.iter().copied().min().unwrap_or(0);
    BalanceKey(
        remaining > 0,
        distance,
        spread,
        maximum,
        projected,
        selected.to_vec(),
    )
}
struct OptionRange {
    minimum: i64,
    maximum: i64,
    selected: Vec<usize>,
}
struct Week {
    reachable: Bits,
    options: Vec<OptionRange>,
    days: Vec<usize>,
}
fn minimum_activation(
    month: &WorkMonth,
    caps: &[i64],
    weekly: &BTreeMap<String, i64>,
    target: i64,
) -> Result<(i64, Vec<bool>)> {
    let count = month.days().len();
    if !month.days().iter().any(|d| minimum_additional_work(d) > 0) {
        return Ok((target, vec![false; count]));
    }
    let mut preferred = vec![0; count];
    water_fill(
        month,
        caps,
        &mut weekly.clone(),
        &mut preferred,
        target,
        &vec![true; count],
        None,
    );
    let mut grouped: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, d) in month.days().iter().enumerate() {
        grouped.entry(&d.week_key).or_default().push(i);
    }
    let mut weeks = Vec::new();
    for (week, days) in grouped {
        let capacity =
            (month.policy().weekly_limit_minutes() - weekly.get(week).unwrap_or(&0)).max(0);
        let free: i64 = days
            .iter()
            .filter(|&&i| minimum_additional_work(&month.days()[i]) == 0)
            .map(|&i| caps[i])
            .sum();
        let constrained: Vec<usize> = days
            .iter()
            .copied()
            .filter(|&i| {
                let m = minimum_additional_work(&month.days()[i]);
                m > 0 && m <= caps[i]
            })
            .collect();
        let mut options = Vec::new();
        let mut reachable = Bits::new(target as usize);
        for mask in 0..(1usize << constrained.len()) {
            let selected: Vec<usize> = constrained
                .iter()
                .enumerate()
                .filter(|(j, _)| mask & (1 << j) != 0)
                .map(|(_, i)| *i)
                .collect();
            let minimum: i64 = selected
                .iter()
                .map(|&i| minimum_additional_work(&month.days()[i]))
                .sum();
            let maximum = capacity.min(free + selected.iter().map(|&i| caps[i]).sum::<i64>());
            if minimum > maximum || minimum > target {
                continue;
            }
            let maximum = maximum.min(target);
            for n in minimum..=maximum {
                reachable.set(n as usize);
            }
            options.push(OptionRange {
                minimum,
                maximum,
                selected,
            });
        }
        weeks.push(Week {
            reachable,
            options,
            days,
        });
    }
    let mut first = Bits::new(target as usize);
    first.set(0);
    let mut prefixes = vec![first];
    for week in &weeks {
        let mut combined = Bits::new(target as usize);
        for amount in week.reachable.values() {
            let prefix = prefixes
                .last()
                .ok_or_else(|| Error::value("missing activation prefix"))?;
            combined.shifted_or(prefix, amount);
        }
        prefixes.push(combined);
    }
    let planned = prefixes.last().and_then(Bits::maximum).unwrap_or(0) as i64;
    let mut activated = vec![false; count];
    let mut remaining = planned;
    for (index, week) in weeks.iter().enumerate().rev() {
        let preferred_week: i64 = week.days.iter().map(|&i| preferred[i]).sum();
        let amount =
            week.reachable
                .values()
                .filter(|&v| v <= remaining as usize && prefixes[index].get(remaining as usize - v))
                .min_by_key(|&v| ((v as i64 - preferred_week).abs(), v))
                .ok_or_else(|| Error::value("unreachable activation amount"))? as i64;
        let selected = week
            .options
            .iter()
            .filter(|o| o.minimum <= amount && amount <= o.maximum)
            .min_by_key(|o| {
                balance_key(
                    month,
                    &week.days,
                    caps,
                    weekly,
                    &preferred,
                    amount,
                    &o.selected,
                )
            })
            .ok_or_else(|| Error::value("unreachable activation subset"))?;
        for &i in &selected.selected {
            activated[i] = true;
        }
        remaining -= amount;
    }
    Ok((planned, activated))
}
fn allocate(month: &WorkMonth, requested: i64) -> Result<std::result::Result<Vec<i64>, Value>> {
    for day in month.days() {
        if day.availability.min_work_minutes > day.availability.max_work_minutes {
            return Ok(Err(
                json!({"reason":"invalid_availability","date":day.date,"min_work_minutes":day.availability.min_work_minutes,"max_work_minutes":day.availability.max_work_minutes}),
            ));
        }
    }
    let mut allocated = vec![0; month.days().len()];
    let mut weekly = weekly_work_baseline(month.days());
    let actual = weekly.clone();
    let mut caps: Vec<i64> = month
        .days()
        .iter()
        .map(|d| daily_additional_cap(d, month.policy()))
        .collect();
    let mut fixed_total = 0;
    for (i, day) in month.days().iter().enumerate() {
        if let Some(&fixed) = month.policy().date_overrides().get(&day.date) {
            let fixed = fixed - day.worked_minutes;
            if fixed < 0 || fixed > caps[i] {
                return Err(Error::value(format!(
                    "date override is outside eligible capacity: {}",
                    day.date
                )));
            }
            allocated[i] = fixed;
            fixed_total += fixed;
            *weekly.entry(day.week_key.clone()).or_default() += fixed;
            caps[i] = 0;
        }
    }
    for (week, &projected) in &weekly {
        let limit = month
            .policy()
            .weekly_limit_minutes()
            .max(*actual.get(week).unwrap_or(&0));
        if projected > limit {
            return Ok(Err(
                json!({"reason":"fixed_weekly_conflict", "week":week, "projectedWorkMinutes":projected,"weeklyLimitMinutes":limit}),
            ));
        }
    }
    let (mut remaining, activated) =
        minimum_activation(month, &caps, &weekly, (requested - fixed_total).max(0))?;
    for (i, day) in month.days().iter().enumerate() {
        if !activated[i] {
            continue;
        }
        let minimum = minimum_additional_work(day);
        allocated[i] = minimum;
        *weekly.entry(day.week_key.clone()).or_default() += minimum;
        remaining -= minimum;
    }
    water_fill(
        month,
        &caps,
        &mut weekly,
        &mut allocated,
        remaining,
        &activated,
        None,
    );
    Ok(Ok(allocated))
}

/// Result of a Flex balanced allocation pass. Entries contain only nonzero
/// additional work; a constraint conflict is separate from malformed input.
pub enum FlexAllocation {
    Planned(Vec<(String, i64)>),
    Infeasible(Value),
}

/// Allocate a bounded amount on an operational Flex projection. The amount is
/// independent of recognized baseline; projected ledger fields retain bounded
/// work/leave sums while all attendance limits stay in the public domain.
pub fn allocate_flex_projection(payload: &Value, additional: i64) -> Result<FlexAllocation> {
    if !(0..=MAX_TARGET_MINUTES).contains(&additional) {
        return Err(Error::value("additional minutes out of supported range"));
    }
    let month = parse_flex_allocation(payload)?;
    if month.data_origin() != "operational" {
        return Err(Error::value(
            "Flex allocation requires an operational projection",
        ));
    }
    match allocate(&month, additional)? {
        Ok(minutes) => Ok(FlexAllocation::Planned(
            month
                .into_days()
                .into_iter()
                .zip(minutes)
                .filter_map(|(day, add)| (add != 0).then_some((day.date, add)))
                .collect(),
        )),
        Err(failure) => Ok(FlexAllocation::Infeasible(failure)),
    }
}

pub fn plan_month(payload: &Value) -> Result<Value> {
    let month = parse_work_month(payload)?;
    let baseline: i64 = month.days().iter().map(|d| d.recognized_minutes).sum();
    let requested = (month.target_minutes() - baseline).max(0);
    let (allocated, infeasible) = match allocate(&month, requested)? {
        Ok(a) => (a, None),
        Err(e) => (vec![0; month.days().len()], Some(e)),
    };
    let additional: i64 = allocated.iter().sum();
    let projected = baseline + additional;
    let gap = (month.target_minutes() - projected).max(0);
    let over = if !month.policy().date_overrides().is_empty() && additional > 0 {
        (projected - month.target_minutes()).max(0)
    } else {
        0
    };
    let status = if infeasible.is_some() {
        "infeasible"
    } else if over > 0 {
        "over_target"
    } else if month.target_minutes() <= baseline {
        "satisfied"
    } else if gap > 0 {
        "insufficient_slots"
    } else {
        "planned"
    };
    let days: Vec<Value> = month.days().iter().zip(&allocated).map(|(d,&a)| {
        let cap = daily_work_cap(d,month.policy());
        json!({"date":d.date,"weekday":d.weekday,"week":d.week_key,"dayType":d.day_type,"workedMinutes":d.worked_minutes,"recognizedMinutes":d.recognized_minutes,"leaveMinutes":d.leave_minutes,"plannedAdditionalMinutes":a,"plannedWorkMinutes":d.worked_minutes+a,"projectedRecognizedMinutes":d.recognized_minutes+a,"dailyWorkCapMinutes":cap,"reasons":explain_day(d,a,cap)})
    }).collect();
    let constraints = if infeasible.is_some() {
        json!({})
    } else {
        verify_constraints(month.days(), month.policy(), &allocated)
    };
    if constraints
        .as_object()
        .is_some_and(|o| o.values().any(|v| v == false))
    {
        return Err(Error::new(
            "AssertionError",
            "planner emitted a hard-constraint violation",
        ));
    }
    let explanation = if infeasible.is_some() {
        "Mandatory minimum work requirements exceed available capacity.".into()
    } else {
        explain_result(status, gap)
    };
    let mut result = json!({"dataOrigin":month.data_origin(),"generator":month.generator(),"period":month.period(),"timezone":month.timezone(),"algorithm":{"name":"deterministic-water-fill","version":"1"},"status":status,"targetMinutes":month.target_minutes(),"recognizedBaselineMinutes":baseline,"plannedAdditionalMinutes":additional,"projectedRecognizedMinutes":projected,"gapMinutes":gap,"overTargetMinutes":over,"constraints":constraints,"explanation":explanation,"days":days});
    if let Some(e) = infeasible {
        result["infeasible"] = e;
    }
    Ok(result)
}
