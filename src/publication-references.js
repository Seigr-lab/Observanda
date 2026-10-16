import {bookText} from './web/book-messages.js';

const path=(id,page)=>'entries/'+(page?'references-'+id+'-'+page:id)+'.html';
const rows=(context,id)=>(context.recordJourneys??context.entries).filter(record=>record.relations.some(link=>link.id===id));
function content(items,id,esc){
 const related=items.filter(r=>r.relations.some(l=>l.id===id&&!['run-of','compares'].includes(l.role))),runs=items.filter(r=>r.relations.some(l=>l.id===id&&l.role==='run-of')),comparisons=items.filter(r=>r.relations.some(l=>l.id===id&&l.role==='compares'));
 const link=r=>'<a href="../entries/'+r.id+'.html">'+esc(r.title)+'</a>';
 return (related.length?'<section class="record-related"><h2>'+esc(bookText('backlinks'))+'</h2><ul>'+related.map(r=>'<li>'+link(r)+'</li>').join('')+'</ul></section>':'')+
  (runs.length?'<section class="record-related"><h2>'+esc(bookText('linkedRuns'))+'</h2><ol>'+runs.map(r=>'<li>'+link(r)+' &middot; '+esc(r.status)+(r.outcome?' &middot; '+esc(r.outcome):'')+'</li>').join('')+'</ol></section>':'')+
  (comparisons.length?'<section class="record-related"><h2>'+esc(bookText('comparedIn'))+'</h2><ul>'+comparisons.map(r=>'<li>'+link(r)+'</li>').join('')+'</ul></section>':'');
}
function navigation(previous,next,esc){
 return '<nav class="book-page-navigation" aria-label="'+esc(bookText('referencePages'))+'">'+(previous?'<a rel="prev" href="'+esc(previous)+'">'+esc(bookText('previousReferences'))+'</a>':'')+(next?'<a rel="next" href="'+esc(next)+'">'+esc(bookText('nextReferences'))+'</a>':'')+'</nav>';
}
// Reference categories share one reading window, preserving their labels.
// Static continuation pages keep the same record and composition and need no
// scripts. Authenticated previews continue with snapshot-bound index cursors.
export function* publicationReferenceWindows(context,record,esc){
 const all=rows(context,record.id),state=context.referencePage;
 if(state){
  const ids=new Set(state.recordIds),items=all.filter(r=>ids.has(r.id)),continued=!!(state.previousCursor||state.nextCursor);
  const href=cursor=>{if(!cursor)return null;const query=new URLSearchParams(context.referenceQuery);query.set('references',cursor);return '?'+query+'#record-references';};
  const body=content(items,record.id,esc);
  yield {path:path(record.id,0),content:continued?'<div id="record-references">'+(body||'<p>'+esc(bookText('continueReferences'))+'</p>')+navigation(href(state.previousCursor),href(state.nextCursor),esc)+'</div>':body};return;
 }
 if(all.length<=24){yield {path:path(record.id,0),content:content(all,record.id,esc)};return;}
 for(let start=0;start<all.length;start+=24){
  const page=start/24,href=p=>path(record.id,p).slice(8)+'#record-references';
  yield {path:path(record.id,page),content:'<div id="record-references">'+content(all.slice(start,start+24),record.id,esc)+navigation(page?href(page-1):null,start+24<all.length?href(page+1):null,esc)+'</div>'};
 }
}
