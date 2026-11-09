import {exactRational} from './measurement-rational.js';
import {rationalCompare} from './analysis-model.js';
import {binary64Rational} from './measurement-transform.js';
import {sampleScalarFields, historicalSampleNumber, validSampleScalar} from './sample-result-format.js';

// Version-one records retain their original binary64 values and review digests.
// Compare that stored binary value exactly when it meets a newly authored bound.
function scalarRational(scalar) {
  if (historicalSampleNumber(scalar)) return binary64Rational(scalar);
  if (!validSampleScalar(scalar)) throw RangeError('sampleScalar');
  return exactRational(scalar.spelling, scalar.representation, scalar.radix);
}

export function sampleInterval(result) {
  if (result.kind !== 'numeric') return {flag: 'noInterval'};
  const values = {};
  for (const field of sampleScalarFields) {
    if (field !== 'value' && result[field] === null) continue;
    try {
      if (result.numericVersion === undefined && !historicalSampleNumber(result[field])) throw RangeError('historical');
      if (result.numericVersion !== undefined && result.numericVersion !== 2) throw RangeError('version');
      values[field] = scalarRational(result[field]);
    } catch { return {issue: 'invalidScalar', field}; }
  }
  const {value, lower, upper} = values;
  if (lower && upper && rationalCompare(lower, upper) > 0) return {issue: 'invalidBounds', field: 'upper'};
  if (lower && rationalCompare(value, lower) < 0) return {flag: 'below'};
  if (upper && rationalCompare(value, upper) > 0) return {flag: 'above'};
  return {flag: lower || upper ? 'within' : 'noInterval'};
}
