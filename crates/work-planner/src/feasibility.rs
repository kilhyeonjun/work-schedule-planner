use crate::model::{Day, Policy, WorkMonth};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn daily_work_cap(day: &Day, policy: &Policy) -> i64 {
    if day.day_type != "workday" || !day.availability.available {
        return day.worked_minutes;
    }
    let mut cap = policy.max_minutes.min(day.availability.max_work_minutes);
    if let Some(v) = policy.date_overrides.get(&day.date) {
        cap = cap.min(*v);
    }
    if let Some(v) = policy.weekday_caps.get(&day.weekday) {
        cap = cap.min(*v);
    }
    cap.max(day.worked_minutes)
}
pub fn daily_additional_cap(day: &Day, policy: &Policy) -> i64 {
    (daily_work_cap(day, policy) - day.worked_minutes).max(0)
}
pub fn minimum_additional_work(day: &Day) -> i64 {
    (day.availability.min_work_minutes - day.worked_minutes).max(0)
}
pub fn weekly_work_baseline(days: &[Day]) -> BTreeMap<String, i64> {
    let mut totals = BTreeMap::new();
    for day in days {
        *totals.entry(day.week_key.clone()).or_default() += day.worked_minutes;
    }
    totals
}
pub fn verify_constraints(days: &[Day], policy: &Policy, allocated: &[i64]) -> Value {
    let baseline = weekly_work_baseline(days);
    let mut weekly = baseline.clone();
    let (mut daily, mut unavailable, mut minimum) = (true, true, true);
    for (day, &additional) in days.iter().zip(allocated) {
        *weekly.entry(day.week_key.clone()).or_default() += additional;
        daily &= day.worked_minutes + additional <= daily_work_cap(day, policy);
        if day.day_type != "workday" || !day.availability.available {
            unavailable &= additional == 0;
        }
        if additional != 0 {
            minimum &= day.worked_minutes + additional >= day.availability.min_work_minutes;
        }
    }
    let mut result = json!({"dailyCapsPassed": daily, "weeklyCapsPassed": weekly.iter().all(|(w,t)| *t <= policy.weekly_limit_minutes.max(*baseline.get(w).unwrap_or(&0))), "unavailableDaysPassed": unavailable});
    if days.iter().any(|d| d.availability.min_work_minutes != 0) {
        result["minimumWorkPassed"] = json!(minimum);
    }
    result
}

// Finite bitset equivalent of Python's nonnegative arbitrary-width integer.
#[derive(Clone)]
pub(crate) struct Bits {
    words: Vec<u64>,
    max: usize,
}
impl Bits {
    pub fn new(max: usize) -> Self {
        Self {
            words: vec![0; max / 64 + 1],
            max,
        }
    }
    pub fn set(&mut self, n: usize) {
        if n <= self.max {
            self.words[n / 64] |= 1 << (n % 64);
        }
    }
    pub fn get(&self, n: usize) -> bool {
        n <= self.max && self.words[n / 64] & (1 << (n % 64)) != 0
    }
    pub fn shifted_or(&mut self, other: &Self, shift: usize) {
        let offset = shift / 64;
        let bit = shift % 64;
        for (i, &word) in other.words.iter().enumerate() {
            if i + offset >= self.words.len() {
                break;
            }
            self.words[i + offset] |= word << bit;
            if bit > 0 && i + offset + 1 < self.words.len() {
                self.words[i + offset + 1] |= word >> (64 - bit);
            }
        }
        let used = self.max % 64 + 1;
        if used < 64 {
            *self.words.last_mut().unwrap() &= (1 << used) - 1;
        }
    }
    pub fn values(&self) -> impl Iterator<Item = usize> + '_ {
        self.words.iter().enumerate().flat_map(|(i, &word)| {
            let mut remaining = word;
            std::iter::from_fn(move || {
                if remaining == 0 {
                    return None;
                }
                let bit = remaining.trailing_zeros() as usize;
                remaining &= remaining - 1;
                Some(i * 64 + bit)
            })
        })
    }
    pub fn maximum(&self) -> Option<usize> {
        self.values().last()
    }
}
pub fn additional_work_bounds(month: &WorkMonth) -> Option<(i64, i64)> {
    let baseline = weekly_work_baseline(&month.days);
    let mut reachable: BTreeMap<String, Bits> = BTreeMap::new();
    let mut fixed = 0;
    for day in &month.days {
        let cap = daily_additional_cap(day, &month.policy);
        if cap == 0 {
            continue;
        }
        let room = (month.policy.weekly_limit_minutes - baseline.get(&day.week_key).unwrap_or(&0))
            .max(0) as usize;
        let bits = reachable.entry(day.week_key.clone()).or_insert_with(|| {
            let mut b = Bits::new(room);
            b.set(0);
            b
        });
        let previous = bits.clone();
        if month.policy.date_overrides.contains_key(&day.date) {
            *bits = Bits::new(room);
            bits.shifted_or(&previous, cap as usize);
            fixed += cap;
        } else {
            for amount in minimum_additional_work(day).max(1)..=cap {
                bits.shifted_or(&previous, amount as usize);
            }
        }
    }
    let mut maximum = 0;
    for bits in reachable.values() {
        maximum += bits.maximum()? as i64;
    }
    Some((fixed, maximum))
}
