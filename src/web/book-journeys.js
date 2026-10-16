// Reading categories are views over records, not additional records or counts.
export const BOOK_JOURNEYS=['all','concepts','decisions','methods','experiments','results','notes'];
export const readingJourney=record=>record.journey??({concept:'concepts',hypothesis:'concepts',decision:'decisions',protocol:'methods',experiment:'experiments',run:'experiments',analysis:'results',conclusion:'results',dataset:'results'}[record.type]??'notes');
