// A transaction may involve several explicitly selected schemas. Serialize
// schema selection with each query, including nested cursor reads. A shared
// client is used only by this session until commit/rollback.
import {AppError} from './errors.js';
export function databaseSchemaSession(connection){
 let tail=Promise.resolve(),selected=null,active=true;
 const check=()=>{if(!active)throw new AppError('INVALID');};
 return {
  close(){active=false;},
  invalidate(){check();selected=null;},
  schema(name){
   if(typeof name!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw new AppError('INVALID');
   const query=(method,args)=>{
    check();const pending=tail.then(async()=>{
     check();if(selected!==name){await connection.run('SET LOCAL search_path TO "'+name+'", pg_catalog');selected=name;}
     return connection[method](...args);
    });tail=pending.catch(()=>{});return pending;
   };
   const db={
    env:connection.env,client:connection.client,id:connection.id,schema:name,
    scope(operation){check();return connection.scope(operation);},
    async run(...args){return query('run',args);},
    async get(...args){return query('get',args);},
    async all(...args){return query('all',args);},
    rows(sql,values,options){check();return connection.rows.call(db,sql,values,options);}
   };return db;
  }
 };
}
