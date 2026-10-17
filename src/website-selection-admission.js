import {AppError} from './errors.js';

// An original may lose an attachment without rewriting the site's independent
// consent revision. Preserve that saved choice in the editor, but never include
// an absent attachment in publication. Drafts may retain or remove old choices;
// they cannot introduce or alter a choice for an attachment that does not exist.
export function projectWebsiteAttachmentChoices(choices,availableAttachments,savedChoices=[]){
 const available=new Set(availableAttachments.map(value=>value.id)),saved=new Map(savedChoices.map(value=>[value.id,value.share]));
 return choices.filter(choice=>{
  if(available.has(choice.id))return true;
  if(saved.get(choice.id)!==choice.share)throw new AppError('INVALID');
  return false;
 });
}
