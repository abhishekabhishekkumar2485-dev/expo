// Copyright 2025-present 650 Industries. All rights reserved.

import Foundation

// `Date` converts to and from a JavaScript `Date`. Encoding always constructs a `new Date(ms)` from
// the Swift `Date`'s millisecond instant. Decoding accepts three JS shapes, mirroring what a JS
// caller can pass to the `Date` constructor:
//
// - a JS number: interpreted as milliseconds since the Unix epoch (a `Date.prototype.getTime()`
//   value), so `date.getTime()` round-trips,
// - a JS string: parsed by the JS engine's own `Date` constructor,
// - a JS `Date`: the instant is read from `getTime()` (milliseconds since the Unix epoch).
//
// A number is already milliseconds, so it maps straight to `Date(timeIntervalSince1970:)` with no JS
// round-trip. A string is parsed by handing it to the runtime's `new Date(str)` and reading
// `getTime()` back, so string parsing is exactly `new Date(str)` — no separate native date parser to
// maintain, and identical behavior on every platform because the same JS engine parses it. (This
// inherits JS's string-parsing quirks: a string with no timezone is read as local time, and a string
// the engine can't parse yields an `Invalid Date`, i.e. a `NaN` time, which decodes to a thrown error.)
//
// A decoded `Date` is an absolute epoch-relative instant with no timezone or calendar, matching Swift
// `Date`. Resolution is milliseconds (sub-millisecond precision is not representable in a JS `Date`
// and is dropped), and the number branch applies the JS `Date` constructor's TimeClip (truncate toward
// zero, reject a value more than 100,000,000 days from the epoch) so a raw number decodes exactly as
// `new Date(number)` would rather than admitting an instant JS couldn't hold.
//
// `Date` is not in `+Primitives` because it maps to a JS object/number/string rather than a single
// scalar accessor, and reading the instant needs a constructor and/or method call.

extension Date: JavaScriptCodable {
  @JavaScriptActor
  @inlinable
  public static func decode(_ value: borrowing JavaScriptValue, in runtime: borrowing JavaScriptRuntime) throws -> Date
  {
    // Check the cheap tag predicates (`isNumber`/`isString`) before `is("Date")`, which is far more
    // expensive (a global `Date` lookup plus an `instanceof` walk on every call). A number or string
    // can't be a `Date` object anyway, so ordering the cheap checks first is behavior-neutral and keeps
    // the common cases (a timestamp or a date string) off the expensive path.

    // A number is milliseconds since the epoch, mapped across with no JS round-trip. `dateFromMilliseconds`
    // applies the same TimeClip the `Date` constructor does (truncate toward zero, reject out of range),
    // so a raw number decodes to the same instant `new Date(number)` would.
    if value.isNumber() {
      return try dateFromMilliseconds(value.getDouble())
    }
    // A string is parsed by the engine's own `Date` constructor (`new Date(str)`), so every string
    // form `new Date(str)` accepts decodes identically here, on every platform.
    if value.isString() {
      let dateConstructor = try runtime.global().getPropertyAsFunction("Date")
      let constructed = try dateConstructor.callAsConstructor(value.copy()).asObject()
      return try dateFromMilliseconds(constructed.callFunction("getTime").asDouble())
    }
    // An existing JS `Date` already carries the instant, so read it directly without reconstruction.
    if value.is("Date") {
      return try dateFromMilliseconds(value.asObject().callFunction("getTime").asDouble())
    }
    throw InvalidDateException()
  }

  @JavaScriptActor
  @inlinable
  public static func encode(_ value: Date, in runtime: borrowing JavaScriptRuntime) throws -> JavaScriptValue {
    let milliseconds = value.timeIntervalSince1970 * 1000.0
    let dateConstructor = try runtime.global().getPropertyAsFunction("Date")
    // Type the argument explicitly as `JavaScriptValue` so the variadic
    // `callAsConstructor<each T: JavaScriptRepresentable>` overload is selected rather than the
    // `JavaScriptValuesBuffer?` one (a bare `.number(...)` would resolve against the buffer overload).
    let millisecondsValue: JavaScriptValue = .number(milliseconds)
    return try dateConstructor.callAsConstructor(millisecondsValue)
  }
}

/// The largest magnitude, in milliseconds, that a JavaScript `Date` can represent: 100,000,000 days on
/// either side of the epoch (ECMAScript TimeClip). A value beyond this yields an `Invalid Date`.
@usableFromInline
let maxJavaScriptDateMilliseconds: Double = 8_640_000_000_000_000

/// Builds a `Date` from a milliseconds-since-the-epoch value, applying the same TimeClip the JavaScript
/// `Date` constructor does: a non-finite or out-of-range value is an `Invalid Date` (thrown here), and
/// an in-range value is truncated toward zero to whole milliseconds. This keeps the number branch of
/// `decode` faithful to `new Date(number)` without round-tripping through the constructor. The `Date`
/// and string branches feed an already-clipped `getTime()` result through it, where it's a no-op.
@usableFromInline
func dateFromMilliseconds(_ milliseconds: Double) throws -> Date {
  guard milliseconds.isFinite, abs(milliseconds) <= maxJavaScriptDateMilliseconds else {
    throw InvalidDateException()
  }
  let clipped = milliseconds.rounded(.towardZero)
  return Date(timeIntervalSince1970: clipped / 1000.0)
}

/// Thrown when a JavaScript value can't be converted to a `Date`: it is neither a `Date`, a number of
/// milliseconds since the epoch, nor a string the JS `Date` constructor can parse. Named after JS's
/// own "Invalid Date" (the state of a `Date` whose time value is `NaN`), which is what an unparseable
/// number or string produces before it reaches this error.
public struct InvalidDateException: JavaScriptThrowable {
  @usableFromInline
  init() {}

  public var code: String {
    "ERR_INVALID_DATE"
  }
  public var message: String {
    "Cannot convert the JavaScript value to a Date because it is not a Date, a number of milliseconds since the epoch, or a parseable date string"
  }
}
