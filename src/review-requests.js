// Reviews use the same authenticated command contract for each content owner.
import {Reviews,reviewOperations,reviewReadOperations} from './reviews.js';
import {MAX_BYTES} from './model.js';
import {AppError} from './errors.js';
export function reviewRequest(route,method='POST'){
 if(method!=='POST'||!route.startsWith('/api/reviews/'))return null;
 const review=route.slice('/api/reviews/'.length);
 return reviewOperations.includes(review)?{review,write:!reviewReadOperations.includes(review),limit:MAX_BYTES}:null;
}
export async function executeReviewRequest(storage,device,operation,data){
 try{return await new Reviews(storage,device).run(operation,data);}
 catch(error){if(error instanceof AppError)throw error;throw new AppError('REVIEW_INVALID',[{field:error.message}]);}
}
