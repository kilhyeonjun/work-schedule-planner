use crate::{Result, demo_payload::*};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const LANDING: &str = "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>근무 계획 데모</title><style>body{font:16px system-ui;max-width:680px;margin:15vh auto;padding:24px;background:#0b0c0e;color:#eef0f4}a{display:inline-block;margin:12px 8px 0 0;padding:12px 18px;border:1px solid #596070;border-radius:8px;color:#eef0f4;text-decoration:none}</style><main><h1>근무 계획 데모</h1><p>합성 데이터로 동작하는 읽기 전용 데모입니다.</p><a href=\"/demo/\">데모 보기</a><a href=\"/app/\">로그인</a></main></html>";
fn number(query: &BTreeMap<&str, &str>, key: &str, default: i64, low: i64, high: i64) -> i64 {
    query
        .get(key)
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(default)
        .clamp(low, high)
}
pub fn route(method: &str, path: &str, raw: &str) -> Result<Value> {
    if method != "GET" {
        return Ok(
            json!([405,{"Content-Type":"text/plain; charset=utf-8","Allow":"GET"},"Method Not Allowed"]),
        );
    }
    if path == "/" {
        return Ok(json!([200,{"Content-Type":"text/html; charset=utf-8"},LANDING]));
    }
    if path == "/demo/api/archive" {
        return Ok(
            json!([200,{"Content-Type":"application/json; charset=utf-8"},archive_payload()?]),
        );
    }
    if path == "/demo/api/month" {
        let mut query = BTreeMap::new();
        for item in raw.split('&') {
            if let Some((k, v)) = item.split_once('=') {
                query.entry(k).or_insert(v);
            }
        }
        let year = number(&query, "year", 2042, 2041, 2042) as i32;
        let month = number(&query, "month", 3, 1, 12) as u32;
        let (year, month) = (year, month).min((2042, 3));
        let target = number(
            &query,
            "target",
            7800,
            60,
            9000.max(nine_hour_target_minutes(year, month)?),
        );
        let normal = number(&query, "normal", 500, 285, 719);
        let long = number(&query, "long", 719, normal, 719);
        let short = number(&query, "short", 285, 285, normal);
        return Ok(
            json!([200,{"Content-Type":"application/json; charset=utf-8"},month_payload(year,month,target,normal,long,short,None)?]),
        );
    }
    Ok(json!([404,{"Content-Type":"text/plain; charset=utf-8"},"Not Found"]))
}
