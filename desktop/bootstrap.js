import {app} from 'electron';
import {bootstrapDesktop} from './runtime-inventory.js';

// Version inspection exits before profile selection, instance locking, keyring
// access, window creation or service launch. It reports no user configuration.
await bootstrapDesktop({argv:process.argv,versions:process.versions,platform:process.platform,arch:process.arch,
 write:text=>new Promise((resolve,reject)=>process.stdout.write(text,error=>error?reject(error):resolve())),
 exit:code=>app.exit(code),start:()=>import('./main.js')});
