// Own only generated preview URLs and cancellable rendering. Document edits
// remain with the editor; an obsolete render can never replace a newer one.
export function pdfPreviewController({request,onChange=()=>{},delay=800,createURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url)}){
 let visible=false,current=null,pending=null,controller=null,timer=null,generation=0,error='';
 function cancel(){generation++;clearTimeout(timer);timer=null;controller?.abort();controller=null;pending=null;}
 function invalidate(){cancel();error='';onChange();}
 function render(id,revision){
  clearTimeout(timer);timer=null;
  if(current?.id===id&&current.revision===revision)return Promise.resolve(current);
  if(pending?.id===id&&pending.revision===revision)return pending.promise;
  cancel();error='';const epoch=generation,abort=new AbortController();controller=abort;
  const promise=Promise.resolve().then(()=>request(id,revision,abort.signal)).then(blob=>{
   if(epoch!==generation||abort.signal.aborted)throw new DOMException('Preview cancelled','AbortError');
   const previous=current;current={id,revision,blob,url:createURL(blob)};onChange();if(previous)revokeURL(previous.url);return current;
  }).catch(failure=>{if(epoch===generation&&!abort.signal.aborted)error=failure.message??String(failure);throw failure;}).finally(()=>{if(epoch===generation){pending=null;controller=null;onChange();}});
  pending={id,revision,promise};onChange();return promise;
 }
 function refresh(id,revision){
  if(!visible||current?.id===id&&current.revision===revision||pending?.id===id&&pending.revision===revision)return;
  cancel();timer=setTimeout(()=>{timer=null;void render(id,revision).catch(()=>{});},delay);onChange();
 }
 function show(id,revision){visible=true;return render(id,revision);}
 function close(){visible=false;cancel();onChange();}
 function reset(){close();if(current)revokeURL(current.url);current=null;error='';onChange();}
 return {show,render,refresh,invalidate,close,reset,state:()=>({visible,current,busy:pending!==null,scheduled:timer!==null,error})};
}
