//! Python-compatible boundary operations. No unchecked casts or silent coercion.
use crate::{Error, Result};
use serde_json::{Map, Value};

pub const MAX_MINUTES: i64 = 10_000_000;
pub const MAX_DAYS: usize = 366;
pub fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Null => "NoneType",
        Value::Bool(_) => "bool",
        Value::String(_) => "str",
        Value::Array(_) => "list",
        Value::Object(_) => "dict",
        Value::Number(n) => {
            if n.is_f64() {
                "float"
            } else {
                "int"
            }
        }
    }
}
pub fn get<'a>(v: &'a Value, key: &str) -> Result<Option<&'a Value>> {
    v.as_object().map(|o| o.get(key)).ok_or_else(|| {
        Error::new(
            "AttributeError",
            format!("'{}' object has no attribute 'get'", type_name(v)),
        )
    })
}
pub fn item<'a>(v: &'a Value, key: &str) -> Result<&'a Value> {
    let o = v.as_object().ok_or_else(|| {
        Error::new(
            "TypeError",
            format!("'{}' object is not subscriptable", type_name(v)),
        )
    })?;
    o.get(key)
        .ok_or_else(|| Error::new("KeyError", format!("'{key}'")))
}
pub fn array(v: &Value) -> Result<&[Value]> {
    // Empty dicts and strings are valid empty Python iterables. Nonempty
    // versions would yield non-row elements and fail the row subscription.
    if matches!(v, Value::Object(o) if o.is_empty())
        || matches!(v, Value::String(s) if s.is_empty())
    {
        return Ok(&[]);
    }
    v.as_array().map(Vec::as_slice).ok_or_else(|| {
        Error::new(
            "TypeError",
            format!("'{}' object is not iterable", type_name(v)),
        )
    })
}
pub fn object(v: &Value) -> Result<&Map<String, Value>> {
    v.as_object().ok_or_else(|| {
        Error::new(
            "TypeError",
            format!("'{}' object is not a mapping", type_name(v)),
        )
    })
}
pub fn string(v: &Value) -> Result<&str> {
    v.as_str().ok_or_else(|| {
        Error::new(
            "TypeError",
            format!("argument must be str, not {}", type_name(v)),
        )
    })
}
pub fn dictionary(v: &Value) -> Result<Map<String, Value>> {
    if !crate::model::truthy(v) {
        return Ok(Map::new());
    }
    if let Value::Object(o) = v {
        return Ok(o.clone());
    }
    if v.is_string() {
        return Err(Error::value(
            "dictionary update sequence element has length other than 2",
        ));
    }
    let entries = array(v)?;
    let mut result = Map::new();
    for entry in entries {
        let pair = array(entry)?;
        if pair.len() != 2 {
            return Err(Error::value(
                "dictionary update sequence element has length other than 2",
            ));
        }
        let key = match &pair[0] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => {
                if *b {
                    "True".into()
                } else {
                    "False".into()
                }
            }
            Value::Null => "None".into(),
            _ => return Err(Error::new("TypeError", "unhashable type")),
        };
        result.insert(key, pair[1].clone());
    }
    Ok(result)
}
pub fn minute_limit(v: &Value) -> Result<()> {
    if let Value::Number(n) = v {
        let f = n.as_f64().unwrap_or(f64::INFINITY);
        if !f.is_finite() || f.abs() > MAX_MINUTES as f64 {
            return Err(Error::value(format!(
                "minute quantities must be finite and within +/-{MAX_MINUTES}"
            )));
        }
    }
    Ok(())
}
pub fn validate_limits(v: &Value) -> Result<()> {
    validate(v, false)
}
fn validate(v: &Value, minute: bool) -> Result<()> {
    if minute {
        minute_limit(v)?;
    }
    match v {
        Value::Object(o) => {
            for (k, v) in o {
                if k == "days" && v.as_array().is_some_and(|a| a.len() > MAX_DAYS) {
                    return Err(Error::value(format!(
                        "days must contain at most {MAX_DAYS} entries"
                    )));
                }
                let minute = minute
                    || k.as_bytes()
                        .windows(6)
                        .any(|part| part.eq_ignore_ascii_case(b"minute"))
                    || matches!(
                        k.as_str(),
                        "dateOverrides"
                            | "weekdayCaps"
                            | "target"
                            | "normal"
                            | "long"
                            | "short"
                            | "additional"
                            | "daily_cap"
                            | "gap_minutes"
                    );
                validate(v, minute)?;
            }
        }
        Value::Array(a) => {
            for v in a {
                validate(v, minute)?;
            }
        }
        _ => {}
    }
    Ok(())
}
// Zero codepoints for Unicode decimal digit blocks accepted by int(str).
const ZEROES: &[u32] = &[
    0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66,
    0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90,
    0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10,
    0x104a0, 0x10d30, 0x10d40, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0,
    0x11650, 0x116c0, 0x116d0, 0x116da, 0x11730, 0x118e0, 0x11950, 0x11bf0, 0x11c50, 0x11d50,
    0x11da0, 0x11f50, 0x16130, 0x16a60, 0x16ac0, 0x16b50, 0x16d70, 0x1ccf0, 0x1d7ce, 0x1d7d8,
    0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140, 0x1e2f0, 0x1e4f0, 0x1e5f1, 0x1e950, 0x1fbf0,
];
pub fn decimal(ch: char) -> Option<u32> {
    if ch.is_ascii_digit() {
        return Some(u32::from(ch) - u32::from('0'));
    }
    let code = u32::from(ch);
    ZEROES
        .iter()
        .rfind(|&&z| code >= z && code - z < 10)
        .map(|z| code - z)
}
pub fn int_string(raw: &str) -> Result<i64> {
    let fail = || {
        Error::value(format!(
            "invalid literal for int() with base 10: {}",
            repr(raw)
        ))
    };
    let text = raw.trim();
    let negative = text.starts_with('-');
    let text = text.strip_prefix(['+', '-']).unwrap_or(text);
    let mut value = 0i64;
    let mut after_digit = false;
    let mut digits = 0;
    for ch in text.chars() {
        if ch == '_' && after_digit {
            after_digit = false;
            continue;
        }
        let digit = i64::from(decimal(ch).ok_or_else(fail)?);
        value = if negative {
            value.saturating_mul(10).saturating_sub(digit)
        } else {
            value.saturating_mul(10).saturating_add(digit)
        };
        after_digit = true;
        digits += 1;
    }
    if !after_digit {
        return Err(fail());
    }
    if digits > 4300 {
        return Err(Error::value(
            "Exceeds the limit (4300 digits) for integer string conversion",
        ));
    }
    Ok(value)
}
pub fn py_int(v: &Value) -> Result<i64> {
    match v {
        Value::Bool(b) => Ok(i64::from(*b)),
        Value::String(s) => int_string(s),
        Value::Number(n) => {
            if let Some(n) = n.as_i64() {
                return Ok(n);
            }
            let f = n
                .as_f64()
                .ok_or_else(|| Error::new("OverflowError", "integer out of range"))?;
            if f.is_nan() {
                return Err(Error::value("cannot convert float NaN to integer"));
            }
            if !f.is_finite() {
                return Err(Error::new(
                    "OverflowError",
                    "cannot convert float infinity to integer",
                ));
            }
            // Saturation is intentional: consumers clamp route values or enforce
            // the shared minute bound before any arithmetic.
            Ok(f.trunc() as i64)
        }
        _ => Err(Error::new(
            "TypeError",
            format!(
                "int() argument must be a string, a bytes-like object or a real number, not '{}'",
                type_name(v)
            ),
        )),
    }
}
pub fn repr(raw: &str) -> String {
    let quote = if raw.contains('\'') && !raw.contains('"') {
        '"'
    } else {
        '\''
    };
    let mut out = String::new();
    out.push(quote);
    for ch in raw.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c == quote => {
                out.push('\\');
                out.push(c);
            }
            c => out.push(c),
        }
    }
    out.push(quote);
    out
}
/// Arithmetic minute values are not coerced: Python sums strings with integers
/// as a TypeError, and normalized planner minutes reject float results.
pub fn arithmetic_int(v: &Value) -> Result<i64> {
    if let Some(n) = v.as_i64() {
        return Ok(n);
    }
    if let Some(b) = v.as_bool() {
        return Ok(i64::from(b));
    }
    if v.is_f64() {
        return Err(Error::value("minutes must be a non-negative integer"));
    }
    Err(Error::new(
        "TypeError",
        format!("unsupported operand type: {}", type_name(v)),
    ))
}

