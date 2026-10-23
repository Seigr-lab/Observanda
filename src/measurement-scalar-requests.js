import {AppError} from './errors.js';
import {readScalarDefinition} from './measurement-scalar-storage.js';
import {readDomainComponent} from './measurement-domain-storage.js';
import {CalculationGraphs} from './calculation-graphs.js';
const invalid=()=>{throw new AppError('INVALID');};
export async function measurementScalarRequest(materials,operation,data,{signal}={}){
 const component=operation==='measurement-component',allowed=component?['ref','selector','component','offset','limit']:['ref','column','node','field','offset','limit'];
 if(!data||Object.keys(data).some(key=>!allowed.includes(key)))invalid();
 signal?.throwIfAborted();const doc=await materials.read(data.ref),options={offset:data.offset??0,limit:data.limit??4096,signal};
 if(component){const cell=await materials.measurements.cell({ref:data.ref,selector:data.selector});return readDomainComponent(materials,cell.cellReference,{...options,component:data.component});}
 let declaration;
 if(data.column!==undefined){if(data.node!==undefined||doc.kind!=='dataset'||!Number.isSafeInteger(data.column)||data.column<0)invalid();declaration=await materials.datasetColumn(doc,data.column);}
 else if(data.node!==undefined){const graph=new CalculationGraphs(materials);graph.shape(doc);declaration=await graph.at(doc.content,'nodes',data.node);}
 else{declaration=doc.content.measurement;if(!declaration)invalid();}
 return readScalarDefinition(materials,declaration,data.field,options);
}
