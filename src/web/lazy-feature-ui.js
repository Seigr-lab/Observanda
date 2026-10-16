// UI code is fetched on first use, independently of dashboard data adapters.
export function lazyFeatureUI({load,enabled,handles}){
 let instance=null,pending=null;
 const ready=async()=>{if(instance)return instance;if(!enabled())throw new Error('Enable this module in Preferences to use it.');if(!pending)pending=load().then(value=>instance=value).finally(()=>pending=null);return pending;};
 return new Proxy({ready},{
  get(target,key){
   if(key==='ready')return ready;
   if(key==='action')return async button=>{if(!enabled()||!instance&&!handles(button.dataset.action))return false;return (await ready()).action(button);};
   if(key==='submit')return async(form,data)=>{if(!enabled()||!instance)return false;return instance.submit?.(form,data)??false;};
   if(['load','save','discard'].includes(key))return async(...args)=>(await ready())[key](...args);
   return (...args)=>instance?.[key]?.(...args)??(key==='view'?'<p>Opening module…</p>':false);
  }
 });
}
