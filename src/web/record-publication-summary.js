// Publication discovery needs counts and media choices, never record prose.
// The encrypted catalogue authenticates this derivative with its record member.
export const recordPublicationSummary=record=>({attachments:record.attachments.map(({id,kind,share})=>({id,kind,share}))});
