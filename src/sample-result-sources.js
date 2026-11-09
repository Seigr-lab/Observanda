import {AppError} from './errors.js';
import {createHash} from 'node:crypto';
import {ResearchMaterials} from './research-materials.js';
import {materialReferenceKey} from './web/material-reference.js';
import {hasApproximateComputation} from './web/measurement-computation.js';
import {validSampleSource, validSampleSources} from './web/sample-result-references.js';
import {sampleInterval} from './web/sample-result-numerics.js';
import {sampleScalarLimit} from './web/sample-result-format.js';

const invalid = () => { throw new AppError('LAB_INVALID'); };

export async function resolveSampleSource(workspace, role, source, {signal} = {}) {
  if (!validSampleSource(role,source)) invalid();
  signal?.throwIfAborted();
  const {ref,cell} = source, materials = new ResearchMaterials(workspace);
  if (role !== 'reading') {
    const {items:[item]}=await materials.describeReferences({items:[ref]});
    if(item.unavailable)throw new AppError('MATERIAL_MISSING');
    return {title:item.title};
  }
  let title, value, approximate, policy;
  if (cell) {
    const reading = await materials.measurements.cell({ref, selector:{kind:'cell',...cell}});
    if (reading.row.excluded) invalid();
    title = reading.doc.title;
    value = {...reading.value,spelling:reading.cellReference??reading.value.spelling};
    policy=reading.column.resourcePolicy;
    approximate = hasApproximateComputation(reading.column);
  } else {
    const doc = await materials.read(ref);
    title = doc.title;
    const measurement = doc.content.measurement;
    value = measurement?.value;
    policy=measurement?.resourcePolicy;
    approximate = hasApproximateComputation(measurement);
  }
  if (value?.presence !== 'value') invalid();
  let spelling=value.spelling;
  if(typeof spelling!=='string'){
    if(!policy||spelling?.format!=='dataset-cell')throw new AppError('DATASET_CELL_SCALAR_REQUIRED');
    if(spelling.characters>Math.min(sampleScalarLimit,policy.resources.maxScalarCharacters))throw new AppError('DATASET_CALCULATION_RESOURCE');
    const {text,total,next}=await materials.readDatasetCell(spelling,{limit:sampleScalarLimit,signal});
    if(next!==null||total!==spelling.characters||createHash('sha256').update(Buffer.from(text,'utf16le')).digest('hex')!==spelling.sha256)throw new AppError('MATERIAL_MISSING');
    spelling=text;
  }
  const scalar = {spelling,representation:value.representation,radix:value.radix,precision:approximate?'approximate':'exact'};
  if (sampleInterval({kind:'numeric',numericVersion:2,value:scalar,lower:null,upper:null}).issue ||
      typeof value.unit !== 'string' || value.unit.length > 80) invalid();
  return {title, value:scalar, unit:value.unit};
}

export async function verifySampleResultSources(workspace, result, options) {
  if (!result || result.provenance === undefined) return;
  if (!validSampleSources(result.provenance)) invalid();
  const {reading,...references}=result.provenance,checked=new Set();
  if(reading){
    const resolved=await resolveSampleSource(workspace,'reading',reading,options);
    if(result.kind!=='numeric' || result.unit!==resolved.unit ||
       Object.keys(resolved.value).some(key=>resolved.value[key]!==result.value?.[key]))invalid();
    checked.add(materialReferenceKey(reading.ref));
  }
  for (const [role,source] of Object.entries(references)) {
    const key=materialReferenceKey(source.ref);
    if(!checked.has(key))await resolveSampleSource(workspace,role,source,options);
    checked.add(key);
  }
}
