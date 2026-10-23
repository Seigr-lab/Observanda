// Full result text stays in the response. Expansion is explicit and tied to that answer.
const selected=new WeakMap();
export function paintCalculatorResult(node,{message,answer,text}){
 const output=node.querySelector('output'),full=typeof answer?.result==='string'&&!answer.error?message:null,long=full!==null&&full.length>1024;let details=node.querySelector('[data-calc-complete-result]');
 if(selected.get(node)!==answer){if(details){details.open=false;details.querySelector('pre').textContent='';}selected.set(node,answer);}
 const display=long?full.slice(0,1024)+'\u2026 '+text('resultPreview',{count:full.length}):message;
 if(output.textContent!==display)output.textContent=display;
 if(!long){if(details)details.hidden=true;return;}
 if(!details){details=document.createElement('details');details.dataset.calcCompleteResult='';const summary=document.createElement('summary'),value=document.createElement('pre');value.tabIndex=0;value.setAttribute('role','region');details.append(summary,value);node.append(details);details.addEventListener('toggle',()=>{const current=selected.get(node);value.textContent=details.open&&current&&!current.error?(current.approximation?'\u2248 ':'')+current.result:'';});}
 details.hidden=false;details.querySelector('summary').textContent=text('completeResult',{count:full.length});details.querySelector('pre').setAttribute('aria-label',text('completeResult',{count:full.length}));
}