/// Python 3.11 is the native API baseline. The transport feature-detects later
/// standard-library ISO syntax changes instead of guessing from version text.
#[derive(Clone, Copy)]
pub struct IsoCompatibility {
    pub midnight_24: bool,
    pub short_fraction: bool,
}
impl Default for IsoCompatibility {
    fn default() -> Self {
        Self {
            midnight_24: false,
            short_fraction: true,
        }
    }
}
#[derive(Clone, Copy)]
pub struct IsoTime {
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub microsecond: u32,
    pub offset_microseconds: Option<i64>,
}
fn time_components(
    raw: &str,
    offset: bool,
    compatibility: IsoCompatibility,
) -> Result<(u32, u32, u32, u32)> {
    let fail = || Error::value(format!("Invalid isoformat string: {}", repr(raw)));
    let (base, fraction) = raw
        .split_once(['.', ','])
        .map_or((raw, None), |(a, b)| (a, Some(b)));
    let mut digits = [0u32; 3];
    if base.contains(':') {
        for (i, part) in base.split(':').enumerate() {
            if i >= 3 || part.len() != 2 || !part.bytes().all(|b| b.is_ascii_digit()) {
                return Err(fail());
            }
            digits[i] = part.parse().map_err(|_| fail())?;
        }
    } else {
        if !matches!(base.len(), 2 | 4 | 6) || !base.bytes().all(|b| b.is_ascii_digit()) {
            return Err(fail());
        }
        for (i, part) in base.as_bytes().chunks_exact(2).enumerate() {
            digits[i] = u32::from(part[0] - b'0') * 10 + u32::from(part[1] - b'0');
        }
    }
    let mut microsecond = 0;
    if let Some(fraction) = fraction {
        if !(compatibility.short_fraction || base.len() == 8 || base.len() == 6)
            || fraction.is_empty()
            || !fraction.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(fail());
        }
        for (i, b) in fraction.bytes().take(6).enumerate() {
            microsecond += u32::from(b - b'0') * 10u32.pow(5 - i as u32);
        }
    }
    if compatibility.midnight_24 && !offset && digits == [24, 0, 0] && microsecond == 0 {
        digits[0] = 0;
    }
    if !offset && (digits[0] > 23 || digits[1] > 59 || digits[2] > 59) {
        return Err(fail());
    }
    Ok((digits[0], digits[1], digits[2], microsecond))
}
pub fn iso_time(v: &Value) -> Result<IsoTime> {
    iso_time_with_compat(v, IsoCompatibility::default())
}
pub fn iso_time_with_compat(v: &Value, compatibility: IsoCompatibility) -> Result<IsoTime> {
    let raw = string(v)?;
    let value = raw.strip_prefix('T').unwrap_or(raw);
    let (base, zone) = if let Some(i) = value.find(['+', '-', 'Z']) {
        value.split_at(i)
    } else {
        (value, "")
    };
    let (hour, minute, second, microsecond) = time_components(base, false, compatibility)?;
    let offset_microseconds = if zone.is_empty() {
        None
    } else if zone == "Z" {
        Some(0)
    } else {
        let sign = if zone.starts_with('-') { -1 } else { 1 };
        let body = zone
            .get(1..)
            .ok_or_else(|| Error::value("invalid timezone offset"))?;
        let (h, m, s, u) = time_components(body, true, compatibility)?;
        let offset =
            (i64::from(h) * 3600 + i64::from(m) * 60 + i64::from(s)) * 1_000_000 + i64::from(u);
        if offset >= 86_400_000_000 {
            return Err(Error::value("offset must be strictly between -24h and 24h"));
        }
        Some(sign * offset)
    };
    Ok(IsoTime {
        hour,
        minute,
        second,
        microsecond,
        offset_microseconds,
    })
}
