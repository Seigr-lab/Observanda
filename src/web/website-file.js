// Website downloads retain the selected original, including embedded metadata.
// Public paths use an inert extension; the download attribute supplies its name.
export const validDownloadName=value=>typeof value==='string'&&Boolean(value.trim())&&value.length<=300&&!/[\\/\x00-\x1f\x7f]/.test(value)&&value!=='.'&&value!=='..';
export const validDownloadInfo=value=>validDownloadName(value?.name)&&Number.isSafeInteger(value.size)&&value.size>=0&&/^[a-f0-9]{64}$/.test(value.sha256??'');
export const downloadPath=id=>'downloads/'+id+'.bin';
export const isDownloadPath=name=>/^downloads\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.bin$/.test(name);
export const downloadInfo=metadata=>({name:metadata.name,size:metadata.bytes,sha256:metadata.sha256});
export function downloadSize(size){const power=size?Math.min(4,Math.floor(Math.log(size)/Math.log(1024))):0;return new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(size/1024**power)+' '+['B','KiB','MiB','GiB','TiB'][power];}
