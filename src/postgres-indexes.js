// Opaque metadata prefixes use byte order even when the PostgreSQL database
// has a language-specific collation. Install the matching access path in place.
const indexes=[
 {name:'state_slot_bytes',table:'state',sql:'CREATE INDEX state_slot_bytes ON state (slot COLLATE "C")'},
 {name:'objects_id_bytes',table:'objects',sql:'CREATE INDEX objects_id_bytes ON objects (id COLLATE "C")'}
];
export const catalogueIndexesSQL=indexes.map(index=>index.sql).join(';');
export async function ensureCatalogueIndexes(db){
 const missing=async()=>{const present=await db.all('SELECT tablename,indexname FROM pg_catalog.pg_indexes WHERE schemaname=$1 AND indexname=ANY($2::text[])',db.schema,indexes.map(index=>index.name));return indexes.filter(index=>!present.some(row=>row.tablename===index.table&&row.indexname===index.name));};
 if(!(await missing()).length)return;
 await db.run('BEGIN');
 try{
  await db.lock();
  for(const index of await missing())await db.run(index.sql);
  await db.run('COMMIT');
 }catch(error){await db.run('ROLLBACK').catch(()=>{});throw error;}
}

// PostgreSQL's C collation compares UTF-8 bytes. Valid Unicode scalar values
// preserve that ordering, so the next scalar gives the exact prefix boundary.
export function objectPrefixUpper(prefix){
 const chars=Array.from(prefix);
 while(chars.length){let code=chars.pop().codePointAt(0);if(code===0x10ffff)continue;code++;if(code===0xd800)code=0xe000;return chars.join('')+String.fromCodePoint(code);}
 return null;
}
// Count a key range in bounded pages. A catalogue-sized aggregate can exceed
// the statement budget on network storage even when its final result is tiny.
// Only the count and continuation key leave PostgreSQL; payloads stay unread.
const indexedColumns=Object.freeze({objects:'id',state:'slot'});
function keyRange(table,prefix){
 const column=Object.hasOwn(indexedColumns,table)?indexedColumns[table]:null;
 if(!column||typeof prefix!=='string')throw new TypeError('Invalid catalogue key range');
 const upper=objectPrefixUpper(prefix),values=prefix?[prefix]:[],where=prefix?[column+' COLLATE "C">=$1']:[];
 if(upper!==null){values.push(upper);where.push(column+' COLLATE "C"<$'+values.length);}
 return {column,values,where};
}
export async function catalogueIndexedCount(db,table,prefix=''){
 const range=keyRange(table,prefix);let after=null,total=0;
 while(true){
  const values=[...range.values],where=[...range.where];
  if(after!==null){values.push(after);where.push(range.column+' COLLATE "C">$'+values.length);}
  const query='SELECT count(*)::text AS count,max(key COLLATE "C") AS last FROM (SELECT '+range.column+' AS key FROM '+table+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY '+range.column+' COLLATE "C" LIMIT 1024) AS page';
  const row=await db.get(query,...values),count=Number(row.count);total+=count;
  if(!Number.isSafeInteger(count)||count<0||count>1024||!Number.isSafeInteger(total)||count>0&&typeof row.last!=='string')throw new Error('Invalid catalogue count');
  if(count<1024)return total;
  after=row.last;
 }
}
export async function cataloguePrefixExists(db,table,prefix=''){
 const {values,where}=keyRange(table,prefix);
 return !!await db.get('SELECT 1 FROM '+table+(where.length?' WHERE '+where.join(' AND '):'')+' LIMIT 1',...values);
}
export async function catalogueObjectPrefixCount(db,prefix){return {n:String(await catalogueIndexedCount(db,'objects',prefix))};}
