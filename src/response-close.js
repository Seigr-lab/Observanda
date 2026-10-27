// HTTP dispatch, admission and domain transports share one close subscription.
// Each retains its own cancellation decision (including durable operations
// allowed to outlive the connection), and releases its callback when done.
const responses=new WeakMap();

export function onResponseClose(response,listener) {
 if(response.destroyed||response.closed){listener();return ()=>{};}
 let state=responses.get(response);
 if(!state) {
  state={listeners:new Set(),closed:false};
  state.close=()=>{
   state.closed=true;responses.delete(response);
   const listeners=[...state.listeners];state.listeners.clear();
   for(const callback of listeners)callback();
  };
  responses.set(response,state);response.once('close',state.close);
 }
 state.listeners.add(listener);
 let active=true;
 return ()=>{
  if(!active)return;active=false;
  state.listeners.delete(listener);
  if(!state.closed&&!state.listeners.size){response.off('close',state.close);if(responses.get(response)===state)responses.delete(response);}
 };
}
