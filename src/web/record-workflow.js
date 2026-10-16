import {validTarget} from './research-reference.js';
import {compareKey} from './query-order.js';
import {compareRecordDates} from './record-date.js';
// Optional workflow roles extend the existing research links, not a second graph.
import {RECORD_TYPES} from './record-types.js';
import {repeatPreparation} from './attempt-model.js';
import {preparationMethodLinks} from './attempt-workflow.js';
export const WORKFLOW_ROLES=[
 {id:'run-of',label:'Run / take of',exact:false},
 {id:'uses-method',label:'Uses method',exact:true},
 {id:'compares',label:'Compares',exact:true},
 {id:'follows-run',label:'Follows run',exact:true}
];
export const LIFECYCLE_STATUSES=['draft','planned','in progress','completed','incomplete','cancelled'];
export const OUTCOME_SUGGESTIONS=['Positive result','Negative result','Mixed results','Inconclusive','Unusable results','Not assessed'];
export const sectionAnchor=section=>'record-section-'+section.id;
export const workflowRole=id=>WORKFLOW_ROLES.find(role=>role.id===id);
export function workflowIssues(book,{localReference=target=>target.workspaceId===book.id}={}){
 const issues=[],entries=new Map(book.entries.map(e=>[e.id,e]));
 for(const entry of book.entries){
  let parents=0;
  for(const link of entry.relations??[]){
   if(!link.role)continue;
   const role=workflowRole(link.role),target=link.target,other=target&&localReference(target)?entries.get(target.id):null;
   const problem=message=>issues.push({field:message,recordId:entry.id});
   if(!role||!validTarget(target)||target.kind!=='record'||target.id===entry.id){problem('Workflow links must reference another record.');continue;}
   // A retained address may belong to an independently stored project. Its
   // namespace identifies the target; opening it still requires owner access.
   if(role.exact&&!target.revision)problem('This workflow link requires an exact saved revision.');
   if(link.role==='run-of'){
    parents++;
    // A missing target stays a visible retained reference after deletion.
    if(entry.type!=='run'||target.revision||other?.type==='run')problem('A run or take belongs to one current investigation or creative series.');
   }
   if(link.role==='follows-run'&&entry.type!=='run')problem('Only a run or take can follow another run.');
  }
  if(parents>1)issues.push({field:'Choose one investigation or creative series for this run.',recordId:entry.id});
 }
 return issues;
}
export const runsOf=(book,id)=>book.entries.filter(e=>e.type==='run'&&e.relations.some(l=>l.role==='run-of'&&l.target.workspaceId===book.id&&l.target.id===id)).sort((a,b)=>compareRecordDates(a,b)||compareKey(a.id,b.id));
export const recordCounts=entries=>({experiments:entries.filter(e=>e.type==='experiment'&&!e.template).length,runs:entries.filter(e=>e.type==='run').length,other:entries.filter(e=>e.type!=='run'&&(e.type!=='experiment'||e.template)).length});
export const inheritedRunLink=(link,previous)=>previous
 ?(link.role==='run-of'||link.target.revision)&&link.role!=='compares'&&link.role!=='follows-run'&&link.type!=='Follows run'
 :link.role==='uses-method';
export function createRun(book,parent,{previous=null,revision=null,title=null,uuid=()=>crypto.randomUUID(),now=new Date()}={}){
 if(!parent||previous&&(!revision||previous.type!=='run')||!previous&&parent.type==='run')throw new Error('Choose an investigation or a saved run.');
 const stamp=now.toISOString(),source=previous??parent;
 const retained=source.relations.filter(l=>inheritedRunLink(l,previous));
 const relations=retained.map(l=>({...structuredClone(l),id:uuid()}));
 if(previous)relations.push({id:uuid(),type:'Follows run',role:'follows-run',target:{workspaceId:book.id,kind:'record',id:previous.id,revision},label:previous.title});
 else relations.push({id:uuid(),type:'Run / take of',role:'run-of',target:{workspaceId:book.id,kind:'record',id:parent.id},label:parent.title});
 const preparation=revision&&source.attempt?repeatPreparation(source,{workspaceId:book.id,kind:'record',id:source.id,revision,label:source.title},{uuid,now}):null;
 return {id:uuid(),notebookId:source.notebookId,type:'run',title:title??(source.title.slice(0,145)+(previous?' \u2014 next run':' - run '+(runsOf(book,parent.id).length+1))),body:'',contributors:[],relations:preparation?preparationMethodLinks(relations,preparation,{uuid}):relations,tags:[...source.tags],...(preparation?{attempt:preparation}:{}),
  occurredOn:{kind:'unknown'},
  createdAt:stamp,updatedAt:stamp,share:false,figures:[],attachments:[],status:'planned',outcome:'',
  sections:RECORD_TYPES.find(t=>t.id==='run').sections.map(title=>({id:uuid(),title,body:previous&&title==='Parameters and conditions'?structuredClone(previous.sections.find(s=>s.title===title)?.body??''):''}))};
}
