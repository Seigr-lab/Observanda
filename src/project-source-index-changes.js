// Shared legacy lists have dedicated entry-level comparisons. A foreign edit
// to a list must not claim every project represented by the same index object.
import {projectFontLibraryKey,projectSourceFontLibraryChanges} from './project-source-font-owner.js';
import {projectReviewIndexKey,projectSourceReviewIndexChanges} from './project-source-peer-review-owner.js';
const readers=new Map([[projectFontLibraryKey,projectSourceFontLibraryChanges],[projectReviewIndexKey,projectSourceReviewIndexChanges]]);
export function projectSourceIndexChanges(before,after,inventory,id,options){return readers.get(id)?.(before,after,inventory,options)??null;}
