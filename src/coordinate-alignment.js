import {publicCoordinateAlignmentContext,publicCoordinateAlignmentReceipt} from './web/coordinate-alignment-context.js';
// Coordinate selection reuses graph-owned immutable sequences and encrypted work.
// Context is a schema capability; actual decisions never change payload arithmetic.
import {AppError} from './errors.js';
import {CoordinateAlignmentError} from './coordinate-alignment-kernel.js';
import {CalculationLineage} from './calculation-lineage.js';
import {DatasetResourceBudget,numericalOperation} from './dataset-resource-budget.js';
import {digest} from './storage-format.js';
import {revisionText} from './web/revision-model.js';
import {materialReference,materialReferenceKey,validMaterialReference} from './web/material-reference.js';
import {validGraphAddress} from './web/dataset-calculation-graph-model.js';
import {isScalarRepresentation,validLocator} from './web/measurement-model.js';
import {defaultDatasetResourcePolicy} from './web/dataset-resource-policy.js';
import {validCellComputation,resolveCellComputation,effectiveCellColumn} from './web/measurement-computation.js';
import {validatePolicyScalar,isScalarResourceFailure,withScalarPolicy} from './web/measurement-scalar-policy.js';
import {blankUnitDefinition,validateUnitDefinition,unitScalar,sameUnitDimensions,multiplyUnitRational,divideUnitRational} from './web/measurement-unit-model.js';
import {addPlotRational,plotRationalText} from './web/plot-resource-policy.js';
import {resolveScalarDefinitions,resolveScalarOperand,retainScalarDefinitions} from './measurement-scalar-storage.js';
import {COORDINATE_ALIGNMENT_METHOD,isCoordinateAlignment,validCoordinateAlignmentContext,validCoordinateAlignmentReceipt,validCoordinateAlignmentColumn,validCoordinateAlignmentCell,validCoordinateAlignmentMeasurement,validCoordinateAlignmentIndex,validCoordinateAlignmentAxis} from './web/coordinate-alignment-model.js';
const fail=(code='DATASET_ALIGNMENT_INVALID')=>{if(code.startsWith('DATASET_ALIGNMENT_'))throw new CoordinateAlignmentError(code);throw new AppError(code);};
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export const alignmentIdentity=value=>materialReferenceKey(value.graph)+':'+String(value.binding.position).padStart(16,'0')+':'+value.binding.id;
const validDecision=value=>exact(value,['graph','binding','receipt'])&&validMaterialReference(value.graph)&&value.graph.kind==='analysis'&&validGraphAddress(value.binding)&&exact(value.receipt,['version','status','delta','tieCount','decisionComputation','evidenceIndex'])&&validCoordinateAlignmentIndex(value.receipt.evidenceIndex,'coordinate-alignment-evidence');
export const alignmentContextSet=(materials,write)=>new CalculationLineage(materials.sequences,write,{kind:'coordinate-alignment-contexts',valid:validCoordinateAlignmentContext,key:alignmentIdentity});
export const alignmentDecisionSet=(materials,write)=>new CalculationLineage(materials.sequences,write,{kind:'coordinate-alignment-decisions',valid:validDecision,key:value=>alignmentIdentity(value)+':receipt:'+digest(revisionText(value.receipt))});
export const alignmentGraphReference=doc=>doc.graphReference??{kind:doc.kind,id:doc.id,revision:doc.revision??digest(revisionText(doc)),...(doc.workspaceId?{workspaceId:doc.workspaceId}:{})};
export function alignmentContext(binding,position,graph,resourcePolicy){
 const {direction,tolerance,toleranceUnit,ties,missing,excluded}=binding.match.coordinate;
 return {version:1,method:COORDINATE_ALIGNMENT_METHOD,graph,binding:{id:binding.id,position},direction,tolerance,toleranceUnit,ties,missing,excluded,unmatched:binding.match.unmatched,partitionKeys:binding.match.keysIndex.count,resourcePolicy};
}
export async function unionAlignmentContexts(materials,values,{write,signal}={}){const set=alignmentContextSet(materials,write);let result=set.ref();for(const value of values){signal?.throwIfAborted();if(value){if(!validCoordinateAlignmentColumn(value))fail('MATERIAL_MISSING');result=await set.union(result,value.contextsIndex);}}return {version:1,contextsIndex:result};}
export async function unionAlignmentDecisions(materials,values,{write,signal}={}){const set=alignmentDecisionSet(materials,write);let result=set.ref();for(const value of values){signal?.throwIfAborted();if(value){if(!validCoordinateAlignmentCell(value))fail('MATERIAL_MISSING');result=await set.union(result,value.decisionsIndex);}}return {version:1,decisionsIndex:result};}
const encode=value=>({numerator:String(value.numerator),denominator:String(value.denominator)});
const decode=value=>({numerator:BigInt(value.numerator),denominator:BigInt(value.denominator)});
const temporal=column=>({kind:column.time?.kind??'none',reference:column.time?.reference??'',clock:column.time?.clock??null,frame:column.coordinateFrame?.frame??null,axis:column.coordinateAxis??null});
export async function compileCoordinateAlignment(materials,binding,leftColumn,rightColumn,policy,{signal,budget=new DatasetResourceBudget(policy)}={}){
 if(!isCoordinateAlignment(binding.match)||!isScalarRepresentation(leftColumn)||!isScalarRepresentation(rightColumn))fail();
 const declared=await resolveScalarDefinitions(materials,{...binding,resourcePolicy:policy},{signal,budget}),coordinate=declared.match.coordinate;
 if(revisionText(temporal(leftColumn))!==revisionText(temporal(rightColumn)))fail('DATASET_ALIGNMENT_CONTEXT');
 try{return numericalOperation(budget,b=>{
  if(!!leftColumn.quantity?.unitDefinition!==!!rightColumn.quantity?.unitDefinition)fail('DATASET_ALIGNMENT_CONTEXT');const units=[leftColumn,rightColumn].map(column=>{if(!column.quantity?.unitDefinition&&column.unit)fail('DATASET_ALIGNMENT_CONTEXT');const definition=column.quantity?.unitDefinition??blankUnitDefinition();validateUnitDefinition(definition,{budget:b});return {definition,scale:encode(unitScalar(definition.scale,b,definition.resourcePolicy)),offset:encode(unitScalar(definition.offset,b,definition.resourcePolicy))};}),toleranceUnit=coordinate.toleranceUnit;
  validateUnitDefinition(toleranceUnit,{budget:b});if(units[0].definition.kind!==units[1].definition.kind||!sameUnitDimensions(units[0].definition,units[1].definition)||!sameUnitDimensions(units[0].definition,toleranceUnit)||toleranceUnit.kind!=='difference')fail('DATASET_ALIGNMENT_CONTEXT');
  const tolerance=validatePolicyScalar(coordinate.tolerance,policy,{budget:b}),toleranceScale=unitScalar(toleranceUnit.scale,b,toleranceUnit.resourcePolicy);if(tolerance.numerator<0n)fail();return {leftColumn,rightColumn,units,toleranceDefinition:toleranceUnit,toleranceScale:encode(toleranceScale),tolerance:encode(multiplyUnitRational(tolerance,toleranceScale,b))};
 });}catch(error){if(error instanceof AppError||error instanceof CoordinateAlignmentError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail('DATASET_ALIGNMENT_CONTEXT');}
}
export async function alignmentCoordinate(materials,cell,column,unit,policy,{signal,budget=new DatasetResourceBudget(policy)}={}){
 const computation=resolveCellComputation(column,cell);if(['absent','null'].includes(cell.kind)||typeof cell.value==='string'&&column.missing.some(item=>item.value===cell.value))return null;
 const actual=effectiveCellColumn(column,cell),resolved=await resolveScalarOperand(materials,cell,actual,{signal,budget,policy});
 try{return {value:numericalOperation(budget,b=>{const value=validatePolicyScalar({spelling:resolved.value,representation:column.representation,radix:column.radix},column.resourcePolicy??defaultDatasetResourcePolicy(),{budget:b});const convert=owner=>addPlotRational(multiplyUnitRational(value,decode(unit.scale),owner),decode(unit.offset),owner);return unit.definition.version===2?withScalarPolicy(unit.definition.resourcePolicy,b,convert):convert(b);}),computation};}catch(error){if(error instanceof AppError||error instanceof CoordinateAlignmentError||isScalarResourceFailure(error)||error.name==='AbortError')throw error;fail();}
}
export async function retainAlignmentReceipt(materials,result,binding,compiled,policy,{write=fn=>fn(),signal,budget=new DatasetResourceBudget(policy)}={}){
 const evidence=materials.sequences.builder('coordinate-alignment-evidence',write);for(const entry of result.evidence){signal?.throwIfAborted();await evidence.append({ordinal:entry.ordinal,source:{ref:binding.source,selector:{kind:'cell',page:entry.location.page,row:entry.location.row,column:binding.match.coordinate.right}},computation:entry.computation});}
 const delta=result.delta===null?null:numericalOperation(budget,b=>({spelling:plotRationalText(compiled.toleranceDefinition.version===2?withScalarPolicy(compiled.toleranceDefinition.resourcePolicy,b,owner=>divideUnitRational(result.delta,decode(compiled.toleranceScale),owner)):divideUnitRational(result.delta,decode(compiled.toleranceScale),b),b),representation:'rational',radix:10}));
 const saved=await retainScalarDefinitions(materials,{version:1,status:result.status,delta,tieCount:result.tieCount,decisionComputation:result.decisionComputation,evidenceIndex:await evidence.finish(),resourcePolicy:policy},write,{signal,allowRetained:true});delete saved.resourcePolicy;if(!validCoordinateAlignmentReceipt(saved,policy))fail('MATERIAL_MISSING');return saved;
}
async function pinnedContext(materials,entry,{signal}={}){
 if(!validCoordinateAlignmentContext(entry))fail('MATERIAL_MISSING');signal?.throwIfAborted();const doc=await materials.read(entry.graph);if(doc.content?.graphVersion<17||doc.content?.tool!=='Observanda calculation graph')fail('MATERIAL_MISSING');const binding=await materials.sequences.item(doc.content.graphBindingsIndex,entry.binding.position);if(binding.id!==entry.binding.id||!isCoordinateAlignment(binding.match))fail('MATERIAL_MISSING');await materials.read(binding.source);
 const expected=alignmentContext(binding,entry.binding.position,entry.graph,doc.content.policy),actualResolved=await resolveScalarDefinitions(materials,entry,{signal}),expectedResolved=await resolveScalarDefinitions(materials,expected,{signal});if(revisionText(actualResolved)!==revisionText(expectedResolved))fail('MATERIAL_MISSING');return entry;
}
async function decisionContext(materials,entry,{column,signal}={}){
 if(!validDecision(entry))fail('MATERIAL_MISSING');let context;
 if(column){if(!validCoordinateAlignmentColumn(column))fail('MATERIAL_MISSING');const found=await materials.sequences.tree().find({root:column.contextsIndex.root},alignmentIdentity(entry)),chunk=found&&await materials.sequences.read('chunks',found.revision);if(chunk?.kind!=='coordinate-alignment-contexts'||chunk.items?.length!==1)fail('MATERIAL_MISSING');context=chunk.items[0];}
 else{const graph=await materials.read(entry.graph),binding=await materials.sequences.item(graph.content.graphBindingsIndex,entry.binding.position);context=alignmentContext(binding,entry.binding.position,entry.graph,graph.content.policy);}
 return pinnedContext(materials,context,{signal});
}
export async function verifyCoordinateAlignment(materials,marker,{column,signal}={}){
 if(!validCoordinateAlignmentColumn(marker)&&!validCoordinateAlignmentCell(marker)&&!validCoordinateAlignmentMeasurement(marker))fail('MATERIAL_MISSING');
 if(marker.contextsIndex){await alignmentContextSet(materials).verify(marker.contextsIndex);for await(const entry of materials.sequences.items(marker.contextsIndex))await pinnedContext(materials,entry,{signal});column={version:1,contextsIndex:marker.contextsIndex};}
 if(marker.decisionsIndex){await alignmentDecisionSet(materials).verify(marker.decisionsIndex);for await(const entry of materials.sequences.items(marker.decisionsIndex)){signal?.throwIfAborted();const context=await decisionContext(materials,entry,{column,signal});if(!validCoordinateAlignmentReceipt(entry.receipt,context.resourcePolicy))fail('MATERIAL_MISSING');await resolveScalarDefinitions(materials,{...entry.receipt,resourcePolicy:context.resourcePolicy},{signal});for await(const evidence of materials.sequences.items(entry.receipt.evidenceIndex)){if(!exact(evidence,['ordinal','source','computation'])||!Number.isSafeInteger(evidence.ordinal)||evidence.ordinal<0||!validLocator(evidence.source)||evidence.source.selector.kind!=='cell'||!validCellComputation(evidence.computation))fail('MATERIAL_MISSING');await materials.read(evidence.source.ref);}}}
 return marker;
}
export async function* coordinateAlignmentReferences(materials,marker){if(marker?.contextsIndex)for await(const entry of materials.sequences.items(marker.contextsIndex)){if(!validCoordinateAlignmentContext(entry))fail('MATERIAL_MISSING');yield entry.graph;}if(marker?.decisionsIndex)for await(const entry of materials.sequences.items(marker.decisionsIndex)){if(!validDecision(entry))fail('MATERIAL_MISSING');yield entry.graph;for await(const evidence of materials.sequences.items(entry.receipt.evidenceIndex)){if(!validLocator(evidence.source))fail('MATERIAL_MISSING');yield evidence.source.ref;}}}
export async function coordinateAlignmentPage(materials,marker,{column,offset=0,limit=16,signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>16||!validCoordinateAlignmentCell(marker))fail('INVALID');const page=await alignmentDecisionSet(materials).page(marker.decisionsIndex,{offset,limit}),items=[];
 for(const entry of page.items){signal?.throwIfAborted();const context=await decisionContext(materials,entry,{column,signal});if(!validCoordinateAlignmentReceipt(entry.receipt,context.resourcePolicy))fail('MATERIAL_MISSING');const evidence=await materials.sequences.page(entry.receipt.evidenceIndex,{offset:0,limit:4});for(const item of evidence.items){if(!validLocator(item.source))fail('MATERIAL_MISSING');await materials.read(item.source.ref);}items.push({...entry,context,evidence});}return {...page,items};
}

export async function verifyCoordinateAlignmentAxis(materials,axis,{signal}={}){
 if(!validCoordinateAlignmentAxis(axis))fail('MATERIAL_MISSING');signal?.throwIfAborted();const doc=await materials.read(axis.frame),{validCoordinateFrame,validCoordinateFrameAxis,COORDINATE_FRAME_TOOL}=await import('./web/coordinate-frame-model.js');if(doc.content?.tool!==COORDINATE_FRAME_TOOL||!validCoordinateFrame(doc.content)||axis.axis>=doc.content.dimension)fail('MATERIAL_MISSING');const value=await materials.sequences.item(doc.content.axesIndex,axis.axis);if(!validCoordinateFrameAxis(value))fail('MATERIAL_MISSING');signal?.throwIfAborted();return axis;
}
export async function alignmentScalarDeclaration(materials,marker,index,{column,signal}={}){
 const page=await coordinateAlignmentPage(materials,marker,{column,offset:index,limit:1,signal});if(page.items.length!==1)fail('MATERIAL_MISSING');return {...page.items[0].receipt,resourcePolicy:page.items[0].context.resourcePolicy};
}
export function* coordinateAlignmentSequences(value){
 for(const descriptor of [value?.coordinateAlignment?.contextsIndex,value?.coordinateAlignment?.decisionsIndex,value?.contextsIndex,value?.decisionsIndex,value?.alignment?.evidenceIndex,value?.receipt?.evidenceIndex,value?.evidenceIndex])if(descriptor)yield descriptor;
 if(value?.match?.coordinate?.tolerance?.spelling?.parts)yield value.match.coordinate.tolerance.spelling.parts;
 for(const delta of [value?.delta,value?.receipt?.delta,value?.alignment?.delta])if(delta?.spelling?.parts)yield delta.spelling.parts;
}

// Publication consumes owned result snapshots only. Private graph/evidence identities
// are neither fetched nor included in this projection; the selected dataset gate
// and authenticated sequence reads remain the authority for this operation.
export async function coordinateAlignmentPublicPage(materials,marker,{column,offset=0,limit=16,signal}={}){
 if(!validCoordinateAlignmentCell(marker)||!validCoordinateAlignmentColumn(column))fail('MATERIAL_MISSING');const page=await alignmentDecisionSet(materials).page(marker.decisionsIndex,{offset,limit}),items=[];
 for(const entry of page.items){signal?.throwIfAborted();const found=await materials.sequences.tree().find({root:column.contextsIndex.root},alignmentIdentity(entry)),chunk=found&&await materials.sequences.read('chunks',found.revision),context=chunk?.items?.[0];if(chunk?.kind!=='coordinate-alignment-contexts'||chunk.items.length!==1||!validCoordinateAlignmentContext(context)||alignmentIdentity(context)!==alignmentIdentity(entry)||!validCoordinateAlignmentReceipt(entry.receipt,context.resourcePolicy))fail('MATERIAL_MISSING');items.push({context:publicCoordinateAlignmentContext(context),receipt:publicCoordinateAlignmentReceipt(entry.receipt)});}return {...page,items};
}
