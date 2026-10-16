// A tag remains a short authored label. Record growth is not limited by a tag count.
export const validRecordTag=value=>typeof value==='string'&&value.length<=40&&!!value.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
