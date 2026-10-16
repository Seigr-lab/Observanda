export const decimal=v=>typeof v==='string'&&/^-?(?:0|[1-9]\d{0,39})(?:\.\d{1,18})?$/.test(v);
function parts(v){if(!decimal(v))throw new TypeError('Invalid decimal quantity.');const [whole,fraction='']=v.split('.');return {n:BigInt(whole+fraction),scale:fraction.length};}
function format(n,scale){const sign=n<0n?'-':'';let digits=(n<0n?-n:n).toString().padStart(scale+1,'0');if(scale)digits=digits.slice(0,-scale)+'.'+digits.slice(-scale);return sign+digits.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');}
export function add(a,b){a=parts(a);b=parts(b);const scale=Math.max(a.scale,b.scale);return format(a.n*10n**BigInt(scale-a.scale)+b.n*10n**BigInt(scale-b.scale),scale);}
export function multiply(a,b){a=parts(a);b=parts(b);const value=format(a.n*b.n,a.scale+b.scale);if(!decimal(value))throw new RangeError('Quantity exceeds supported precision.');return value;}
export const negate=v=>v.startsWith('-')?v.slice(1):v==='0'?'0':'-'+v;
export const compare=(a,b)=>{const n=parts(add(a,negate(b))).n;return n<0n?-1:n>0n?1:0;};
// Without a location filter, transfers cancel out and never inflate owned stock.
// Older movements without a placement remain at the resource's saved owner.
export function balance(entities,resourceId,projectIds=null){
 const owner=entities.find(e=>e.type==='resource'&&e.id===resourceId)?.data.projectId??null;
 const includes=d=>!projectIds||projectIds.has(Object.hasOwn(d,'projectId')?d.projectId:owner);
 const movements=entities.filter(e=>e.type==='movement'&&e.data.resourceId===resourceId&&includes(e.data));
 const reservations=entities.filter(e=>e.type==='reservation'&&e.data.resourceId===resourceId&&e.data.status==='active'&&includes(e.data));
 let physical=movements.reduce((sum,e)=>add(sum,e.data.delta),'0');
 if(projectIds)for(const {data:d} of entities.filter(e=>e.type==='stock-transfer'&&e.data.resourceId===resourceId)){
  if(projectIds.has(d.fromProjectId))physical=add(physical,negate(d.quantity));
  if(projectIds.has(d.toProjectId))physical=add(physical,d.quantity);
 }
 const reserved=reservations.reduce((sum,e)=>add(sum,e.data.quantity),'0');
 return {physical,reserved,available:add(physical,negate(reserved))};
}
