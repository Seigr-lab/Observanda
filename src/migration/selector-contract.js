// RFC 6901 string form (https://www.rfc-editor.org/rfc/rfc6901). Decode in this order: ~01 denotes the literal key ~1.
export function pointerParts(value){
 if(typeof value!=='string'||value.length>2048||value!==''&&!value.startsWith('/')||/~(?![01])/u.test(value))return null;
 return value===''?[]:value.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
}
export const selectorKey=s=>JSON.stringify(s.kind==='bytes'?[s.kind,s.offset,s.length]:[s.kind,s.value??'']);
export const selectorLimits=Object.freeze({perFile:1000,jsonDepth:128,htmlBytes:8*1024*1024,htmlNodes:100000});
