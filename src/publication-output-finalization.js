// Rendering and metadata insertion stay serial. Only fully consumed files may
// overlap durable completion, and privacy readback admits one plaintext file.
export class PublicationOutputFinalization{
 constructor({signal}={}){this.signal=signal;this.pending=new Set();this.active=new Set();this.failure=null;this.privacy=Promise.resolve();}
 check(){if(this.failure)throw this.failure;this.signal?.throwIfAborted();}
 write(operation,validate=async()=>{}){
  this.check();let expose,refuse;
  const ready=new Promise((resolve,reject)=>{expose=resolve;refuse=reject;});
  const completed=Promise.resolve().then(()=>operation(async saved=>{
   this.check();while(this.active.size>=4){await Promise.race(this.active);this.check();}
   this.active.add(tracked);expose(saved);
  })).then(saved=>{
   const checked=this.privacy.then(async()=>{this.check();await validate(saved);});
   this.privacy=checked.catch(()=>{});return checked;
  });
  const tracked=completed.catch(error=>{this.failure??=error;refuse(error);}).finally(()=>{this.active.delete(tracked);this.pending.delete(tracked);});
  this.pending.add(tracked);return ready;
 }
 async drain(){while(this.pending.size)await Promise.all(this.pending);this.check();}
}
