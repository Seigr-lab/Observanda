// HTTP connection lifetime is independent of a handler's asynchronous work.
// Stop accepting connections, finish active responses, and close sockets as
// they become idle. Browser keep-alive traffic must not postpone shutdown.
export function httpDrain(server){
 const sockets=new Map();let stopping=false,closing=null;
 server.on('connection',socket=>{
  sockets.set(socket,0);socket.once('close',()=>sockets.delete(socket));
  if(stopping)socket.end();
 });
 server.prependListener('request',(req,res)=>{
  const socket=req.socket;sockets.set(socket,(sockets.get(socket)??0)+1);
  if(stopping)res.setHeader('Connection','close');
  let finished=false;
  const finish=()=>{
   if(finished)return;finished=true;
   const active=Math.max(0,(sockets.get(socket)??1)-1);
   if(sockets.has(socket))sockets.set(socket,active);
   if(stopping&&!active)socket.end();
  };
  res.once('finish',finish);res.once('close',finish);
 });
 return {close(){
  if(closing)return closing;stopping=true;
  closing=new Promise(resolve=>server.close(resolve));
  for(const [socket,active] of sockets)if(!active)socket.end();
  server.closeIdleConnections();return closing;
 }};
}
