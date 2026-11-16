import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {recordRevision} from './research.js';
import {ResearchMaterials} from './research-materials.js';
import {publicationDependencyState} from './publication-analysis-inputs.js';
import {figurePlots} from './web/figure-composition.js';

// Before an editor website is published, the person can check whether the
// analyses behind the research placed on it still match their inputs. The
// check reads only the records the site's placed sources came from, with the
// requesting person's access. Publishing itself keeps working from the site's
// own files, so a check that cannot run never stops a publication.
const ITEM_LIMIT=200,SAMPLE_LIMIT=5;

async function placedRecords(store,siteId,expectedRevision){
 return store.scope(async()=>{
  const manifest=await store.current(siteId,expectedRevision);
  const groups=new Map();
  for(const placed of manifest.sources){
   const source=await store.source(placed.id),origin=source?.provenance;
   if(source?.target!=='website'||!researchId(origin?.workspaceId)||!researchId(origin?.recordId))continue;
   const rows=groups.get(origin.workspaceId)??[];
   if(!rows.some(row=>row.recordId===origin.recordId))rows.push({sourceId:placed.id,sourceTitle:source.title??'',recordId:origin.recordId});
   groups.set(origin.workspaceId,rows);
  }
  return groups;
 });
}

const sample=rows=>(rows??[]).slice(0,SAMPLE_LIMIT).map(row=>({kind:row.kind,label:typeof row.label==='string'?row.label:'',revision:row.revision??null,current:row.current??null}));

export async function websiteAnalysisCheck(store,siteId,{expectedRevision,sourceReader,signal}={}){
 if(!researchId(siteId)||!revisionId(expectedRevision)||typeof sourceReader!=='function')throw new AppError('INVALID');
 const groups=await placedRecords(store,siteId,expectedRevision),items=[];let records=0,total=0;
 if(!groups.size)return {siteId,revision:expectedRevision,records,total,items,truncated:false};
 const reader=await sourceReader({signal});
 try{
  for(const [workspaceId,rows] of groups){
   signal?.throwIfAborted();
   await reader.use(workspaceId,undefined,async(catalogue,snapshot,pinned)=>{
    const storage=new Proxy(pinned.storage,{get(target,key){if(key==='catalogue')return consume=>consume(catalogue);const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const materials=new ResearchMaterials(storage),placed=[];
    const recordHead=async id=>{const member=await catalogue.member(snapshot,id);return member?recordRevision(await catalogue.record(id,member.revision)):null;};
    for(const row of rows){
     signal?.throwIfAborted();const member=await catalogue.member(snapshot,row.recordId);
     if(member)placed.push({row,record:await catalogue.record(row.recordId,member.revision)});
    }
    if(!placed.length)return;records+=placed.length;
    const book={id:workspaceId,entries:placed.map(item=>item.record)},origin=new Map(placed.map(item=>[item.record.id,item]));
    const {sources,warnings}=await materials.releaseSources(book,book.entries.map(record=>record.id),{recordHead,signal});
    const describe=(recordId,extra)=>{const {row,record}=origin.get(recordId);return {sourceId:row.sourceId,sourceTitle:row.sourceTitle,workspaceId,recordId,recordTitle:record.title??'',...extra};};
    const add=item=>{total++;if(items.length<ITEM_LIMIT)items.push(item);};
    // A figure redrawn by hand no longer matches the calculation it cites.
    for(const warning of warnings)if(warning.reason==='edited'){
     const figure=origin.get(warning.recordId).record.figures?.flatMap(f=>[f,...(f.kind==='panels'?figurePlots(f):[])]).find(f=>f.id===warning.figureId);
     add(describe(warning.recordId,{reason:'edited',label:figure?.title??'',changed:0,sample:[]}));
    }
    if(!sources.length)return;
    const state=await publicationDependencyState(materials,sources,{sourceReader,workspaceId,recordHead,signal});
    for(const item of state.items)add(describe(item.recordId,{reason:'inputs',label:item.label??'',changed:item.changed,sample:sample(item.sample)}));
   },{prepare:storage=>new ResearchMaterials(storage).index.ensure()});
  }
  await reader.verify();
 }finally{await reader.close();}
 return {siteId,revision:expectedRevision,records,total,items,truncated:total>items.length};
}
