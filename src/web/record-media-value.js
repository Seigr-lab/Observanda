// Media bytes, identity and kind are owned by the existing attachment. This
// selected value can change only its description and publication availability.
export const mediaDetails=({caption,alt,transcript,share,sharePdf})=>({caption,alt,transcript,share,...(sharePdf===undefined?{}:{sharePdf})});
export function validMediaDetails(value){
 return value&&['alt,caption,share,transcript','alt,caption,share,sharePdf,transcript'].includes(Object.keys(value).sort().join())&&(!Object.hasOwn(value,'sharePdf')||typeof value.sharePdf==='boolean')&&typeof value.share==='boolean'&&['caption','alt','transcript'].every(key=>typeof value[key]==='string'&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value[key]));
}
