import {defaultColumn} from '../../src/web/dataset-schema.js';
export const plotCounterOrigin='1000000000000000000000000000000';
export async function transformedPlotDataset(materials,recordId,{width=300,count=20}={}){
 const valueColumn=width-1,errorColumn=width-2,columns=Array.from({length:width},(_,i)=>({...defaultColumn({label:'Field '+(i+1)}),representation:[0,1,errorColumn,valueColumn].includes(i)?'decimal':'text',unit:[errorColumn,valueColumn].includes(i)?'V':''}));
 const rows=Array.from({length:count},(_,row)=>Array.from({length:width},(_,i)=>i===0?plotCounterOrigin+'.'+String(count-row).padStart(3,'0'):i===1?'1':i===valueColumn?'1000.01':i===errorColumn?'0.005':''));
 const bytes=Buffer.from([columns.map(c=>c.name).join(','),...rows.map(row=>row.join(','))].join('\n')),upload=await materials.startImport({recordId,name:'exact-coordinates.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id),source=await materials.dataset({recordId,title:'Exact coordinate source',artifact,columns});
 return {source,artifact,valueColumn,errorColumn,count};
}
