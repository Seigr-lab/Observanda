import {AppError} from './errors.js';
import {datasetColumnCount,selectedDatasetColumns} from './dataset-selected-columns.js';
import {INTERVAL_FIELDS} from './web/figure-intervals.js';
import {createFigureMapper} from './web/figure-import-model.js';
import {createFigure} from './web/figure-model.js';
const fail=()=>{throw new AppError('MATERIAL_INVALID');};
export function plotColumnIndices(mapping){
 const indices=[...new Set([mapping.x,mapping.group,...mapping.values.flatMap(v=>[v.column,v.error,...INTERVAL_FIELDS.map(k=>v[k]),v.count])].filter(i=>i!==null&&i!==undefined))];
 if(!indices.length||indices.length>256||indices.some(i=>!Number.isSafeInteger(i)||i<0))fail();return indices;
}
export async function datasetPlotSelection(materials,doc,mapping){
 if(doc.content.datasetFormat!==3||datasetColumnCount(doc)<=256)return {columns:await materials.datasetColumns(doc),mapping,indices:null};
 const {indices,columns}=await selectedDatasetColumns(materials,doc,plotColumnIndices(mapping)),at=i=>i===null||i===undefined?i:indices.indexOf(i);
 return {columns,indices,mapping:{...mapping,x:at(mapping.x),group:at(mapping.group),values:mapping.values.map(v=>({...v,column:at(v.column),error:at(v.error),...Object.fromEntries([...INTERVAL_FIELDS,'count'].filter(k=>Object.hasOwn(v,k)).map(k=>[k,at(v[k])]))}))}};
}
export async function verifySelectedPlot(materials,doc){
 const c=doc.content;if(c.tool!=='Observanda table mapping'||!['7','8'].includes(c.version))return;
 try{
 const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
 const d=c.denominator;
 if(!c.mapping||!Array.isArray(c.mapping.values)||c.parameters!==JSON.stringify(c.mapping)||!d||![2,3].includes(d.format)||!Array.isArray(c.inputs)||c.inputs.length!==1||JSON.stringify(d.dataset)!==JSON.stringify(c.inputs[0]))fail();
 const source=await materials.read(d.dataset),selected=await datasetPlotSelection(materials,source,c.mapping);
 const cols=selected.columns,local=selected.mapping;if(local.numericPolicy!==undefined&&!['safe','approximate'].includes(local.numericPolicy)||local.values.length>50)fail();
 if(c.version==='7')for(const value of local.values)for(const key of ['error',...INTERVAL_FIELDS])if(value[key]!=null&&cols[value[key]]?.unit!==cols[key[0]==='x'?local.x:value.column]?.unit)fail();
 if(createFigureMapper({columns:cols.map((column,index)=>({index,label:column.name,heading:column.name}))},{...local,mode:'replace',decimal:'.'},createFigure()).invalid)fail();
 const indices=selected.indices??cols.map((_,i)=>i);
 if(c.version==='7'&&!selected.indices||d.format!==(selected.indices?3:2)||JSON.stringify(selected.indices??undefined)!==JSON.stringify(d.columnIndices)||!Array.isArray(d.missing)||d.missing.length!==indices.length||d.rows!==source.content.rowCount||!Number.isSafeInteger(d.included)||d.included<0||!Number.isSafeInteger(d.excludedCount)||d.excludedCount<0||d.included+d.excludedCount!==d.rows)fail();
 for(const [i,value]of d.missing.entries())if(!value||value.column!==indices[i]||value.name!==selected.columns[i].name||!Number.isSafeInteger(value.count)||value.count<0||value.count>d.included)fail();
 }catch(error){if(error.code==='ACCESS_LOCKED'||error.code==='WORKSPACE_CHANGED'||error.name==='AbortError')throw error;throw new AppError('CATALOGUE_DAMAGED');}
}
