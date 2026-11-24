// Bounded presentation windows over the current authoring draft. These are
// labels and references, never independently editable record originals.
export const MEDIA_WINDOW=12;
export function inventoryWindow(source,{offset=0,limit=MEDIA_WINDOW,query='',label=item=>item.label}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1)throw new TypeError('Invalid inventory window');
 offset=Math.floor(offset/limit)*limit;
 const needle=query.trim().toLocaleLowerCase();let total=0,items=[],tail=[];
 for(const item of source){
  if(needle&&!label(item).toLocaleLowerCase().includes(needle))continue;
  if(total%limit===0)tail=[];tail.push(item);
  if(total>=offset&&total<offset+limit)items.push(item);total++;
 }
 if(offset>=total){offset=total?Math.floor((total-1)/limit)*limit:0;items=tail;}
 return {items,total,offset,previous:offset?Math.max(0,offset-limit):null,next:offset+items.length<total?offset+limit:null};
}
