import {bookText} from './book-messages.js';
import {retryModule} from './retry-module.js';

const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let render=null,pending=null;
const load=retryModule(()=>import('./vendor/equations.js'),'/vendor/equations.js');
const ready=()=>render?Promise.resolve(render):pending??=load().then(module=>render=module.renderEquation).finally(()=>{pending=null;});
// Static publication/PDF rendering must remain complete and synchronous after
// module admission. Browsers fetch the engine only when an equation is shown.
if(typeof document==='undefined')await ready();
const observed=new WeakSet(),inflight=new WeakSet();

async function fill(node){
 if(inflight.has(node)||!node.hasAttribute('data-equation-source'))return;
 const source=node.getAttribute('data-equation-source');inflight.add(node);
 try{
  let renderer;
  try{renderer=await ready();}
  catch{
   if(node.getAttribute('data-equation-source')!==source)return;
   node.innerHTML='<code>'+esc(source)+'</code><p role="status">'+esc(bookText('equationUnsupported'))+'</p><button type="button" class="button">'+esc(bookText('equationRetry'))+'</button>';
   node.querySelector('button').addEventListener('click',()=>void fill(node));return;
  }
  if(node.getAttribute('data-equation-source')!==source)return;
  try{node.innerHTML=renderer(source);}catch{node.innerHTML='<p role="status">'+esc(bookText('equationUnsupported'))+'</p><code>'+esc(source)+'</code>';}
  node.removeAttribute('data-equation-source');
 }finally{inflight.delete(node);}
}

function visit(root){
 if(root.nodeType!==1&&root.nodeType!==9)return;
 if(root.hasAttribute?.('data-equation-source'))void fill(root);
 for(const node of root.querySelectorAll('[data-equation-source]'))void fill(node);
}

// Watch inserted fragments, not repeated whole-document scans. This also covers
// content dialogs and editor node views inserted after an asynchronous request.
export function observeEquations(doc){
 if(!doc?.defaultView||observed.has(doc))return;
 observed.add(doc);visit(doc);
 const observer=new doc.defaultView.MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)visit(node);});
 observer.observe(doc,{subtree:true,childList:true});
 doc.defaultView.addEventListener('pagehide',()=>{observer.disconnect();observed.delete(doc);},{once:true});
}

export function renderEquation(source){
 if(render)return render(source);
 observeEquations(document);
 return '<span data-equation-source="'+esc(source)+'"><code>'+esc(source)+'</code></span>';
}
