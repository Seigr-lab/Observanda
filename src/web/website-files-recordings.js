import {serializeWebsiteHTML} from './website-html-document.js';

const protectedNodes='[data-observanda-source],[data-observanda-link],[data-website-instance],[data-website-region]';
const authored=doc=>[...doc.querySelectorAll('audio,video')].filter(node=>!node.closest(protectedNodes));
const relative=(path,name)=>'../'.repeat(path.split('/').length-1)+name;
const recordingPath=(page,name)=>new URL(name,new URL(page,'https://website.invalid/')).pathname.slice(1);

export function websiteFilesRecordings({t,esc,request,read,css,path,site,url,adopt,historyKey,render,run,notify,close,edited=()=>{},settle=async()=>{},forget=async()=>{},recoveryRef=()=>null}){
 let doc=null,revision=null,pagePath=null,index=-1,items=[],next=null,modified=false;
 let recovered=null;
 const fileIds=new WeakMap(),slots=['upload','vtt'];
 const formFields=['kind','reuse','title','transcript','preload','language','trackLabel','trackKind'];
 const player=()=>authored(doc)[index];
 const figure=node=>node?.closest('figure[data-website-recording]');
 const caption=node=>figure(node)?.querySelector(':scope > figcaption');
 const transcript=node=>figure(node)?.querySelector(':scope > details[data-website-transcript] > div');
 const transcriptText=body=>body?[...body.childNodes].map(node=>node.textContent).join('\n'):'';
 const trackName=node=>node.label||node.srclang||t('recordingTrack');
 const id=()=>crypto.randomUUID();
 function reset(){doc=null;revision=pagePath=null;index=-1;items=[];next=null;modified=false;recovered=null;}
 function draft(){
  const form=document.querySelector('[data-recording-form]');if(!form||!modified)return null;
  const fields=Object.fromEntries(formFields.map(key=>[key,form.elements[key].value])),files={},blobs={};
  for(const slot of slots){
   const file=form.elements[slot].files[0];
   if(file){if(!fileIds.has(file))fileIds.set(file,crypto.randomUUID());files[slot]={id:fileIds.get(file),name:file.name,size:file.size};blobs[slot]=file;}
   else if(recovered?.files[slot])files[slot]=recovered.files[slot];
  }
  const removed=[...form.querySelectorAll('[name="removeTrack"]:checked')].map(input=>Number(input.value));
  return {form:{index,fields,files,removed,defaultTrack:form.elements.defaultTrack.checked},blobs};
 }
 async function restore(form){await open();index=form.index;recovered=form;modified=true;}
 async function loadLibrary(after=''){
  const value=await request('media/library',{siteId:site().id,expectedRevision:revision,path:pagePath,after});
  items=after?[...items,...value.items]:value.items;next=value.next;
 }
 async function open(selected){
  reset();doc=read();revision=site().revision;pagePath=path();let node=doc.body;
  if(typeof selected==='string'&&/^\d+(?:\/\d+)*$/.test(selected)){for(const child of selected.split('/'))node=node?.children[Number(child)];}
  else node=null;
  const current=node?.closest('audio,video')??node?.querySelector('audio,video');
  index=authored(doc).indexOf(current);await loadLibrary();
 }
 const opt=(value,label,selected=false)=>'<option value="'+esc(String(value))+'"'+(selected?' selected':'')+'>'+esc(label)+'</option>';
 const button=(key,action)=>'<button type="button" data-recording-action="'+action+'">'+esc(t(key))+'</button>';
 const field=(key,control)=>'<label>'+esc(t(key))+' '+control+'</label>';
 function view(){
  if(!doc)return '';
  const node=player(),kind=node?.localName??'audio',tracks=[...node?.querySelectorAll('track')??[]];
  const currentSource=node?.getAttribute('src')??node?.querySelector('source')?.getAttribute('src');
  const title=caption(node)?.textContent??node?.getAttribute('aria-label')??'';
  const words=transcriptText(transcript(node));
  const playback=currentSource?'<'+kind+' data-recording-preview controls preload="none" src="'+esc(url(recordingPath(pagePath,currentSource)))+'"></'+kind+'>':'';
  const restoredName=slot=>recovered?.files[slot]?'<span>'+esc(t('recoverySelectedFile',{name:recovered.files[slot].name}))+'</span>':'';
  return '<section class="panel website-files-publish" data-recording-panel><h2>'+esc(t('recordings'))+'</h2>'+
   field('recordingBlock','<select data-recording-block>'+opt(-1,t('recordingNew'),index===-1)+authored(doc).map((el,i)=>opt(i,(caption(el)?.textContent||t(el.localName==='audio'?'recordingAudio':'recordingVideo'))+' ('+(i+1)+')',i===index)).join('')+'</select>')+
   '<form data-recording-form>'+playback+field('recordingKind','<select name="kind">'+opt('audio',t('recordingAudio'),kind==='audio')+opt('video',t('recordingVideo'),kind==='video')+'</select>')+
   field('recordingUpload','<input name="upload" type="file" accept="audio/*,video/*">'+restoredName('upload'))+
   field('recordingReuse','<select name="reuse">'+opt('',t('recordingKeep'))+items.map(item=>opt(item.name,item.label||item.name)).join('')+'</select>')+
   (next?button('recordingMore','more'):'')+field('recordingTitle','<input name="title" type="text" maxlength="200" value="'+esc(title)+'">')+
   field('recordingTranscript','<textarea name="transcript" rows="5">'+esc(words)+'</textarea>')+
   field('recordingPreload','<select name="preload">'+opt('none',t('recordingOnPlay'),node?.preload!=='metadata')+opt('metadata',t('recordingMetadata'),node?.preload==='metadata')+'</select>')+
   '<fieldset><legend>'+esc(t('recordingTracks'))+'</legend>'+tracks.map((track,i)=>'<label><input type="checkbox" name="removeTrack" value="'+i+'"> '+esc(t('recordingRemoveTrack')+' · '+trackName(track))+'</label>').join('')+
   field('recordingTrack','<input name="vtt" type="file" accept=".vtt,text/vtt">'+restoredName('vtt'))+
   field('recordingLanguage','<input name="language" type="text" placeholder="en" maxlength="64">')+
   field('recordingTrackLabel','<input name="trackLabel" type="text" maxlength="120">')+
   field('recordingTrackKind','<select name="trackKind">'+['captions','subtitles','descriptions'].map(k=>opt(k,t('recording'+k))).join('')+'</select>')+
   '<label><input name="defaultTrack" type="checkbox"> '+esc(t('recordingDefaultTrack'))+'</label></fieldset>'+
   '<div class="website-files-toolbar"><button type="submit">'+esc(t('recordingApply'))+'</button>'+button('recordingCancel','close')+'</div></form></section>';
 }
 async function apply(data,file,vtt){
  if(!doc||path()!==pagePath||site().revision!==revision)throw Error(t('changed'));
  await settle();
  let recoveredUpload;
  if(!file&&recovered?.files.upload){
   file=recovered.files.upload;recoveredUpload={...recoveryRef(),inputId:file.id};
  }
  if(!vtt&&recovered?.files.vtt){
   const track=recovered.files.vtt;vtt={size:track.size,text:async()=>(await request('recovery/track',{siteId:site().id,path:pagePath,...recoveryRef(),inputId:track.id})).text};
  }
  const kind=data.get('kind'),old=player();
  if(!['audio','video'].includes(kind))throw Error(t('failed'));
  const selected=data.get('reuse'),trackText=[];
  if(file&&selected)throw Error(t('recordingChooseOne'));
  const reuse=items.find(item=>item.name===selected);
  if(reuse&&reuse.contentType.split('/')[0]!==kind)throw Error(t('recordingWrongKind'));
  if(!file&&!reuse&&(!old||kind!==old.localName))throw Error(t('recordingChooseFile'));
  const copy=doc.cloneNode(true),before=authored(copy)[index],box=figure(before)??copy.createElement('figure');
  box.dataset.websiteRecording='';
  if(!box.isConnected){if(before)before.before(box);else (copy.querySelector('main')??copy.body).append(box);}
  const media=before?.localName===kind?before:copy.createElement(kind);
  if(before&&media!==before){for(const track of before.querySelectorAll('track'))media.append(track);before.replaceWith(media);}
  if(media.parentNode!==box)box.prepend(media);
  const title=String(data.get('title')??'').trim();
  let record=null;
  if(file||reuse){
   const name=reuse?.name??'recordings/'+id()+(kind==='audio'?'.wav':'.mp4');media.setAttribute('src',relative(pagePath,name));
   for(const source of media.querySelectorAll('source'))source.remove();
   if(file)record={name,size:file.size,label:title};
  }
  media.controls=true;media.preload=data.get('preload')==='metadata'?'metadata':'none';media.removeAttribute('autoplay');
  if(kind==='video')media.setAttribute('playsinline','');
  if(title)media.setAttribute('aria-label',title);else media.removeAttribute('aria-label');
  let label=caption(media);
  if(title&&!label){label=copy.createElement('figcaption');box.append(label);}
  if(label && label.textContent!==title)label.textContent=title;if(!title)label?.remove();
  const text=String(data.get('transcript')??'').trim();let details=box.querySelector(':scope > details[data-website-transcript]'),body=details?.querySelector(':scope > div');
  if(!text)details?.remove();else{
   if(!details){details=copy.createElement('details');details.dataset.websiteTranscript='';const summary=copy.createElement('summary');summary.textContent=t('recordingTranscript');body=copy.createElement('div');details.append(summary,body);box.append(details);}
   if(body&&transcriptText(body)!==text){body.replaceChildren(...text.split(/\n+/).map(line=>{const p=copy.createElement('p');p.textContent=line;return p;}));}
  }
  const removed=new Set(data.getAll('removeTrack'));[...media.querySelectorAll('track')].forEach((track,i)=>{if(removed.has(String(i)))track.remove();});
  if(vtt){
   const language=String(data.get('language')).trim(),trackLabel=String(data.get('trackLabel')).trim();
   if(!trackLabel||!language||!validLanguage(language)||vtt.size>2*1024*1024)throw Error(t('recordingTrackDetails'));
   const name='recordings/'+id()+'.vtt',track=copy.createElement('track');track.kind=data.get('trackKind');track.srclang=language;track.label=trackLabel;
   track.src=relative(pagePath,name);
   if(data.get('defaultTrack')){for(const other of media.querySelectorAll('track[default]'))other.removeAttribute('default');track.default=true;}
   media.append(track);trackText.push({name,text:await vtt.text()});
  }
  const header=new TextEncoder().encode(JSON.stringify({siteId:site().id,path:pagePath,expectedRevision:revision,historyKey:historyKey?.(),html:serializeWebsiteHTML(copy),css:css(),recording:record,recoveredUpload,tracks:trackText}));
  const size=new Uint8Array(4);new DataView(size.buffer).setUint32(0,header.length);
  const result=await request('media/save',new Blob(file&&!recoveredUpload?[size,header,file]:[size,header],{type:'application/octet-stream'}));
  await forget({saved:true});reset();adopt(result);close();
 }
 function bind(){
  const panel=document.querySelector('[data-recording-panel]');if(!panel)return;
  const f=panel.querySelector('form'),block=panel.querySelector('[data-recording-block]');
  if(recovered){
   for(const key of formFields)f.elements[key].value=recovered.fields[key];
   for(const input of f.querySelectorAll('[name=removeTrack]'))input.checked=recovered.removed.includes(Number(input.value));
   f.elements.defaultTrack.checked=recovered.defaultTrack;
  }
  f.oninput=f.onchange=()=>{modified=true;edited();};
  block.onchange=()=>{if(modified&&!confirm(t('recordingDiscard'))){block.value=String(index);return;}const target=Number(block.value);void run(async()=>{if(modified)await forget();index=target;modified=false;recovered=null;render();}).catch(e=>notify(e.message,true));};
  panel.querySelector('[data-recording-action="close"]').onclick=()=>{if(modified&&!confirm(t('recordingDiscard')))return;void run(async()=>{if(modified)await forget();reset();close();}).catch(e=>notify(e.message,true));};
  const more=panel.querySelector('[data-recording-action="more"]');
  if(more)more.onclick=()=>void run(async()=>{const count=items.length;await loadLibrary(next);for(const item of items.slice(count))f.elements.reuse.add(new Option(item.label||item.name,item.name));more.hidden=!next;}).catch(e=>notify(e.message,true));
  f.onsubmit=event=>{
   event.preventDefault();
   // The editor locks its fieldset while saving. Capture the successful controls first.
   const data=new FormData(f),file=f.elements.upload.files[0],vtt=f.elements.vtt.files[0];
   void run(()=>apply(data,file,vtt)).catch(e=>notify(e.message,true));
  };
 }
 return {open,reset,view,bind,restore,draft,dirty:()=>modified};
}

function validLanguage(language){try{return Intl.getCanonicalLocales(language).length===1;}catch{return false;}}
