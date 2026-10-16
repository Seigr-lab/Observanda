import {digest} from '../src/storage-format.js';
import {MODULE_BYTES} from '../src/modules/capacity.js';
import {moduleEntityBytes} from '../src/modules/catalogue.js';
// Largest permitted cell JSON and retained source, with three-byte UTF-8 text.
// Character, row, column and source-byte limits remain the actual tool limits.
export function largestSheet(){
 const cells=Array.from({length:1000},()=>['界'.repeat(594)]);
 let remaining=600000-JSON.stringify(cells).length;
 for(const row of cells){const count=Math.min(2000-row[0].length,remaining);row[0]+='界'.repeat(count);remaining-=count;if(!remaining)break;}
 const bytes=Buffer.alloc(262144,97);
 return {name:'Largest supported sheet',engine:1,links:[],cells,original:{name:'retained.csv',size:bytes.length,sha256:digest(bytes),bytes:bytes.toString('base64')}};
}
export function largeCategory({nearLimit=false}={}){
 const choice=i=>String(i).padStart(10,'0')+'x'.repeat(150);
 const data={name:'Large category',description:'',archived:false,fields:[{key:'part',label:'Part',type:'select',unit:'',required:false,choices:[choice(0)]},...Array.from({length:24},(_,i)=>({key:'field_'+i,label:'Field '+i,type:'text',unit:'',required:false,choices:[]}))]};
 const entity={id:'00000000-0000-4000-8000-000000000000',type:'category',revision:1,createdAt:'2026-10-04T00:00:00.000Z',updatedAt:'2026-10-04T00:00:00.000Z',data},one=moduleEntityBytes(entity);
 data.fields[0].choices.push(choice(1));const step=moduleEntityBytes(entity)-one;
 // Retain 8 KiB for the existing storage envelope and later edits. The extra
 // choice test exercises the unchanged 64 MiB admission boundary.
 const count=nearLimit?1+Math.floor((MODULE_BYTES-8192-one)/step):30000;
 data.fields[0].choices=Array.from({length:count},(_,i)=>choice(i));return data;
}
