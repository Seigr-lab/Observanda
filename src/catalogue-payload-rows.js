// Payload transport is bounded by bytes as well as rows. A single admitted
// large original travels alone; a cursor never fetches several such originals.
import {AppError} from './errors.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export async function* cataloguePayloadRows(db,table,columns){
 if(!['scope_keys','records','snapshots','state','module_entities','module_events','objects'].includes(table)||
  !Array.isArray(columns)||columns.at(-1)!=='payload'||columns.some(name=>!/^[a-z_]+$/.test(name)))throw new TypeError('Invalid catalogue columns');
 const keys=columns.slice(0,-1),identity=row=>JSON.stringify(keys.map(key=>row[key]));let batch=[],bytes=0;
 async function* load(){
  const values=[],conditions=batch.map(row=>'('+keys.map(key=>{values.push(row[key]);return key+'=$'+values.length;}).join(' AND ')+')');
  const found=new Map((await db.all('SELECT '+columns.join(',')+' FROM '+table+' WHERE '+conditions.join(' OR '),...values)).map(row=>[identity(row),row]));
  if(found.size!==batch.length)damaged();
  for(const item of batch){const row=found.get(identity(item));if(!Buffer.isBuffer(row?.payload)||row.payload.length!==item.payload_bytes)damaged();yield row;}
 }
 for await(const row of db.rows('SELECT '+keys.join(',')+',octet_length(payload) AS payload_bytes FROM '+table+' ORDER BY '+keys.join(','),[],{batchSize:32})){
  if(!Number.isSafeInteger(row.payload_bytes)||row.payload_bytes<1)damaged();
  if(batch.length&&(batch.length===32||bytes+row.payload_bytes>256*1024)){yield* load();batch=[];bytes=0;}
  batch.push(row);bytes+=row.payload_bytes;
 }
 if(batch.length)yield* load();
}
