import {withOperationProgress} from './operation-progress.js';
import messages from './web/locales/en/storageProgress.json' with {type:'json'};
import common from './web/locales/en/operationProgress.json' with {type:'json'};
import {translator} from './web/i18n/runtime.js';
const text=translator('en',{...common,...messages});

// Keep machine-readable results on stdout. Repeated stderr observations expose
// inactivity as well as work; neither the timer nor a stage change claims success.
export async function withConsoleProgress(operation,{write=line=>process.stderr.write(line+'\n')}={}){
 let latest,observed=Date.now(),printed=false;
 const render=()=>{
  if(!latest)return;const now=Date.now(),total=latest.total,known=Number.isSafeInteger(total);
  write(text('consoleLine',{
   stage:text(latest.stage),count:text(known?'countTotal':'count',{count:latest.completed??0,...(known?{total}:{}),unit:text(latest.unit??'items')}),
   objects:latest.activity?.objects??0,bytes:latest.activity?.bytes??0,
   seconds:Math.floor(((latest.elapsedMs??0)+now-observed)/1000),quiet:Math.floor(Math.max(0,now-(latest.advancedAt??observed))/1000)
  }));printed=true;
 };
 const timer=setInterval(render,1000);timer.unref();
 try{return await withOperationProgress(value=>{if(value.stage==='preparing')return;latest=value;observed=Date.now();if(!printed)render();},operation);}
 finally{clearInterval(timer);render();}
}
