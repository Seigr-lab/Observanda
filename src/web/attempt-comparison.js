import {attemptText} from './attempt-messages.js';
export function attemptComparisonView(value,baseline,esc,{message=attemptText,navigation=()=>''}={}){
 const t=key=>esc(message(key));if(!value)return t('none');
 const matched=new Set();
 const conditions=value.conditions.map(c=>{
  const sameName=baseline?.conditions.filter(b=>b.name===c.name)??[];
  const before=baseline?.conditions.find(b=>b.id===c.id)??(sameName.length===1&&value.conditions.filter(b=>b.name===c.name).length===1?sameName[0]:null),equal=before&&before.value===c.value&&before.unit===c.unit;
  if(before)matched.add(before.id);
  return '<li><strong>'+esc(c.name)+'</strong>: '+esc(c.value)+' '+esc(c.unit)+' · '+t(c.basis)+'<small'+(!equal?' class="attempt-difference"':'')+'>'+t(!before?'missing':equal?'same':'different')+'</small></li>';
 }).join('')+(baseline?.conditions??[]).filter(c=>!matched.has(c.id)).map(c=>'<li class="attempt-difference">'+esc(c.name)+': '+t('missingHere')+'</li>').join('');
 return '<section class="attempt-comparison">'+(value.preparationNumber?'<p>'+t('preparation')+' '+value.preparationNumber+' · '+esc(value.applicability)+'</p>':'')+'<h4>'+t('conditions')+'</h4><ul>'+conditions+'</ul><h4>'+t('events')+'</h4>'+navigation('events')+'<ul>'+value.events.map(e=>'<li>'+esc(e.label||message(e.kind))+' · '+t(e.extent)+' · '+t(e.context)+'</li>').join('')+'</ul><h4>'+t('assessments')+'</h4>'+navigation('assessments')+'<ul>'+value.assessments.map(a=>'<li><strong>'+esc(a.criterion)+' · '+t(a.outcome)+'</strong><p>'+t('preparation')+' '+a.preparationNumber+' · '+t(a.scope)+'</p><dl>'+[['expected',a.expected],['comparator',a.comparator],['observed',a.observed],['denominator',a.denominator],['domainOutcome',a.domainOutcome]].filter(([,v])=>v).map(([key,v])=>'<dt>'+t(key)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl></li>').join('')+'</ul></section>';
}
