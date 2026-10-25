import {alignmentScalarDeclaration} from './coordinate-alignment.js';
import {aggregationQuantileDetails} from './dataset-aggregation-members.js';
import {AppError} from './errors.js';
import {readScalarDefinition} from './measurement-scalar-storage.js';
import {readDomainComponent} from './measurement-domain-storage.js';
import {CalculationGraphs} from './calculation-graphs.js';
const invalid=()=>{throw new AppError('INVALID');};
export async function measurementScalarRequest(materials,operation,data,{signal}={}){
 const component=operation==='measurement-component',allowed=component?['ref','selector','component','offset','limit']:['ref','column','node','binding','selector','alignment','field','offset','limit'];
 if(!data||Object.keys(data).some(key=>!allowed.includes(key)))invalid();
 signal?.throwIfAborted();const doc=await materials.read(data.ref),options={offset:data.offset??0,limit:data.limit??4096,signal};
 if(component){const cell=await materials.measurements.cell({ref:data.ref,selector:data.selector});return readDomainComponent(materials,cell.cellReference,{...options,component:data.component});}
 let declaration;
 if(data.alignment!==undefined){if(data.column!==undefined||data.node!==undefined||data.binding!==undefined||data.field!=='delta.spelling'||!Number.isSafeInteger(data.alignment)||data.alignment<0)invalid();if(doc.kind==='dataset'){if(!data.selector)invalid();const cell=await materials.measurements.cell({ref:data.ref,selector:data.selector});declaration=await alignmentScalarDeclaration(materials,cell.row.cellCoordinateAlignments?.[0],data.alignment,{column:cell.column.coordinateAlignment,signal});}else{if(data.selector!==undefined||!doc.content.measurement?.coordinateAlignment)invalid();const marker=doc.content.measurement.coordinateAlignment;declaration=await alignmentScalarDeclaration(materials,{version:1,decisionsIndex:marker.decisionsIndex},data.alignment,{column:{version:1,contextsIndex:marker.contextsIndex},signal});}}
 else if(data.binding!==undefined){if(data.node!==undefined||data.column!==undefined||data.selector!==undefined)invalid();const graphs=new CalculationGraphs(materials);graphs.shape(doc);declaration={...await graphs.at(doc.content,'bindings',data.binding),resourcePolicy:doc.content.policy};}
 else if(data.selector!==undefined){if(data.column!==undefined||data.node!==undefined||data.field!=='weight.spelling'||doc.kind!=='dataset')invalid();const cell=await materials.measurements.cell({ref:data.ref,selector:data.selector}),index=data.selector.column-doc.content.aggregation?.keys?.length,detail=await aggregationQuantileDetails(materials,doc,cell.row,index,{signal});if(!detail.quantile)invalid();const {lower,upper,...receipt}=detail.quantile;declaration={...receipt,lower:{rank:lower.rank,member:lower.member},upper:{rank:upper.rank,member:upper.member},resourcePolicy:doc.content.aggregation.resourcePolicy};}
 else if(data.column!==undefined){if(data.node!==undefined||doc.kind!=='dataset'||!Number.isSafeInteger(data.column)||data.column<0)invalid();declaration=await materials.datasetColumn(doc,data.column);}
 else if(data.node!==undefined){const graph=new CalculationGraphs(materials);graph.shape(doc);declaration=await graph.at(doc.content,'nodes',data.node);}
 else{declaration=['Observanda clock synchronization','Observanda statistical uncertainty','Observanda dataset spectrum','Observanda dataset CUSUM'].includes(doc.content.tool)||doc.content.aggregation?.version>=4?doc.content:doc.content.measurement;if(!declaration)invalid();}
 return readScalarDefinition(materials,declaration,data.field,options);
}
