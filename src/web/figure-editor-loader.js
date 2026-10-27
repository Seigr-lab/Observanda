import {figureIssues} from './figure-model.js';
import {t} from './i18n/index.js';
import {retryModule} from './retry-module.js';

const text=key=>t('recordContent',key);
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Full-record authoring is used for new records. Neither startup nor reading
// needs its controls. A delayed download may populate only the form that asked
// for it; release invalidates even a navigation away and back to the same record.
export function figureEditor(options,{load=retryModule(()=>import('./figure-editor.js'),'/figure-editor.js'),context=options.context,root=()=>document}={}){
 let instance=null,module=null,pending=null,active=null,generation=0,shown=false;
 const busy=()=>options.busyChanged?.();
 const ready=()=>module?Promise.resolve(module):pending??=Promise.resolve().then(load).then(value=>module=value).finally(()=>{pending=null;});
 const current=ticket=>ticket.generation===generation&&ticket.context===context()&&ticket.host.isConnected;
 async function bind(){
  const host=root().querySelector('[data-record-figure-editor]');if(!host)return;
  if(instance){instance.bind();return;}
  if(active?.host===host)return;
  const ticket={host,generation,context:context()};active=ticket;busy();
  host.innerHTML='<p role="status">'+esc(text('figuresLoading'))+'</p>';host.setAttribute('aria-busy','true');
  try{
   const loaded=await ready();if(!current(ticket))return;
   const editor=loaded.figureEditor(options);
   try{host.innerHTML=editor.view();editor.bind();instance=editor;}
   catch(error){editor.release();throw error;}
  }catch{
   if(current(ticket))host.innerHTML='<p role="status">'+esc(text('figuresLoadFailed'))+'</p><button type="button" class="button" data-action="record-figure-editor-retry">'+esc(text('figuresRetry'))+'</button>';
  }finally{
   if(current(ticket))host.removeAttribute('aria-busy');
   if(active===ticket){active=null;busy();}
  }
 }
 return {
  view(){shown=true;return '<div data-record-figure-editor>'+ (instance?instance.view():'<p role="status">'+esc(text('figuresLoading'))+'</p>')+'</div>';},
  bind,
  release(){generation++;shown=false;active=null;instance?.release();},
  isBusy:()=>Boolean(active)||Boolean(instance?.isBusy()),
  input:control=>instance?.input(control)??false,
  action(control){if(control.dataset.action==='record-figure-editor-retry')return bind().then(()=>true);return instance?.action(control)??Promise.resolve(false);},
  validate(){
   if(shown&&!instance)throw Error(text(active?'figuresLoading':'figuresLoadFailed'));
   if(instance)return instance.validate();
   // Saves outside the full form retain validation without downloading its UI.
   for(const figure of options.getFigures()){const issues=figureIssues(figure);if(issues.length)throw Error(figure.title+': '+issues[0]);}
  }
 };
}
