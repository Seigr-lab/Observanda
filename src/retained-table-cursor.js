import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
const fail=()=>{throw new AppError('DATASET_TABLE');},natural=n=>Number.isSafeInteger(n)&&n>=0;
const identity=(ref,table)=>digest(serialize({ref,table}));
const value=row=>({version:1,direction:row.direction,page:row.page,row:row.row,ordinal:row.ordinal,offset:row.offset});
// Stateless encrypted continuations bind the current owner, immutable source
// and full selection. The ordinary request must still authorize source access.
export async function tableCursors(materials,ref,table,rows){
 return materials.workspace.catalogue(store=>rows.map(row=>row?store.encode('retained-table-page',identity(ref,table),value(row)).toString('base64url'):null));
}
export async function readTableCursor(materials,ref,table,cursor,source,offset){
 if(typeof cursor!=='string'||cursor.length>2048||!/^[A-Za-z0-9_-]+$/.test(cursor))fail();
 let row;try{row=await materials.workspace.catalogue(store=>store.decode('retained-table-page',identity(ref,table),Buffer.from(cursor,'base64url')));}catch(error){if(error.code==='ACCESS_LOCKED')throw error;fail();}
 if(!row||Object.keys(row).length!==6||row.version!==1||!['forward','backward'].includes(row.direction)||!['page','row','ordinal','offset'].every(key=>natural(row[key]))||row.page>=materials.datasetPageCount(source.doc)||row.ordinal>=source.doc.content.rowCount||row.offset>=source.doc.content.rowCount||table.selection.count!==null&&row.offset>=table.selection.count||row.direction==='backward'&&row.offset===0||offset!==undefined&&offset!==row.offset)fail();
 return row;
}
