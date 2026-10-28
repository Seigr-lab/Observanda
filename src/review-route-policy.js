import {MAX_BYTES} from './web/workspace-limits.js';

// Transport, owner dispatch and lifecycle admission use the same contract.
// Signed packet membership and contact trust remain enforced by Reviews.
export const reviewReadOperations=Object.freeze(['plan','identity','list','read','export','download','figure','figure-export']);
export const reviewOperations=Object.freeze([...reviewReadOperations,'contact','untrust','create','import','receive','respond']);
const downloads=new Set(['download','figure-export']);
export const reviewRoutes=Object.freeze(Object.fromEntries(reviewOperations.map(review=>{
 const download=downloads.has(review),stream=review==='receive',write=!reviewReadOperations.includes(review);
 return [review,Object.freeze({review,method:download?'GET':'POST',input:stream?'stream':'json',
  schema:'signed-review-command:'+review,limit:MAX_BYTES,write,download,querySelection:download||stream,
  authority:'unlocked-selected-owner',owner:'selected-content-owner',admission:'work',snapshot:!write,
  cancellation:'selected-owner-disconnect',output:download?'private-download':'private-json'})];
})));
export function reviewRequest(route,method='POST'){
 const prefix='/api/reviews/';if(!route.startsWith(prefix))return null;
 const operation=route.slice(prefix.length),request=Object.hasOwn(reviewRoutes,operation)?reviewRoutes[operation]:null;
 return request?.method===method?request:null;
}
