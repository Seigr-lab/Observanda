// A newly uploaded download is linked before its stored name is known. The
// page carries this placeholder file name until the service stores the file and
// substitutes the unique name in the same save.
export const pendingDownloadName='observanda-pending-download';

export function downloadSize(bytes){
 if(!Number.isFinite(bytes)||bytes<0)return '';
 const units=['B','KB','MB','GB'];let value=bytes,unit=0;
 while(value>=1024&&unit<units.length-1){value/=1024;unit++;}
 return (unit?value.toFixed(value<10?1:0):String(value))+' '+units[unit];
}
export const downloadKind=name=>{const match=/\.([a-z0-9]{1,12})$/i.exec(name);return match?match[1].toUpperCase():'';};
