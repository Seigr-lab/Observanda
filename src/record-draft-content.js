import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import parser from 'stream-json/parser.js';
import streamArray from 'stream-json/streamers/stream-array.js';
import {RecordDraftChunks} from './record-draft-chunks.js';
import {AppError} from './errors.js';

// Parse one changed record at a time. Transfer and durable storage follow fixed
// blocks; selected-record validation still follows the record's domain model.
export async function* transferredDraftChanges(workspace,id,content,{signal}={}){
 const chunks=new RecordDraftChunks(workspace,id),hash=createHash('sha256');
 async function* input(){for await(const bytes of chunks.chunks(content,{signal})){hash.update(bytes);yield bytes;}}
 const source=Readable.from(input()),tokens=parser.asStream(),rows=streamArray.asStream();let streamError;
 const completion=pipeline(source,tokens,rows,{signal}).catch(error=>{streamError=error;});
 try{
  for await(const {value} of rows){signal?.throwIfAborted();yield value;}
  await completion;if(streamError)throw streamError;if(hash.digest('hex')!==content.sha256)throw new AppError('CATALOGUE_DAMAGED');
 }catch(error){if(signal?.aborted)throw signal.reason;if(error instanceof AppError)throw error;throw new AppError('FORMAT');}
 finally{source.destroy();tokens.destroy();rows.destroy();await completion;}
}
