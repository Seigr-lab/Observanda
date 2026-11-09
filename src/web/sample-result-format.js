import {validNumeralContext} from './numeral-context.js';
import {defaultDatasetResourcePolicy} from './dataset-resource-policy.js';

export const sampleScalarFields = ['value', 'lower', 'upper'];
export const sampleScalarLimit = defaultDatasetResourcePolicy().resources.maxScalarCharacters;
export const sampleScalarText = value => String(value?.spelling ?? value ?? '');
export const historicalSampleNumber = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e15;

export function displaySampleScalar(value, translate) {
  if (value === null) return '—';
  const spelling = sampleScalarText(value);
  if (typeof value === 'number') return translate('shownHistorical', {value: spelling});
  if (!value || typeof value !== 'object') return spelling;
  const formatted = ['radix','radix-fraction'].includes(value.representation)
    ? translate('shownBase', {value: spelling, base: value.radix}) : spelling;
  return value.precision === 'approximate' ? translate('shownApproximate', {value: formatted}) : formatted;
}

export function validSampleScalar(scalar) {
  return !!scalar && typeof scalar === 'object' && Object.keys(scalar).length === 4 &&
    ['spelling', 'representation', 'radix', 'precision'].every(key => Object.hasOwn(scalar, key)) &&
    typeof scalar.spelling === 'string' && scalar.spelling.length > 0 && scalar.spelling.length <= sampleScalarLimit &&
    ['exact', 'approximate'].includes(scalar.precision) &&
    validNumeralContext({version: 1, representation: scalar.representation, radix: scalar.radix});
}

export function sampleResultSummary(result) {
  // Summary hashes in older catalogues preserve the stored field order.
  const {notes,provenance,...summary}=result;
  return summary;
}
