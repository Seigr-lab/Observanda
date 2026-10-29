import {t} from './i18n/index.js';
import {recordTypeLabel as recordLabel} from './record-type-presentation.js';
import {recordDateLabel} from './record-date.js';
import {ux} from './experience-ui.js';

// Each area contains the existing selected-value controls. No editable record
// snapshot is built from the paged reading projection.
export function recordEditingView({record,esc,status,busy,details,summary,sections,fields,activity,evidence,relations}){
 const text=key=>t('recordContent',key);
 const detailText=key=>t('recordValues',key),values=[
  ['type',record.template?.label||recordLabel(record.type)],['status',detailText('status_'+record.status)],
  ['outcome',record.outcome||detailText('empty')],['occurredOn',recordDateLabel(record.occurredOn)],
  ['share',detailText(record.share?'public':'private')]
 ];
 const edit=(name)=>'<button class="button subtle" type="button" data-action="record-value-edit" data-value-field="'+name+'">'+esc(ux('editField',{name:detailText(name)}))+'</button>';
 const summaryDetails='<dl class="record-edit-details">'+values.map(([key,value])=>'<div><dt>'+esc(detailText(key))+'</dt><dd>'+esc(value)+(key==='type'&&record.template?'':edit(key))+'</dd></div>').join('')+'</dl>';
 const areas=[
  ['details',summaryDetails+details+(record.template?fields.template??'':'')],
  ['summary',summary],['sections',sections],
  ['figures',fields.figures],['attachments',fields.attachments],
  ['attempt',fields.attempt],['results',fields.results],
  ['tags',fields.tags],['contributors',fields.contributors],
  ['evidence',evidence],['relations',relations],['activity',activity]
 ].filter(([,html])=>html);
 const groups=[['writing',['summary','sections']],['evidence',['attachments','figures','evidence','results','attempt','relations']],['details',['details','tags','contributors']],['activity',['activity']]];
 const section=([key,html])=>'<section class="record-edit-area" data-record-edit-area="'+key+'" tabindex="-1" aria-labelledby="record-edit-heading-'+key+'"><h3 id="record-edit-heading-'+key+'">'+esc(text('area_'+key))+'</h3>'+html+'</section>';
 return '<article class="record-reader record-editing" aria-busy="'+busy+'"><div class="record-title-row"><h1>'+esc(record.title)+'</h1>'+edit('title')+'</div>'+status+
  '<div class="record-quick-details"><span>'+esc(recordDateLabel(record.occurredOn))+'</span>'+edit('occurredOn')+'<span>'+esc(detailText('status_'+record.status))+'</span>'+edit('status')+'</div>'+
  '<nav class="record-edit-navigation" aria-label="'+esc(text('editingNavigation'))+'">'+groups.map(([key,ids])=>'<button type="button" class="button subtle" data-action="content-edit-area" data-area="'+ids[0]+'">'+esc(ux(key))+'</button>').join('')+'</nav>'+
  groups.map(([key,ids])=>{const content=ids.flatMap(id=>areas.filter(([name])=>name===id)).map(section).join('');return key==='writing'?'<section class="record-writing-surface">'+content+'</section>':'<details class="record-edit-group" data-disclosure="record-'+key+'"><summary>'+esc(ux(key))+'</summary>'+content+'</details>';}).join('')+'</article>';
}
