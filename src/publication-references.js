import {bookText} from './web/book-messages.js';

const rows=(context,id)=>(context.recordJourneys??context.entries).filter(record=>record.relations.some(link=>link.id===id));
function content(items,id,esc){
 const related=items.filter(r=>r.relations.some(l=>l.id===id&&!['run-of','compares'].includes(l.role))),runs=items.filter(r=>r.relations.some(l=>l.id===id&&l.role==='run-of')),comparisons=items.filter(r=>r.relations.some(l=>l.id===id&&l.role==='compares'));
 const link=r=>'<a href="../entries/'+r.id+'.html">'+esc(r.title)+'</a>';
 return (related.length?'<section class="record-related"><h2>'+esc(bookText('backlinks'))+'</h2><ul>'+related.map(r=>'<li>'+link(r)+'</li>').join('')+'</ul></section>':'')+
  (runs.length?'<section class="record-related"><h2>'+esc(bookText('linkedRuns'))+'</h2><ol>'+runs.map(r=>'<li>'+link(r)+' &middot; '+esc(r.status)+(r.outcome?' &middot; '+esc(r.outcome):'')+'</li>').join('')+'</ol></section>':'')+
  (comparisons.length?'<section class="record-related"><h2>'+esc(bookText('comparedIn'))+'</h2><ul>'+comparisons.map(r=>'<li>'+link(r)+'</li>').join('')+'</ul></section>':'');
}
// The record copy lists every record that refers to it, in one reading list.
export const recordReferences=(context,record,esc)=>content(rows(context,record.id),record.id,esc);
