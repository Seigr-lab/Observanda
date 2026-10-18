import {t} from './i18n/index.js';
let library;
const pdfLibrary=()=>library??=(async()=>{
 const url='/vendor/pdfjs/pdf.js',pdf=await import(url);
 pdf.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/pdf.worker.js';return pdf;
})().catch(error=>{library=null;throw error;});
const batch=6,maximumPages=100000;
export function pdfPageNavigator({getHost,getFrame,esc}){
 let current=null,document=null,loading=null,controller=null,generation=0,range=0,page=1,error='',rendering=null,disposed=false;
 const tr=(key,values)=>t('pdfEditor',key,values),button=(key,command,disabled=false)=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="pdf-page-'+command+'"'+(disabled?' disabled':'')+'>'+esc(tr(key))+'</button>';
 function cancel(){generation++;controller?.abort();controller=null;rendering?.cancel();rendering=null;const old=loading;loading=null;document=null;if(old)void old.destroy().catch(()=>{});}
 function view(){
  if(!current)return '';
  if(error)return '<p role="status">'+esc(tr('pagePreviewError'))+'</p>'+button('retry','retry');
  if(!document)return '<p role="status">'+esc(tr('pagePreviewLoading'))+'</p>';
  const stop=Math.min(range+batch,document.numPages);
  return '<nav aria-label="'+esc(tr('pageNavigation'))+'"><div class="pdf-toolbar">'+button('previous','previous',range===0)+button('next','next',stop===document.numPages)+'<label>'+esc(tr('pageGoTo'))+'<input type="number" min="1" max="'+document.numPages+'" value="'+page+'" data-pdf-page-number></label>'+button('pageOpen','open')+'</div><p role="status">'+esc(tr('pageRange',{first:range+1,last:stop,total:document.numPages}))+'</p><div class="pdf-thumbnails">'+Array.from({length:stop-range},(_,at)=>{const number=range+at+1;return '<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="pdf-page-select" data-page="'+number+'"'+(number===page?' aria-current="page"':'')+'><canvas data-pdf-thumbnail="'+number+'" aria-hidden="true"></canvas><span>'+esc(tr('pageNumber',{number}))+'</span></button>';}).join('')+'</div></nav>';
 }
 function draw(){const host=getHost();if(host)host.innerHTML=view();}
 async function thumbnails(){
  if(!document||!getHost())return;rendering?.cancel();const epoch=generation,selected=document,first=range;
  for(let at=first;at<Math.min(first+batch,selected.numPages);at++){
   if(epoch!==generation||first!==range||disposed)return;
   const canvas=getHost()?.querySelector('[data-pdf-thumbnail="'+(at+1)+'"]');if(!canvas)continue;
   const pdfPage=await selected.getPage(at+1);if(epoch!==generation||first!==range||disposed)return;
   const original=pdfPage.getViewport({scale:1}),scale=Math.min(112/original.width,158/original.height),viewport=pdfPage.getViewport({scale});
   canvas.width=Math.max(1,Math.ceil(viewport.width*2));canvas.height=Math.max(1,Math.ceil(viewport.height*2));canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
   const task=pdfPage.render({canvas,viewport,transform:[2,0,0,2,0,0],annotationMode:0});rendering=task;
   try{await task.promise;}finally{if(rendering===task)rendering=null;pdfPage.cleanup();}
  }
 }
 function renderThumbnails(){const epoch=generation,first=range;void thumbnails().catch(failure=>{if(epoch===generation&&first===range&&failure.name!=='RenderingCancelledException'&&!disposed&&document){error=failure.message;draw();}});}
 function bind(){draw();renderThumbnails();}
 async function load(value){
  cancel();current=value;range=0;page=1;error='';const epoch=generation,abort=new AbortController();controller=abort;draw();
  try{
   const pdf=await pdfLibrary();abort.signal.throwIfAborted();const data=new Uint8Array(await value.blob.arrayBuffer());abort.signal.throwIfAborted();
   const task=pdf.getDocument({data,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWasm:false,useWorkerFetch:false,isOffscreenCanvasSupported:false,maxImageSize:64*1024*1024,stopAtErrors:true});loading=task;
   const loaded=await task.promise;if(epoch!==generation||disposed){await task.destroy();return;}
   if(!Number.isSafeInteger(loaded.numPages)||loaded.numPages<1||loaded.numPages>maximumPages)throw Error('PDF page limit');document=loaded;bind();
  }catch(failure){if(epoch===generation&&!abort.signal.aborted&&!disposed){error=failure.message;draw();}}
 }
 function update(state){
  if(disposed)return;if(!state.visible||!state.current){if(current){cancel();current=null;error='';draw();}return;}
  if(current?.url!==state.current.url)void load(state.current);
 }
 function select(number){
  if(!document||!Number.isSafeInteger(number)||number<1||number>document.numPages)return;
  page=number;const next=Math.floor((number-1)/batch)*batch;if(next!==range){range=next;draw();renderThumbnails();}else{const host=getHost();for(const item of host?.querySelectorAll('[data-page]')??[])if(Number(item.dataset.page)===number)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');const input=host?.querySelector('[data-pdf-page-number]');if(input)input.value=String(number);}
  const frame=getFrame();if(frame&&current)frame.src=current.url+'#page='+number;
 }
 function action(name,node){
  if(!name.startsWith('pdf-page-'))return false;const command=name.slice(9);
  if(command==='retry'){if(current)void load(current);return true;}if(!document)return true;
  if(command==='select')select(Number(node.dataset.page));else if(command==='open')select(Number(getHost()?.querySelector('[data-pdf-page-number]')?.value));
  else if(command==='previous'||command==='next'){range=Math.max(0,Math.min(Math.floor((document.numPages-1)/batch)*batch,range+(command==='next'?batch:-batch)));draw();renderThumbnails();}
  return true;
 }
 return {view,update,bind,action,frameURL:()=>current?current.url+'#page='+page:null,dispose(){disposed=true;cancel();current=null;}};
}
