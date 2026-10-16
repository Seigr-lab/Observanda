// Shared read projections. These items never become editable record drafts.
export const researchCardFields={sections:'sections',contributors:'contributors',relations:'relations',figures:'figures',files:'attachments',media:'attachments'};
export const researchCardKey=(provider,recordId,itemId)=>provider==='figures'?itemId:recordId+':'+itemId;
export function researchCardItems(provider,record){
 const field=researchCardFields[provider];if(!field)return [];
 return (record[field]??[]).map(data=>({key:researchCardKey(provider,record.id,data.id),
  title:provider==='figures'?data.title||record.title:provider==='relations'?data.label||data.type:data.title||data.name||data.caption||data.kind||'Untitled',
  subtitle:record.title,data,action:{name:'edit-entry',id:record.id}}));
}
// Only labels and stable source identities belong in card discovery. Record
// bodies, figure values and attachment metadata are loaded by the chosen card.
export function researchCardSources(record){
 return Object.fromEntries(Object.keys(researchCardFields).filter(id=>id!=='media').map(id=>[id,researchCardItems(id,record).map(({key,title})=>({key,title}))]));
}
