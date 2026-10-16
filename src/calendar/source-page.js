import {summaryPage} from '../summary-page.js';
import {digest} from '../storage-format.js';
import {AppError} from '../errors.js';
const invalid=()=>{throw new AppError('CALENDAR_CURSOR');};
const order=(a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id),point=({id,name})=>({id,name});
export function calendarSourcePage(context,query,{cursor=null,search=''}={}){
 if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>8192)||typeof search!=='string'||search.length>256)throw new AppError('INVALID');
 const queryHash=digest(JSON.stringify({...query,search}));let anchor;
 try{anchor=cursor?context.decode(cursor):{kind:'calendar-sources',queryHash,offset:0};}catch{invalid();}
 if(anchor?.kind!=='calendar-sources'||anchor.queryHash!==queryHash||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>0&&(!anchor.after||typeof anchor.after.id!=='string'||typeof anchor.after.name!=='string'))invalid();
 const limit=20,page=summaryPage({...anchor,limit,order,point});
 return {
  add(source){if(!search||[source.name,source.owner].some(text=>text.toLowerCase().includes(search.toLowerCase())))page.add(source);},
  finish(version,encode){
   if(cursor&&anchor.version!==version)invalid();let value;try{value=page.finish();}catch{invalid();}
   const base={...anchor,version},end=anchor.offset+value.records.length;
   return {sources:value.records,sourcePage:{offset:anchor.offset,total:value.total,cursor:encode(base),nextCursor:end<value.total?encode({...base,offset:end,after:value.after}):null,previousCursor:anchor.offset?encode({...base,offset:Math.max(0,anchor.offset-limit),after:anchor.offset>limit?value.previousAfter:null}):null}};
  }
 };
}
