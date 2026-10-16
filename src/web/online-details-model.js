// The same projection is used by the host and the shared-record form. Optional
// values remain null until authored; comparisons never depend on display text.
export const onlineDetailFields=Object.freeze(['title','status','outcome','tags']);
export const templateDetailName=field=>'template:'+field.key;
export const onlineDetailFieldsFor=record=>[...onlineDetailFields,...(record.template?.fields??[]).map(templateDetailName)];
export const onlineDetailValue=(record,field)=>field.startsWith('template:')?(Object.hasOwn(record.template?.values??{},field.slice(9))?record.template.values[field.slice(9)]:null):record[field]??null;
export const onlineDetails=record=>Object.fromEntries(onlineDetailFieldsFor(record).map(field=>[field,structuredClone(onlineDetailValue(record,field))]));
// Callers validate editable names against this record's immutable template.
export function setOnlineDetail(record,field,value){
 if(field.startsWith('template:'))record.template.values[field.slice(9)]=structuredClone(value);
 else if(value===null)delete record[field];else record[field]=structuredClone(value);
}
export const sameDetail=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
