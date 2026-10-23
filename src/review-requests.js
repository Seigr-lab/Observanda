// Reviews use the same authenticated command contract for each content owner.
import {Reviews,reviewOperations,reviewReadOperations} from './reviews.js';
import {MAX_BYTES} from './model.js';
import {AppError} from './errors.js';
export function reviewRequest(route,method='POST'){
 if(!['POST','GET'].includes(method)||!route.startsWith('/api/reviews/'))return null;
 const review=route.slice('/api/reviews/'.length);
 const download=['download','figure-export'].includes(review);if((download?'GET':'POST')!==method)return null;return reviewOperations.includes(review)?{review,method,write:!reviewReadOperations.includes(review),limit:MAX_BYTES,...(download?{download:true,querySelection:true}:review==='receive'?{input:'stream',querySelection:true}:{})}:null;
}
export async function executeReviewRequest(storage,device,operation,data,options={}){
 try{return await new Reviews(storage,device).run(operation,data,options);}
 catch(error){if(error instanceof AppError)throw error;throw new AppError('REVIEW_INVALID',[{field:error.message}]);}
}
