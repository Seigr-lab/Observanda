import {t} from './i18n/index.js';
import {recordLabel} from './record-types.js';
import {recordDateLabel} from './record-date.js';

// Each area contains the existing selected-value controls. No editable record
// snapshot is built from the paged reading projection.
export function recordEditingView({record,esc,status,busy,details,summary,sections,fields,activity,evidence,relations}){
 const text=key=>t('recordContent',key);
 const detailText=key=>t('recordValues',key),values=[
  ['type',record.template?.label||recordLabel(record.type)],['status',detailText('status_'+record.status)],
  ['outcome',record.outcome||detailText('empty')],['occurredOn',recordDateLabel(record.occurredOn)],
  ['share',detailText(record.share?'public':'private')]
 ];
 const summaryDetails='<dl class="record-edit-details">'+values.map(([key,value])=>'<div><dt>'+esc(detailText(key))+'</dt><dd>'+esc(value)+'</dd></div>').join('')+'</dl>';
 const areas=[
  ['details',summaryDetails+details+(record.template?fields.template??'':'')],
  ['summary',summary],['sections',sections],
  ['figures',fields.figures],['attachments',fields.attachments],
  ['attempt',fields.attempt],['results',fields.results],
  ['tags',fields.tags],['contributors',fields.contributors],
  ['evidence',evidence],['relations',relations],['activity',activity]
 ].filter(([,html])=>html);
 return '<article class="record-reader record-editing" aria-busy="'+busy+'"><p class="scope-kicker">'+esc(text('edit'))+'</p><h1>'+esc(record.title)+'</h1>'+status+
  '<p>'+esc(text('editingHelp'))+'</p><nav class="record-edit-navigation" aria-label="'+esc(text('editingNavigation'))+'">'+areas.map(([key])=>'<button type="button" class="button subtle" data-action="content-edit-area" data-area="'+key+'">'+esc(text('area_'+key))+'</button>').join('')+'</nav>'+
  areas.map(([key,html])=>'<section class="record-edit-area" data-record-edit-area="'+key+'" tabindex="-1" aria-labelledby="record-edit-heading-'+key+'"><h2 id="record-edit-heading-'+key+'">'+esc(text('area_'+key))+'</h2>'+html+'</section>').join('')+'</article>';
}
