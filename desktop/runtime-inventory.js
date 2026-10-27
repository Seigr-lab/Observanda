const names=['electron','chrome','node','v8','openssl','uv','zlib'];
export function desktopRuntimeVersions(versions){
 const result={};
 for(const name of [...names,...(versions.undici?['undici']:[])]){
  const value=versions[name];if(typeof value!=='string'||!/^\d[\dA-Za-z.+_-]{0,99}$/.test(value))throw Error('Desktop runtime version is not identifiable.');
  result[name]=value;
 }
 return result;
}
export async function bootstrapDesktop({argv,versions,platform,arch,write,exit,start}){
 if(!argv.includes('--observanda-runtime-inventory'))return start();
 try{await write(JSON.stringify({format:1,platform,arch,versions:desktopRuntimeVersions(versions)})+'\n');exit(0);}
 catch{exit(1);}
}
