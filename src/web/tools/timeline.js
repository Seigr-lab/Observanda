import {timelineScope,timelineMatch,timelineOrder} from './timeline-model.js';
import {STATUSES} from '../record-types.js';
import {t} from '../i18n/index.js';
import {recordDateLabel} from '../record-date.js';
export function timelineRecords(book,d){
 const ids=timelineScope(book,d),matches=timelineMatch(d);return book.entries.filter(r=>ids.has(r.notebookId)&&matches(r)).sort(timelineOrder(d));
}
export function timelinePageHTML(result,d,esc){
 const tr=(key,values)=>t('timeline',key,values),page=result.records,books=new Map((result.books??[]).map(b=>[b.id,b])),projects=new Map((result.projects??[]).map(p=>[p.id,p])),groups=new Map();
 for(const e of page){const b=books.get(e.notebookId),id=e.owner?(d.groupBy==='book'?e.owner.workspaceId+'/'+e.notebookId:e.owner.projectId??e.owner.workspaceId):(d.groupBy==='book'?b?.id:b?.projectId),label=e.owner?(d.groupBy==='book'?e.owner.notebookTitle:e.owner.projectTitle):(d.groupBy==='book'?b?.title:projects.get(id)?.title);if(!groups.has(id))groups.set(id,{label:label??tr('unassigned'),entries:[]});groups.get(id).entries.push(e);}
 const branches=[...groups.values()];
 return (result.changed?'<p role="status">'+esc(tr('changed'))+'</p>':'')+(result.missingSources?'<p role="status">'+esc(tr('missing',{count:result.missingSources}))+'</p>':'')+
  '<p role="status" tabindex="-1" data-timeline-status>'+esc(result.total?tr('range',{total:result.total,first:result.offset+1,last:result.offset+page.length}):tr('emptyResults'))+'</p><div class="tool-timeline '+d.density+'" tabindex="0" aria-label="'+esc(tr('branchLabel'))+'" data-branch-color="'+esc(d.color)+'">'+branches.map(g=>'<section class="tool-branch"><h2>'+esc(g.label)+'</h2><ol>'+g.entries.map(e=>'<li><span>'+esc(recordDateLabel(e.occurredOn))+'</span><button type="button" class="text-button" data-action="'+(e.owner?'research-open-owned':'edit-entry')+'" '+(e.owner?'data-workspace-id="'+esc(e.owner.workspaceId)+'" ':'')+'data-id="'+e.id+'">'+esc(e.title)+'</button><small>'+esc(STATUSES.includes(e.status)?tr(e.status==='failed'?'failedStatus':e.status):e.status)+' / '+esc(e.owner?.notebookTitle??books.get(e.notebookId)?.title??'')+'</small></li>').join('')+'</ol></section>').join('')+'</div>';
}
