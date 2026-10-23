import {validComputation} from './web/measurement-computation.js';
import {AppError} from './errors.js';
import {revisionText} from './web/revision-model.js';
import {ANALYSIS_CATEGORIES,ANALYSIS_MEMBERSHIPS,ANALYSIS_WINDOWS,analysisTextValue} from './web/analysis-model.js';
import {validateComparisonSourceIdentities} from './analysis-comparison-identities.js';
import {comparisonAccumulator} from './analysis-comparison-accumulator.js';
import {ComparisonIndex} from './analysis-comparison-index.js';
import {DATASET_LIMITS} from './dataset-reader.js';
import {REPRESENTATIONS} from './web/measurement-model.js';
import {MaterialSequence} from './material-sequence.js';
import {withScratch} from './scratch-work.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const same=(a,b)=>revisionText(a)===revisionText(b);
const counts=()=>Object.fromEntries(ANALYSIS_CATEGORIES.map(key=>[key,0]));
const validCounts=value=>exact(value,ANALYSIS_CATEGORIES)&&Object.values(value).every(natural);
// Authenticated observation pages already enforce the retained 1 MiB payload
// bound. Exact margins can exceed input-spelling lengths after cross products.
const rational=value=>value===null||exact(value,['numerator','denominator'])&&typeof value.numerator==='string'&&typeof value.denominator==='string'&&/^(?:0|-?[1-9][0-9]*)$/.test(value.numerator)&&/^[1-9][0-9]*$/.test(value.denominator);
const observationKeys=['source','page','row','id','order','category','exclusion','value','available','unit','representation','radix','exact','run','investigation','calibration','condition','operation','profile','membership','window','windowRelation','evidence','boundary','margin','lower','upper','sequence','before','after','concurrent','denominator','locator'];
function observation(value,comparison){
 if(!exact(value,observationKeys)||!['source','page','row','order'].every(key=>natural(value[key]))||value.source>=comparison.sources.length||!analysisTextValue(value.id,512,true)||!ANALYSIS_CATEGORIES.includes(value.category)||typeof value.available!=='boolean'||!['raw','aggregate'].includes(value.evidence)||!ANALYSIS_MEMBERSHIPS.includes(value.membership)||!ANALYSIS_WINDOWS.includes(value.windowRelation)||!['unknown','below','above','on-boundary','inside'].includes(value.boundary)||!REPRESENTATIONS.includes(value.representation)||!Number.isInteger(value.radix)||value.radix<2||value.radix>36||!rational(value.exact)||!rational(value.margin))fail();
 if(!['exclusion','value','unit','representation','condition','operation','profile','window','lower','upper','sequence','before','after','concurrent','denominator'].every(key=>analysisTextValue(value[key],DATASET_LIMITS.rowChars)))fail();
 const source=comparison.sources[value.source];
 if(!['run','investigation','calibration'].every(key=>same(source[key],value[key]))||!exact(value.locator,['ref','selector'])||!same(value.locator.ref,source.dataset)||!same(value.locator.selector,{kind:'cell',page:value.page,row:value.row,column:source.columns.value}))fail();
}
function verification(value,comparison,sourceRows){
 if(comparison.expected===null){if(value!==null)fail();return;}
 const categories=['correct','mismatched','unavailable','excluded','unmatched'];
 if(!exact(value,['algorithm','version',...categories,'rows','examples','expected','rationale'])||value.algorithm!=='ordered-exact-fixture-comparison'||value.version!==(comparison.version===3?'2':'1')||!categories.every(key=>natural(value[key]))||!natural(value.rows)||categories.reduce((n,key)=>n+value[key],0)!==value.rows||value.rows<sourceRows[comparison.expected.source]||!same(value.expected,comparison.expected.dataset)||value.rationale!==comparison.expected.rationale||!Array.isArray(value.examples)||value.examples.length>20)fail();
 for(const item of value.examples)if(!exact(item,['order','state','actual','expected'])||!Number.isSafeInteger(item.order)||item.order<1||item.order>value.rows||!categories.slice(1).includes(item.state)||![item.actual,item.expected].every(id=>id===null||analysisTextValue(id,512,true)))fail();
}

