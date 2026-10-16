import {compareRecordDates} from './record-date.js';
import {compareKey} from './query-order.js';

export const FEED_KINDS=['records','projects','pages'];
export const feedOrders=kind=>kind==='records'?['newest','oldest']:['alphabetical','reverse-alphabetical'];
// pageSize is the pagination batch for this feed, never a website-page limit
// or a visual dimension. Each section owns its own settings.
export const defaultFeed=kind=>({version:1,pageSize:10,order:feedOrders(kind)[0],navigation:true,visitorOrder:false,visitorFilters:false,visitorView:false,labels:{previous:'',next:'',search:'',tag:'',type:'',apply:'',clear:'',order:'',view:''}});
export function validFeed(value,kind){
 if(!FEED_KINDS.includes(kind)||!value||Object.keys(value).sort().join()!=='labels,navigation,order,pageSize,version,visitorFilters,visitorOrder,visitorView'||value.version!==1||
  !Number.isSafeInteger(value.pageSize)||value.pageSize<1||!feedOrders(kind).includes(value.order)||
  ['navigation','visitorOrder','visitorFilters','visitorView'].some(key=>typeof value[key]!=='boolean'))return false;
 return value.labels&&Object.keys(value.labels).sort().join()==='apply,clear,next,order,previous,search,tag,type,view'&&Object.values(value.labels).every(text=>typeof text==='string'&&text.length<=160&&!/[\u0000-\u001f]/.test(text));
}
export function orderFeed(items,kind,order){
 const compare=kind==='records'?(a,b)=>compareRecordDates(a,b,{descending:true})||compareKey(a.id,b.id):(a,b)=>a.title.localeCompare(b.title,'en')||compareKey(a.id,b.id);
 const reverse=order===feedOrders(kind)[1];return [...items].sort((a,b)=>compare(a,b)*(reverse?-1:1));
}
