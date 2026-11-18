//! Preserve Python int/float/bool operand identity across arithmetic and min/max.
use crate::{Error, Result, input};
use serde_json::Value;
use std::{
    cmp::Ordering,
    ops::{Add, Sub},
};
#[derive(Clone, Copy, Debug)]
pub enum Num {
    Int(i64),
    Float(f64),
    Bool(bool),
}
impl Num {
    pub fn parse(v: &Value) -> Result<Self> {
        match v {
            Value::Bool(b) => Ok(Self::Bool(*b)),
            Value::Number(n) => if n.is_f64() {
                n.as_f64().map(Self::Float)
            } else {
                n.as_i64().map(Self::Int)
            }
            .ok_or_else(|| Error::new("OverflowError", "numeric value out of range")),
            _ => Err(Error::new(
                "TypeError",
                format!("unsupported numeric operand: {}", input::type_name(v)),
            )),
        }
    }
    pub fn f(self) -> f64 {
        match self {
            Self::Int(i) => i as f64,
            Self::Float(f) => f,
            Self::Bool(b) => f64::from(b),
        }
    }
    pub fn max(self, other: impl Into<Self>) -> Self {
        let other = other.into();
        if self >= other { self } else { other }
    }
    pub fn min(self, other: impl Into<Self>) -> Self {
        let other = other.into();
        if self <= other { self } else { other }
    }
    pub fn floor_div(self, denominator: i64) -> Self {
        match self {
            Self::Float(f) => Self::Float((f / denominator as f64).floor()),
            Self::Int(i) => Self::Int(i.div_euclid(denominator)),
            Self::Bool(b) => Self::Int(i64::from(b).div_euclid(denominator)),
        }
    }
    pub fn integer(self) -> Result<i64> {
        match self {
            Self::Int(i) => Ok(i),
            Self::Bool(b) => Ok(i64::from(b)),
            Self::Float(_) => Err(Error::new(
                "TypeError",
                "'float' object cannot be interpreted as an integer",
            )),
        }
    }
    pub fn format_integer(self) -> Result<i64> {
        self.integer()
            .map_err(|_| Error::value("Unknown format code 'd' for object of type 'float'"))
    }
}
impl From<i64> for Num {
    fn from(n: i64) -> Self {
        Self::Int(n)
    }
}
impl PartialEq for Num {
    fn eq(&self, other: &Self) -> bool {
        self.f() == other.f()
    }
}
impl PartialOrd for Num {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        self.f().partial_cmp(&other.f())
    }
}
impl PartialEq<i64> for Num {
    fn eq(&self, other: &i64) -> bool {
        self.f() == *other as f64
    }
}
impl PartialOrd<i64> for Num {
    fn partial_cmp(&self, other: &i64) -> Option<Ordering> {
        self.f().partial_cmp(&(*other as f64))
    }
}
macro_rules! arithmetic {
    ($trait:ident,$method:ident,$op:tt)=>{
        impl $trait for Num {
            type Output = Self;
            fn $method(self, other: Self) -> Self {
                match (self, other) {
                    (Self::Float(a), b) => Self::Float(a $op b.f()),
                    (a, Self::Float(b)) => Self::Float(a.f() $op b),
                    (Self::Int(a), Self::Int(b)) => Self::Int(a $op b),
                    (Self::Int(a), Self::Bool(b)) => Self::Int(a $op i64::from(b)),
                    (Self::Bool(a), Self::Int(b)) => Self::Int(i64::from(a) $op b),
                    (Self::Bool(a), Self::Bool(b)) => Self::Int(i64::from(a) $op i64::from(b)),
                }
            }
        }
        impl $trait<i64> for Num{type Output=Self;fn $method(self,other:i64)->Self{self $op Self::Int(other)}}
    }
}
arithmetic!(Add,add,+);
arithmetic!(Sub,sub,-);
impl serde::Serialize for Num {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        match self {
            Self::Int(i) => serializer.serialize_i64(*i),
            Self::Float(f) => serializer.serialize_f64(*f),
            Self::Bool(b) => serializer.serialize_bool(*b),
        }
    }
}
