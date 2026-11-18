use crate::{Result, demo_payload::*};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub const LANDING: &str = "<!doctype html><html lang=\"ko\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>근무 계획 데모</title><style>body{font:16px system-ui;max-width:680px;margin:15vh auto;padding:24px;background:#0b0c0e;color:#eef0f4}a{display:inline-block;margin:12px 8px 0 0;padding:12px 18px;border:1px solid #596070;border-radius:8px;color:#eef0f4;text-decoration:none}</style><main><h1>근무 계획 데모</h1><p>합성 데이터로 동작하는 읽기 전용 데모입니다.</p><a href=\"/demo/\">데모 보기</a><a href=\"/app/\">로그인</a></main></html>";
// Python int accepts signed decimal strings, embedded single underscores, and
// Unicode decimal digits. Saturate only after parsing, so huge valid values
// still clamp to the route bound rather than falling back to its default.
fn query_integer(raw: &str) -> Option<i64> {
    crate::input::int_string(raw).ok()
}
fn number(query: &BTreeMap<&str, &str>, key: &str, default: i64, low: i64, high: i64) -> i64 {
    query
        .get(key)
        .and_then(|s| query_integer(s))
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

#[cfg(test)]
mod tests {
    use super::query_integer;
    #[test]
    fn query_integers_match_python_syntax_and_saturate_before_clamping() {
        assert_eq!(query_integer(" +7_800 "), Some(7800));
        assert_eq!(query_integer("٥٠٠"), Some(500));
        assert_eq!(query_integer("999999999999999999999999"), Some(i64::MAX));
        assert_eq!(query_integer("-999999999999999999999999"), Some(i64::MIN));
        for raw in ["", "1__0", "_600", "600_", "+", "1.0"] {
            assert_eq!(query_integer(raw), None);
        }
    }
}
