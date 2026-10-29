import './i18n/catalogues/supportEditors.js';
import {t} from './i18n/index.js';
const message=key=>t('supportEditors',key);
const esc=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
// UI code is fetched on first use, independently of dashboard data adapters.
export function lazyFeatureUI({load,enabled,handles}){
 let instance=null,pending=null;
 const ready=async()=>{if(instance)return instance;if(!enabled())throw new Error(message('moduleEnableFirst'));if(!pending)pending=load().then(value=>instance=value).finally(()=>pending=null);return pending;};
 return new Proxy({ready},{
  get(target,key){
   if(key==='ready')return ready;
   if(key==='action')return async button=>{if(!enabled()||!instance&&!handles(button.dataset.action))return false;return (await ready()).action(button);};
   if(key==='submit')return async(form,data)=>{if(!enabled()||!instance)return false;return instance.submit?.(form,data)??false;};
   if(['load','save','discard'].includes(key))return async(...args)=>(await ready())[key](...args);
   return (...args)=>instance?.[key]?.(...args)??(key==='view'?'<p>'+esc(message('moduleOpening'))+'</p>':false);
  }
 });
}
