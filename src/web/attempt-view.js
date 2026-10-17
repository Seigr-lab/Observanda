import {currentAttemptItems,attemptReferences} from './attempt-model.js';
import {attemptText} from './attempt-messages.js';

// One presentation owner for authoring, retained revisions and static pages.
// The public renderer receives only a previously projected reference set.
export function attemptView(value,esc,{message=attemptText,reference=null,correct=null,window=null,navigation=()=>''}={}){
 if(!value)return '';
 const t=(key,args)=>esc(message(key,args)),allRefs=attemptReferences(value),referencePositions=new Map(),preparations=new Map(value.preparations.map((item,position)=>[item.id,{item,position}]));
 for(const [position,ref] of allRefs.entries())if(!referencePositions.has(ref))referencePositions.set(ref,position);
 const ref=r=>!r?'':r.withheld?'<span>'+(r.statement?esc(r.statement):t('privateReference'))+'</span>':reference?reference(r,referencePositions.get(r)):r.href?'<a href="'+esc(r.href)+'">'+esc(r.label)+'</a>':'<span>'+esc(r.label)+' · '+t('retained',{revision:r.revision?.slice(0,12)??''})+'</span>';
 const refs=rows=>rows.length?'<ul>'+rows.map(r=>'<li>'+ref(r)+'</li>').join('')+'</ul>':'';
 const pair=(key,v)=>v?'<dt>'+t(key)+'</dt><dd>'+esc(v)+'</dd>':'';
 const preparationName=p=>message('preparation')+' '+((window?window.preparationPositions[p?.id]:preparations.get(p?.id)?.position)+1);
 const time=v=>'<dl>'+pair('actor',v.actor)+pair('source',v.source)+pair('time',message(v.time.meaning)+(v.time.value?' · '+v.time.value:''))+pair('recordedAt',v.recordedAt)+pair('reason',v.reason)+'</dl>'+(v.supersedes?'<p>'+t('supersedes',{id:v.supersedes})+'</p>':'');
 const table=(heads,rows)=>'<div class="table-scroll" tabindex="0"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+t(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(c=>'<tr>'+c.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const preparation=p=>'<section><h3>'+esc(preparationName(p))+'</h3><dl>'+pair('applicability',p.applicability)+pair('reason',p.reason)+pair('recordedAt',p.recordedAt)+'</dl>'+ref(p.basedOn)+
  (p.protocols.length?'<h4>'+t('protocols')+'</h4>'+refs(p.protocols):'')+
  (p.conditions.length?'<h4>'+t('conditions')+'</h4>'+table(['name','value','unit','basis','reference'],p.conditions.map(c=>[esc(c.name),esc(c.value)||t('none'),esc(c.unit),t(c.basis)+(c.reason?'<p>'+esc(c.reason)+'</p>':''),ref(c.reference)])):'')+
  (p.inputs.length?'<h4>'+t('inputs')+'</h4>'+table(['label','inputKind','hash','reference'],p.inputs.map(i=>[esc(i.label),t(i.kind),esc(i.algorithm)+' · <code>'+esc(i.hash)+'</code>',ref(i.reference)])):'')+
  (p.observations.length?'<h4>'+t('observations')+'</h4><ul>'+p.observations.map(o=>'<li>'+esc(o.label)+'</li>').join('')+'</ul>':'')+
  (p.criteria.length?'<h4>'+t('criteria')+'</h4>'+table(['criterion','expected','comparator','denominator','scope'],p.criteria.map(c=>[esc(c.label),esc(c.expected),esc(c.comparator),esc(c.denominator)||t('none'),t(c.scope)+(c.reason?'<p>'+esc(c.reason)+'</p>':'')])):'')+'</section>';
 const assessment=(a,editable=false)=>{
  const p=preparations.get(a.preparationId)?.item,c=p.criteria.find(c=>c.id===a.criterionId);
  return '<section class="attempt-assessment"><h4>'+esc(c.label)+' — '+t(a.outcome)+'</h4><dl>'+pair('preparation',preparationName(p))+pair('scope',message(c.scope))+pair('expected',c.expected)+pair('comparator',c.comparator)+pair('observed',a.observed)+pair('denominator',a.denominator)+pair('domainOutcome',a.domainOutcome)+'</dl>'+time(a)+refs(a.references)+(editable&&correct?correct('assessment',a,c.label):'')+'</section>';
 };
 const event=(e,editable=false)=>'<section class="attempt-event"><h4>'+esc(e.label||message(e.kind))+' — '+t(e.extent)+'</h4><dl>'+pair('kind',message(e.kind))+pair('context',message(e.context))+pair('preparation',e.preparationId?preparationName(preparations.get(e.preparationId)?.item):'')+pair('circumstances',e.circumstances)+'</dl>'+time(e)+refs(e.references)+(editable&&correct?correct('event',e,e.label||message(e.kind)):'')+'</section>';
 if(window){
  const superseded=new Set(window.superseded),badge=item=>superseded.has(item.id)?'<p class="muted">'+t('supersededFact')+'</p>':'';
  const group=(name,rows,render)=>'<section class="attempt-history" data-attempt-group="'+name+'"><h3>'+t(name)+'</h3>'+navigation(name)+rows.map(item=>'<div>'+badge(item)+render(item,!superseded.has(item.id))+'</div>').join('')+'</section>';
  const preparations=value.preparations.filter(p=>window.visiblePreparations.includes(p.id));
  return '<section class="attempt-details"><h2>'+t('title')+'</h2>'+group('preparations',preparations,preparation)+group('events',value.events,event)+group('assessments',value.assessments,assessment)+'</section>';
 }
 const currentEvents=currentAttemptItems(value.events),currentAssessments=currentAttemptItems(value.assessments),currentEventSet=new Set(currentEvents),currentAssessmentSet=new Set(currentAssessments),earlierEvents=value.events.filter(e=>!currentEventSet.has(e)),earlierAssessments=value.assessments.filter(a=>!currentAssessmentSet.has(a));
 const latest=value.preparations.at(-1);
 return '<section class="attempt-details"><h2>'+t('title')+'</h2>'+(latest?preparation(latest):'')+
  (currentEvents.length?'<details open><summary>'+t('events')+' ('+currentEvents.length+')</summary>'+currentEvents.map(e=>event(e,true)).join('')+'</details>':'')+
  (currentAssessments.length?'<details open><summary>'+t('assessments')+' ('+currentAssessments.length+')</summary>'+currentAssessments.map(a=>assessment(a,true)).join('')+'</details>':'')+
  (latest?latest.criteria.filter(c=>!currentAssessments.some(a=>a.preparationId===latest.id&&a.criterionId===c.id)).map(c=>'<p>'+esc(c.label)+' — '+t('notAssessedYet')+'</p>').join(''):'')+
  (value.preparations.length>1?'<details><summary>'+t('earlier')+'</summary>'+value.preparations.slice(0,-1).map(preparation).join('')+'</details>':'')+
  (earlierEvents.length||earlierAssessments.length?'<details><summary>'+t('corrections')+'</summary>'+earlierEvents.map(e=>event(e)).join('')+earlierAssessments.map(a=>assessment(a)).join('')+'</details>':'')+'</section>';
}

export function projectAttempt(value,projectReference){
 if(!value)return undefined;const out=structuredClone(value),ref=r=>r?projectReference(r)??{withheld:true}:null;
 for(const p of out.preparations){p.basedOn=ref(p.basedOn);p.protocols=p.protocols.map(ref);for(const c of p.conditions)c.reference=ref(c.reference);for(const i of p.inputs)i.reference=ref(i.reference);}
 for(const row of [...out.events,...out.assessments])row.references=row.references.map(ref);return out;
}
