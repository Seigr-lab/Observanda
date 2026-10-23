// This is the complete finite computational decimal, not an error bound or
// the display-rounded text. Its pinned engine and policy remain separate.
const exact=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const spelling=value=>{
 if(typeof value!=='string'||!value.length||value.length>1048576)return false;
 const match=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:e([+-]?(?:0|[1-9][0-9]*)))?$/.exec(value);
 return !!match&&(match[1]===undefined||Number.isSafeInteger(Number(match[1])));
};
export const validApproximateResult=value=>exact(value,['version','kind','spelling','representation','radix'])&&value.version===1&&value.kind==='approximate-real'&&value.representation==='decimal'&&value.radix===10&&spelling(value.spelling);
