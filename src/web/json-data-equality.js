// Compare the persisted JSON representation without serializing either value.
// Keep property order and JSON's null/undefined/number spelling semantics: dirty
// tracking and reconciliation must agree with the previously saved document.
const invalid=()=>{throw new TypeError('Expected JSON data.');};
const scalar=value=>typeof value==='number'&&!Number.isFinite(value)?null:value;
function child(value,key){
 const descriptor=Object.getOwnPropertyDescriptor(value,key);
 if(descriptor&&!Object.hasOwn(descriptor,'value'))invalid();
 return descriptor?.value;
}
function object(value){
 if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))invalid();
 if(Object.getOwnPropertySymbols(value).length)invalid();
}
export function sameJSONData(left,right){
 const parentsLeft=new Set(),parentsRight=new Set(),stack=[];
 for(;;){
  left=scalar(left);right=scalar(right);
  if(left!==right){
   if(['function','symbol','bigint'].includes(typeof left)||['function','symbol','bigint'].includes(typeof right))invalid();
   if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
   object(left);object(right);
   const array=Array.isArray(left);if(array!==Array.isArray(right))return false;
   if(parentsLeft.has(left)||parentsRight.has(right))invalid();
   const keysLeft=array?null:Object.keys(left).filter(key=>child(left,key)!==undefined),keysRight=array?null:Object.keys(right).filter(key=>child(right,key)!==undefined);
   const length=array?left.length:keysLeft.length;
   if(length!==(array?right.length:keysRight.length))return false;
   parentsLeft.add(left);parentsRight.add(right);
   stack.push({left,right,array,keysLeft,keysRight,length,index:0});
  }
  let next=false;
  while(stack.length){
   const frame=stack.at(-1);
   if(frame.index===frame.length){parentsLeft.delete(frame.left);parentsRight.delete(frame.right);stack.pop();continue;}
   const index=frame.index++,key=frame.array?String(index):frame.keysLeft[index];
   if(!frame.array&&key!==frame.keysRight[index])return false;
   left=child(frame.left,key);right=child(frame.right,key);
   if(frame.array){left??=null;right??=null;}
   next=true;break;
  }
  if(!next)return true;
 }
}
