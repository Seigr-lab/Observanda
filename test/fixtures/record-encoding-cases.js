// Deterministic inputs whose block identities were captured from the original
// record writer before bounded encoding was connected to application storage.
export function recordEncodingCases(){
 const values=[{id:'record',title:'A retained result',sections:[{id:'section',body:'Exact values: 0.000000000000000000001'}]},JSON.parse('{"10":"ten","2":"two","__proto__":{"value":3},"4294967295":4,"a":5,"03":6,"0":7}')];
 for(const length of [8188,8189,8190,8191,8192,32764,32765,32766,32767,32768,65533,65534,65535,65536,1048573,1048574,1048575,1048576]){
  values.push('x'.repeat(length));values.push(('\ud83d\udd2c\ud800\udfff\u0000\b\t\r\n"\\\u754c').repeat(Math.ceil(length/12)));
 }
 for(const count of [31,32,33,1023,1024,1025])values.push({sections:Array.from({length:count},(_,i)=>({id:String(i),body:'v'.repeat(400)}))});
 return values;
}