// This verifies owned result bytes and their internal coverage, not the truth of
// inaccessible input data. Scientific replay remains AnalysisComparisons.verify.
export async function verifyComparisonIntegrity(owner,doc,{signal}={}){
 const content=doc.content,{comparison,summary}=content,command={recordId:doc.recordId,title:doc.title,tool:content.tool,version:content.version,method:content.method,comparison};
 if(![2,3].includes(comparison?.version)||!exact(content,['inputs','tool','version','parameters','method','comparison','summary'])||content.parameters!=='')fail();
 try{await owner.validateOutput(command,{retained:true});}catch(error){if(error.code!=='ANALYSIS_INVALID')throw error;fail();}
 if(!Array.isArray(content.inputs)||!same(content.inputs,owner.references(content.method,comparison)))fail();
 if(!exact(summary,['version','algorithm','algorithmVersion','ordering','rows','raw','aggregate','runs','unknownRunRows','counts','verification','sourceRows','sourceIdentities','index',...(Object.hasOwn(summary??{},'computation')?['computation']:[])])||summary.version!==2||summary.algorithm!=='observanda-exception-comparison'||summary.algorithmVersion!==(comparison.version===3?'4':'3')||summary.ordering!==comparison.ordering||!natural(summary.rows)||!validCounts(summary.raw)||!validCounts(summary.aggregate)||!natural(summary.runs)||!natural(summary.unknownRunRows)||!exact(summary.counts,['groups','distribution','transitions','observations'])||!Object.values(summary.counts).every(natural)||!Array.isArray(summary.sourceRows)||summary.sourceRows.length!==comparison.sources.length||!summary.sourceRows.every(natural)||summary.sourceRows.reduce((a,b)=>a+b,0)!==summary.rows)fail();
 if(Object.hasOwn(summary,'computation')&&(!validComputation(summary.computation)||summary.computation.kind!=='approximate-inputs'))fail();
 validateComparisonSourceIdentities(comparison,summary.sourceIdentities);
 verification(summary.verification,comparison,summary.sourceRows);
 const retained=owner.index(summary),coverage=summary.sourceRows.map(()=>0);let previous=null,rows=0;
 await withScratch(async scratch=>{
  const temporary={readMetadata:async name=>(await scratch.get(name))?.text??null,writeMetadata:(name,text)=>scratch.put(name,{text})},index=new ComparisonIndex(new MaterialSequence(temporary)),expected={...summary,rows:0,raw:counts(),aggregate:counts(),runs:0,unknownRunRows:0,counts:{groups:0,distribution:0,transitions:0,observations:0}};
  delete expected.index;const state={summary:expected,last:null},append=comparisonAccumulator(index,state,comparison);
  for await(const row of retained.items('observations',{signal})){
   signal?.throwIfAborted();observation(row,comparison);
   if(!previous||row.source!==previous.source){if(previous&&row.source<=previous.source||row.page!==0||row.row!==0)fail();}
   else if(row.page===previous.page?row.row!==previous.row+1:row.page!==previous.page+1||row.row!==0)fail();
   coverage[row.source]++;if(coverage[row.source]>summary.sourceRows[row.source])fail();
   await append(row);previous=row;if(++rows%32===0)await index.flush();
  }
  const root=await index.flush();
  if(!same(coverage,summary.sourceRows)||!same({...expected,index:{version:1,root}},summary))fail();
 },{signal});
 // The rebuilt root authenticates every lookup/filter and state pointer. Read
 // remaining owned payloads once; observations were already read above.
 for await(const entry of retained.tree.entries({root:retained.root})){
  signal?.throwIfAborted();
  if(entry.id.startsWith('row/')&&!entry.id.startsWith('row/observations/')){if(!await retained.value(entry,entry.id.split('/')[1]))fail();}
  else if(entry.id.startsWith('state/')&&!await retained.sequences.read('comparison-state',entry.revision))fail();
 }
 return {rows,references:content.inputs.map(ref=>({...ref}))};
}
