import {createHash} from 'node:crypto';
import {PUBLIC_BOOK_SCRIPT} from './publication-browse.js';

// Retained editions keep their exact release bytes. Recognize reviewed earlier
// scripts by fingerprint; never accept arbitrary code from a valid manifest.
// Version 1 shipped in 016669b. Normalize only platform line endings for this
// admission check; publication hashes still verify the original, unmodified file.
const previous=new Set(['16cf9e3e807cda7d8b48d9b31abd79c1c864401905c415326fabc3f95efb18f8','1be4d7a9878adbd630f17d16214f79111f9898cc661f3f833bc4939dac0332b5']);
export function knownPublicBookScript(content){
 if(typeof content!=='string')return false;
 const source=content.replaceAll('\r\n','\n');
 return source===PUBLIC_BOOK_SCRIPT.replaceAll('\r\n','\n')||previous.has(createHash('sha256').update(source).digest('hex'));
}
