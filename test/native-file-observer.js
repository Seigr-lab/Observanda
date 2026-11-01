import filesystem from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';

// Observe admitted handle operations regardless of how their parent was opened.
// Include full-verification Node readers without replacing either I/O path.
export async function observeNativeFiles(t,service,directory,operation){
 const opened=await service.open(directory),identity=opened.identity,prototype=Object.getPrototypeOf(opened),original=prototype.file;await opened.close();
 const native=t.mock.method(prototype,'file',function(member,options={}){const open=()=>original.call(this,member,options);return this.identity===identity?operation(path.join(directory,member),options.mode==='exclusive'?'wx+':options.mode==='update'?'r+':'r',open):open();});
 const originalRead=filesystem.open,reads=t.mock.method(filesystem,'open',function(file,...args){const open=()=>originalRead.call(this,file,...args);return args[0]==='r'&&path.dirname(file)===directory?operation(file,'r',open):open();});
 syncBuiltinESMExports();return {mock:{restore(){native.mock.restore();reads.mock.restore();syncBuiltinESMExports();}}};
}
