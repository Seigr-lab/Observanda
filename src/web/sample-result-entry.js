import {sampleInterval} from './sample-result-numerics.js';
import {sampleScalarFields, sampleScalarText, sampleScalarLimit} from './sample-result-format.js';
import {NUMBER_REPRESENTATIONS, numeralUsesRadix} from './numeral-context.js';

const fieldLabel = key => key === 'value' ? 'resultValue' : key;
const formatLabel = {decimal: 'decimal', integer: 'integer', radix: 'baseInteger', 'radix-fraction': 'baseFraction', rational: 'fraction'};

export function sampleNumericFields(result, {esc, field, option, tr}) {
  return sampleScalarFields.map(key => {
    const scalar = result[key], historical = typeof scalar === 'number';
    const notation = scalar?.representation ?? 'decimal', policy = scalar?.precision ?? (historical ? 'historical' : 'exact');
    const label = tr(fieldLabel(key));
    return `<div data-lab-scalar="${key}" ${result.kind === 'text' && key !== 'value' ? 'hidden' : ''}>
      ${field(esc(label), `<input name="${key}" maxlength="${result.kind==='text'?500:sampleScalarLimit}" ${key === 'value' ? 'required' : ''} value="${esc(sampleScalarText(scalar))}">`)}
      <details data-lab-format ${result.kind === 'text' ? 'hidden' : ''}><summary>${esc(tr('formatFor',{field:label}))}</summary>
      ${field(esc(tr('numberFormat')), `<select name="${key}Representation">${NUMBER_REPRESENTATIONS.map(rep=>option(rep,tr(formatLabel[rep]),notation)).join('')}</select>`)}
      <div data-lab-base ${numeralUsesRadix(notation) ? '' : 'hidden'}>${field(esc(tr('base')), `<input name="${key}Radix" type="number" min="2" max="36" step="1" value="${Number(scalar?.radix ?? 10)}" ${numeralUsesRadix(notation) ? 'required' : 'disabled'}>`)}</div>
      ${field(esc(tr('precision')),`<select name="${key}Precision">${historical ? option('historical',tr('historical'),policy) : ''}${option('exact',tr('exact'),policy)}${option('approximate',tr('approximate'),policy)}</select>`)}
      </details>${historical ? `<small>${esc(tr('historicalHelp'))}</small>` : ''}</div>`;
  }).join('');
}

export function updateSampleNumericFields(input) {
  const form = input.form;
  if (!form || !['lab-result-form','lab-analysis-form'].includes(form.id)) return;
  const numeric = form.elements.kind.value === 'numeric';
  form.elements.unit.setCustomValidity('');
  for (const key of sampleScalarFields) {
    const group = form.querySelector(`[data-lab-scalar="${key}"]`);
    const visible = numeric || key === 'value';
    form.elements[key].maxLength=numeric?sampleScalarLimit:500;
    group.hidden = !visible;
    const format = group.querySelector('[data-lab-format]');
    format.hidden = !numeric;
    const usesBase = numeric && numeralUsesRadix(form.elements[key+'Representation'].value);
    group.querySelector('[data-lab-base]').hidden = !usesBase;
    form.elements[key+'Radix'].disabled = !usesBase || (key === 'value' && form.elements.value.readOnly);
    form.elements[key+'Radix'].required = usesBase;
    form.elements[key].setCustomValidity('');
  }
}

export function readSampleResult(form, previous, tr) {
  const data = new FormData(form), kind = form.elements.kind.value;
  const result = {method: data.get('method').trim(), analyte: data.get('analyte').trim(), kind,
    value: data.get('value'), unit: data.get('unit').trim(), lower: null, upper: null, notes: data.get('notes').trim()};
  const provenance=JSON.parse(form.elements.provenance.value);
  if (Object.keys(provenance).length) result.provenance=provenance;
  if (provenance.reading) result.unit=form.elements.unit.value;
  if (kind !== 'numeric') return result;
  result.numericVersion = 2;
  for (const key of sampleScalarFields) {
    const spelling = data.get(key);
    if (spelling === '' && key !== 'value') continue;
    const representation = form.elements[key+'Representation'].value, precision = form.elements[key+'Precision'].value;
    const radix = numeralUsesRadix(representation) ? Number(form.elements[key+'Radix'].value) : 10;
    if (precision === 'historical' && typeof previous?.[key] === 'number' &&
        sampleScalarText(previous[key]) === spelling && representation === 'decimal') {
      result[key] = previous[key];
    } else {
      result[key] = {spelling, representation, radix, precision: precision === 'historical' ? 'approximate' : precision};
    }
  }
  if (previous?.numericVersion === undefined && typeof previous?.value === 'number' &&
      sampleScalarFields.every(key=>result[key] === previous[key])) delete result.numericVersion;
  const issue = sampleInterval(result);
  const invalid = !result.unit && !provenance.reading ? {field:'unit',issue:'unitRequired'} : issue;
  if (invalid.issue) {
    const input = form.elements[invalid.field];
    input.setCustomValidity(tr(invalid.issue));
    input.reportValidity();
    return null;
  }
  return result;
}
