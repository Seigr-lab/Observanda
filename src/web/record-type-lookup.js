import {validViewFilter} from './record-view-model.js';
import {t} from './i18n/index.js';
const validChoice=value=>value&&validViewFilter(value.value)&&value.value!=='all'&&typeof value.label==='string'&&value.label.length<=160;
export async function lookupRecordTypes(api,command,{signal}={}){
 const result=await api('/api/workspace/read/record-types',command,{adopt:false,signal});
 if(!result||result.workspaceId!==command.workspaceId||result.etag!==command.etag||!Array.isArray(result.items)||result.items.length>command.limit||!result.items.every(validChoice)||new Set(result.items.map(v=>v.value)).size!==result.items.length||
  !Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||result.offset+result.items.length>result.total||result.total>0&&!result.items.length||
  ![result.previousCursor,result.nextCursor].every(value=>value===null||typeof value==='string'&&value.length>0&&value.length<=4096)||
  (result.offset>0)!==(result.previousCursor!==null)||(result.offset+result.items.length<result.total)!==(result.nextCursor!==null)||
  result.selected!==null&&(!validChoice(result.selected)||result.selected.value!==command.selected))throw Error(t('recordTypes','invalidPage'));
 return result;
}
