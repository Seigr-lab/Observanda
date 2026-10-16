import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const normalize=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en');
const order=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
// Choices read only the encrypted registry's display index. Search, hierarchy
// exclusions and pagination never start another project's database.
export async function projectDirectoryChoices(registry,input){
 if(!input||Object.keys(input).sort().join()!=='exclude,kind,limit,offset,query,revision'||!['parents','templates','book-parents','record-parents'].includes(input.kind)||input.exclude!==null&&!researchId(input.exclude)||typeof input.query!=='string'||input.query.length>160||!Number.isSafeInteger(input.offset)||input.offset<0||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>50||input.revision!==null&&typeof input.revision!=='string')throw new AppError('INVALID');
 const current=input.kind==='book-parents'?await registry.read().then(current=>({...current,projects:current.value.projects})):await registry.directory();if(input.revision!==null&&input.revision!==current.revision)throw new AppError('CONFLICT');
 const excluded=new Set(input.exclude?[input.exclude]:[]),all=current.projects;
 if(input.kind==='parents'&&input.exclude){
  const children=new Map();for(const entry of all){if(!children.has(entry.parentId))children.set(entry.parentId,[]);children.get(entry.parentId).push(entry.projectId);}
  const pending=[input.exclude];for(let i=0;i<pending.length;i++)for(const child of children.get(pending[i])??[])if(!excluded.has(child)){excluded.add(child);pending.push(child);}
 }
 const byId=new Map(all.map(entry=>[entry.projectId,entry])),ancestry=new Map();
 function ancestors(entry){if(ancestry.has(entry.projectId))return ancestry.get(entry.projectId);const names=[],seen=new Set([entry.projectId]);let parent=byId.get(entry.parentId);while(parent){if(seen.has(parent.projectId))throw new AppError('INVALID');seen.add(parent.projectId);names.unshift(parent.summary?.title??parent.projectId);parent=byId.get(parent.parentId);}ancestry.set(entry.projectId,names);return names;}
 const query=normalize(input.query.trim()),label=entry=>input.kind==='templates'?entry.summary?.templateName:entry.summary?.title;
 const matches=all.filter(entry=>!excluded.has(entry.projectId)&&(input.kind!=='templates'||entry.summary?.templateName)&&(!query||normalize([entry.summary?.title,label(entry),entry.projectId,...(input.kind==='record-parents'?ancestors(entry):[])].join(' ')).includes(query))).sort((a,b)=>order.compare(label(a)??a.projectId,label(b)??b.projectId)||a.projectId.localeCompare(b.projectId));
 return {revision:current.revision,total:matches.length,projects:matches.slice(input.offset,input.offset+input.limit).map(entry=>({projectId:entry.projectId,parentId:entry.parentId,summary:entry.summary??null,...(input.kind==='record-parents'?{legacy:entry.legacy===true,ancestors:ancestors(entry)}:{})}))};
}
