// Fetch a dialog only when opened. Delayed loading must not turn an action
// from a previous owner or route into an action in the current workspace.
export function deferredDialog({load,context,changed}) {
 let instance=null,pending=null;
 const ready=()=>pending??=Promise.resolve().then(load).finally(()=>{pending=null;});
 return {
  current:()=>instance,
  loading:()=>Boolean(pending),
  async invoke(method,...args) {
   const before=context();
   if(!instance) {
    const create=await ready();
    if(before!==context())throw changed();
    instance??=create();
   }
   if(before!==context())throw changed();
   return instance[method](...args);
  }
 };
}
