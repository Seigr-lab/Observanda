// A packed record occupies a declared number of array elements. Offsets and
// widths describe source positions, never bytes or converted numeric values.
export function packedRecords(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['offset','width','count'].includes(k))||!Number.isSafeInteger(value.offset)||value.offset<0||!Number.isSafeInteger(value.width)||value.width<1||!Number.isSafeInteger(value.count)||value.count<0||!Number.isSafeInteger(value.offset+value.width*value.count))throw Error('Invalid packed record range');
 return {offset:value.offset,width:value.width,count:value.count};
}
export const packedField=(parts,packing)=>parts.length>0&&/^(0|[1-9][0-9]*)$/.test(parts[0])&&Number(parts[0])<packing.width;
