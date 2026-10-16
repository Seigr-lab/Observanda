import {recordRevisionField} from './record-revision-view.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);
export function recordMediaControls(record,esc,busy=false,actions=()=> '',options={}){
 return record.attachments.map(item=>'<section data-record-media="'+item.id+'">'+recordRevisionField('attachments',{...record,attachments:[item]},esc,options)+
  '<div class="inline-actions"><span>'+esc(item.caption||text('mediaKind_'+item.kind))+'</span><span class="badge">'+esc(text(item.share?'mediaAvailable':'mediaPrivate'))+'</span><button type="button" class="button" data-action="record-value-edit" data-value-field="media:'+item.id+'" aria-label="'+esc(text('editMedia',{label:item.caption||text('mediaKind_'+item.kind)}))+'"'+(busy?' disabled':'')+'>'+esc(text('editMediaButton'))+'</button>'+actions(item)+'</div></section>').join('');
}
export function recordMediaView({esc,field}){
 return {
  fields(base,value){
   const item=value.value;
   return '<p>'+esc(text('mediaHelp'))+'</p>'+field(esc(text('mediaCaption')),'<textarea data-media-detail="caption" rows="2" maxlength="1500">'+esc(item.caption)+'</textarea>')+
    field(esc(text(base.definition.mediaKind==='image'?'mediaAlt':'mediaDescription')),'<textarea data-media-detail="alt" rows="3" maxlength="1500">'+esc(item.alt)+'</textarea>')+
    field(esc(text('mediaTranscript')),'<textarea data-media-detail="transcript" rows="6" maxlength="60000">'+esc(item.transcript)+'</textarea>')+
    '<label class="checkbox"><input type="checkbox" data-media-detail="share"'+(item.share?' checked':'')+'><span>'+esc(text('mediaShare'))+'</span></label><p class="muted">'+esc(text('mediaShareHelp'))+'</p>';
  },
  input(element,base,value){const key=element.dataset.mediaDetail;if(!key)return false;value.value[key]=key==='share'?element.checked:element.value;return true;},
  preview(base){const item=base.value.value;return '<dl>'+['caption','alt','transcript'].map(key=>'<dt>'+esc(text({caption:'mediaCaption',alt:'mediaDescription',transcript:'mediaTranscript'}[key]))+'</dt><dd class="result-statement-text">'+esc(item[key]||text('empty'))+'</dd>').join('')+'<dt>'+esc(text('mediaShare'))+'</dt><dd>'+esc(text(item.share?'yes':'no'))+'</dd></dl>';}
 };
}
