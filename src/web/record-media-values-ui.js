import {publicationChoices} from './record-publication-controls.js';
import {recordRevisionField} from './record-revision-view.js';
import {t} from './i18n/index.js';
import {emptyMediaMetadata,MEDIA_METADATA_LIMITS,validMediaMetadata,validCaptureTime,validMediaCaptions,MEDIA_CAPTION_LIMIT,MEDIA_CAPTION_BYTES} from './record-media-value.js';
import {mediaMetadataList,mediaTechnicalList} from './record-media-metadata.js';
import {recordDateFields,updateRecordDate} from './record-date-ui.js';
import {dateParts,recordDateIssue} from './record-date.js';
const text=(key,args)=>t('recordValues',key,args);
export function recordMediaControls(record,esc,busy=false,actions=()=> '',options={}){
 return record.attachments.map(item=>'<section data-record-media="'+item.id+'">'+recordRevisionField('attachments',{...record,attachments:[item]},esc,options)+
  '<div class="inline-actions"><span>'+esc(item.caption||text('mediaKind_'+item.kind))+'</span>'+publicationChoices(item.share,item.sharePdf,esc)+'<button type="button" class="button" data-action="record-value-edit" data-value-field="media:'+item.id+'" aria-label="'+esc(text('editMedia',{label:item.caption||text('mediaKind_'+item.kind)}))+'"'+(busy?' disabled':'')+'>'+esc(text('editMediaButton'))+'</button>'+actions(item)+'</div></section>').join('');
}
// Source and capture details: optional, private by default, stored with the
// record's media value so they travel with the lab book.
function metadataFields(metadata,{esc,field}){
 const option=(value,name,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(name)+'</option>';
 const input=(key,label,extra='')=>field(esc(text(label)),'<input data-media-metadata="'+key+'" maxlength="'+MEDIA_METADATA_LIMITS[key]+'" value="'+esc(metadata[key])+'"'+extra+'>');
 const day=dateParts(metadata.capturedOn)?.kind==='day';
 return '<fieldset class="record-media-details" data-media-metadata-group><legend>'+esc(text('mediaSourceHeading'))+'</legend><p class="muted">'+esc(text('mediaSourceHelp'))+'</p>'+
  input('creator','mediaCreator')+input('credit','mediaCredit')+input('licence','mediaLicence',' list="record-media-licences"')+
  '<datalist id="record-media-licences">'+['CC0 1.0','CC BY 4.0','CC BY-SA 4.0','CC BY-NC 4.0','CC BY-NC-SA 4.0','CC BY-ND 4.0','Public domain'].map(name=>'<option value="'+esc(name)+'">').join('')+'</datalist>'+
  '<div data-media-capture-date>'+recordDateFields(metadata.capturedOn,{field,option,esc,label:text('mediaCaptured')})+'</div>'+
  field(esc(text('mediaCaptureTime')),'<input data-media-metadata="capturedTime" inputmode="numeric" maxlength="29" placeholder="06:41:07+02:00" value="'+esc(metadata.capturedTime)+'"'+(day?'':' disabled')+'>')+'<p class="muted">'+esc(text('mediaCaptureTimeHelp'))+'</p>'+
  input('subject','mediaSubject')+field(esc(text('mediaLocation')),'<textarea data-media-metadata="location" rows="2" maxlength="'+MEDIA_METADATA_LIMITS.location+'">'+esc(metadata.location)+'</textarea>')+'<p class="muted">'+esc(text('mediaLocationHelp'))+'</p>'+
  input('source','mediaSource')+'<p data-media-metadata-error role="status"></p></fieldset>';
}
// Caption tracks: language, a label readers see, and a WebVTT file read as
// text into the lab book. Removing every track removes the field.
function captionFields(captions,{esc,field}){
 const rows=(captions??[]).map((track,i)=>'<li><span>'+esc(track.label)+' ('+esc(track.language)+')</span> <label class="checkbox"><input type="checkbox" data-media-caption-remove="'+i+'">'+esc(text('mediaCaptionRemove',{label:track.label}))+'</label></li>').join('');
 const full=(captions?.length??0)>=MEDIA_CAPTION_LIMIT;
 return '<fieldset class="record-media-captions" data-media-captions><legend>'+esc(text('mediaCaptionsHeading'))+'</legend><p class="muted">'+esc(text('mediaCaptionsHelp'))+'</p>'+
  (rows?'<ul>'+rows+'</ul>':'<p>'+esc(text('mediaCaptionsNone'))+'</p>')+
  (full?'':field(esc(text('mediaCaptionLanguage')),'<input data-media-caption-new="language" maxlength="12" placeholder="ca" autocomplete="off">')+
   field(esc(text('mediaCaptionLabel')),'<input data-media-caption-new="label" maxlength="80">')+
   field(esc(text('mediaCaptionFile')),'<input type="file" accept=".vtt,text/vtt" data-media-caption-new="file">'))+
  '<p data-media-caption-error role="status"></p></fieldset>';
}
export function mediaMetadataIssue(metadata){
 if(metadata===undefined||validMediaMetadata(metadata))return '';
 const date=recordDateIssue(metadata.capturedOn,{translate:t});if(date)return date;
 if(!validCaptureTime(metadata.capturedTime))return text('mediaCaptureTimeInvalid');
 if(metadata.capturedTime&&dateParts(metadata.capturedOn)?.kind!=='day')return text('mediaCaptureTimeNeedsDay');
 return text('mediaSourceInvalid');
}
// Camera details offered from the original: only empty fields are filled,
// and only when the author asks; location stays a private field.
export function captureMetadata(metadata,capture){
 const next={...metadata};
 if(!next.creator&&capture.creator)next.creator=capture.creator;
 if(!next.credit&&capture.copyright)next.credit=capture.copyright;
 if(!next.subject&&capture.description)next.subject=capture.description;
 if(dateParts(next.capturedOn)?.kind==='unknown'&&capture.capturedOn){next.capturedOn=capture.capturedOn;next.capturedTime=capture.capturedTime;}
 if(!next.location&&capture.latitude&&capture.longitude)next.location=capture.latitude+', '+capture.longitude+(capture.altitude?' ('+capture.altitude+' m)':'');
 return next;
}
export function recordMediaView({esc,field,api}){
 const option=(value,name,current)=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(name)+'</option>',helpers={esc,field,option},facts=new Map();
 const mediaId=base=>base?.field?.slice(6);
 function factsView(id){
  const details=facts.get(id);if(!details)return '';
  const capture=details.capture,camera=capture?[['mediaCreator',capture.creator],['mediaCopyright',capture.copyright],['mediaCaptured',[capture.capturedOn,capture.capturedTime].filter(Boolean).join(' ')],['mediaCoordinates',capture.latitude&&capture.longitude?capture.latitude+', '+capture.longitude+(capture.altitude?' ('+capture.altitude+' m)':''):''],['mediaCamera',capture.camera]].filter(([,value])=>value):[];
  return mediaTechnicalList(details.technical,esc)+(camera.length?'<section class="record-media-camera" data-media-camera><h4>'+esc(text('mediaCameraHeading'))+'</h4><dl>'+camera.map(([key,value])=>'<dt>'+esc(text(key))+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl><label class="checkbox"><input type="checkbox" data-media-capture-apply><span>'+esc(text('mediaCameraUse'))+'</span></label><p class="muted">'+esc(text('mediaCameraHelp'))+'</p></section>':'');
 }
 return {
  async prepare(base){
   const id=mediaId(base);if(!id||facts.has(id)||typeof api!=='function')return;
   // Details are optional: a missing tool or unreadable original leaves the editor usable.
   try{facts.set(id,await api('/api/media/'+id+'/details',undefined,{adopt:false}));}catch{facts.set(id,null);}
  },
  fields(base,value){
   const item=value.value;
   return '<p>'+esc(text('mediaHelp'))+'</p>'+field(esc(text('mediaCaption')),'<textarea data-media-detail="caption" rows="2" maxlength="1500">'+esc(item.caption)+'</textarea>')+
    field(esc(text(base.definition.mediaKind==='image'?'mediaAlt':'mediaDescription')),'<textarea data-media-detail="alt" rows="3" maxlength="1500">'+esc(item.alt)+'</textarea>')+
    field(esc(text('mediaTranscript')),'<textarea data-media-detail="transcript" rows="6" maxlength="60000">'+esc(item.transcript)+'</textarea>')+
    factsView(mediaId(base))+metadataFields(item.metadata??emptyMediaMetadata(),helpers)+(base.definition.mediaKind==='video'?captionFields(item.captions,helpers):'')+
    '<label class="checkbox"><input type="checkbox" data-media-detail="sharePdf"'+(item.sharePdf?' checked':'')+'>'+esc(text('sharePdf'))+'</label><label class="checkbox"><input type="checkbox" data-media-detail="share"'+(item.share?' checked':'')+'><span>'+esc(text('mediaShare'))+'</span></label><p class="muted">'+esc(text('mediaShareHelp'))+'</p>';
  },
  input(element,base,value){
   const captions=element.closest('[data-media-captions]');
   if(captions){
    const repaint=message=>{const next=document.createElement('template');next.innerHTML=captionFields(value.value.captions,helpers);const node=next.content.firstElementChild;captions.replaceWith(node);if(message)node.querySelector('[data-media-caption-error]').textContent=message;return node;};
    if(element.dataset.mediaCaptionRemove!==undefined&&element.checked){
     const list=[...(value.value.captions??[])];list.splice(Number(element.dataset.mediaCaptionRemove),1);
     if(list.length)value.value.captions=list;else delete value.value.captions;
     repaint().querySelector('input')?.focus();return true;
    }
    if(element.dataset.mediaCaptionNew==='file'&&element.files?.[0]){
     const file=element.files[0],language=captions.querySelector('[data-media-caption-new="language"]').value.trim(),label=captions.querySelector('[data-media-caption-new="label"]').value.trim();
     if(file.size>MEDIA_CAPTION_BYTES){repaint(text('mediaCaptionTooLarge'));return true;}
     file.text().then(vtt=>{
      const next=[...(value.value.captions??[]).filter(track=>track.language!==language),{language,label,vtt}];
      if(!validMediaCaptions(next)){repaint(text('mediaCaptionInvalid'));return;}
      value.value.captions=next;repaint(text('mediaCaptionAdded',{label}));
     },()=>repaint(text('mediaCaptionInvalid')));
     return true;
    }
    return true;
   }
   if(element.hasAttribute('data-media-capture-apply')){
    const capture=facts.get(mediaId(base))?.capture;if(!capture||!element.checked)return true;
    value.value.metadata=captureMetadata(value.value.metadata??emptyMediaMetadata(),capture);
    const group=element.closest('[data-writing-fields]')?.querySelector('[data-media-metadata-group]');if(group)group.outerHTML=metadataFields(value.value.metadata,helpers);
    element.disabled=true;return true;
   }
   const group=element.closest('[data-media-metadata-group]');
   if(group&&(element.dataset.mediaMetadata||element.dataset.recordDate)){
    // Details are stored only once the author fills one in.
    const metadata=value.value.metadata??=emptyMediaMetadata();
    if(element.dataset.recordDate){const record={occurredOn:metadata.capturedOn};if(!updateRecordDate(element,record,{...helpers,label:text('mediaCaptured')}))return false;metadata.capturedOn=record.occurredOn;}
    else metadata[element.dataset.mediaMetadata]=element.value;
    const time=group.querySelector('[data-media-metadata="capturedTime"]');if(time)time.disabled=dateParts(metadata.capturedOn)?.kind!=='day';
    group.querySelector('[data-media-metadata-error]').textContent=mediaMetadataIssue(metadata);
    return true;
   }
   const key=element.dataset.mediaDetail;if(!key)return false;value.value[key]=['share','sharePdf'].includes(key)?element.checked:element.value;return true;
  },
  validate(dialog,value){const issue=mediaMetadataIssue(value.value?.metadata);const node=dialog.querySelector('[data-media-metadata-error]');if(node)node.textContent=issue;return !issue;},
  preview(base){const item=base.value.value;return '<dl>'+['caption','alt','transcript'].map(key=>'<dt>'+esc(text({caption:'mediaCaption',alt:'mediaDescription',transcript:'mediaTranscript'}[key]))+'</dt><dd class="result-statement-text">'+esc(item[key]||text('empty'))+'</dd>').join('')+'<dt>'+esc(text('mediaShare'))+'</dt><dd>'+esc(text(item.share?'yes':'no'))+'</dd><dt>'+esc(text('sharePdf'))+'</dt><dd>'+esc(text(item.sharePdf?'yes':'no'))+'</dd></dl>'+(item.metadata?mediaMetadataList(item.metadata,esc):'');}
 };
}
