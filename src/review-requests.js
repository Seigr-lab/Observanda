// Reviews use the same authenticated command contract for each content owner.
import {Reviews} from './reviews.js';
import {AppError} from './errors.js';
export {reviewRequest} from './review-route-policy.js';
export async function executeReviewRequest(storage,device,operation,data,options={}){
 try{return await new Reviews(storage,device).run(operation,data,options);}
 catch(error){if(error instanceof AppError)throw error;throw new AppError('REVIEW_INVALID',[{field:error.message}]);}
}
