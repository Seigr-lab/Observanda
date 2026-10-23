import {defaultColumn} from '../../src/web/dataset-schema.js';
export async function selectedNumericalDataset(materials,recordId){
 const width=300,columns=Array.from({length:width},(_,i)=>({...defaultColumn({label:'Field '+(i+1)}),representation:i===298||i===299?'integer':'text'}));
 const rows=[2,4].map((value,row)=>Array.from({length:width},(_,i)=>i===0?'row'+(row+1):i===1?'Z'.repeat(20000):i===2?'group':i===298?String(value+10):i===299?String(value):''));
 const bytes=Buffer.from([columns.map(c=>c.name).join(','),...rows.map(r=>r.join(','))].join('\n')),upload=await materials.startImport({recordId,name:'wide-observations.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const source=await materials.dataset({recordId,title:'Wide numerical observations',artifact,columns});return {source,artifact};
}
