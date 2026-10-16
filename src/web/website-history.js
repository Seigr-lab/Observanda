// Transient authoring history. Budgets count UTF-16 serialized snapshot payload,
// not total browser heap. The live draft is always owned by the editor.
export class WebsiteHistory {
 #past=[];#future=[];#bytes=0;#key=null;#trimmed=false;
 constructor({maxEntries=50,maxBytes=16*1024*1024}={}){
  if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxBytes)||maxBytes<1)throw new TypeError('Invalid history budget');
  this.maxEntries=maxEntries;this.maxBytes=maxBytes;
 }
 get undoCount(){return this.#past.length;}
 get redoCount(){return this.#future.length;}
 get bytes(){return this.#bytes;}
 get trimmed(){return this.#trimmed;}
 clear(){this.#past=[];this.#future=[];this.#bytes=0;this.#key=null;this.#trimmed=false;}
 #drop(list){const entry=list.shift();if(entry)this.#bytes-=entry.bytes;}
 #empty(list){while(list.length)this.#drop(list);}
 #retain(list,value,other){
  const bytes=JSON.stringify(value).length*2;
  if(bytes>this.maxBytes){
   // Keeping older reciprocal steps would skip over the uncaptured state.
   this.#empty(list);this.#trimmed=true;return;
  }
  list.push({value,bytes});this.#bytes+=bytes;
  while(this.#bytes>this.maxBytes||this.undoCount+this.redoCount>this.maxEntries){
   this.#drop(other.length?other:list);this.#trimmed=true;
  }
 }
 checkpoint(capture,key=null){
  this.#empty(this.#future);
  if(!key||key!==this.#key)this.#retain(this.#past,capture(),this.#future);
  this.#key=key;
 }
 step(direction,capture){
  if(!['undo','redo'].includes(direction))throw new TypeError('Invalid history direction');
  const source=direction==='undo'?this.#past:this.#future,target=direction==='undo'?this.#future:this.#past;
  if(!source.length)return null;
  const current=capture(),entry=source.pop();this.#bytes-=entry.bytes;
  this.#retain(target,current,source);this.#key=null;return entry.value;
 }
}
