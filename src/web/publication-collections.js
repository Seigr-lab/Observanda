// Shared collection identity for projection, asset planning and rendering.
export const publicationCollectionKey=(section,region='')=>(region||'section')+':'+section.id;
export const publicationCollection=(context,key)=>context.collectionPages?.find(page=>page.key===key);
export function publicationCollectionRecords(context,key,fallback){
 const page=publicationCollection(context,key);
 if(!page)return fallback;
 const records=new Map((context.recordCards??context.entries).map(record=>[record.id,record]));
 return page.recordIds.map(id=>records.get(id)).filter(Boolean);
}
