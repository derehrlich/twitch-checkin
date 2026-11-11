// Ton-Plätze: jeder Alert kann einen eigenen Ton haben. Fehlt er, springt das Overlay auf den Ersatz-Platz
// (FALLBACK) und sonst auf einen eingebauten Klang, der sich je Platz unterscheidet.
export const SLOTS = ['checkin', 'checkout', 'milestone', 'raid', 'follow', 'sub', 'resub', 'gift', 'cheer', 'rescue'];
export const FALLBACK = { checkout: 'checkin', milestone: 'checkin', resub: 'sub' };
// Der Check-in-Ton liegt wie früher unter sound/data, damit bestehende Uploads weiter gelten
export const slotKey = (slot) => (slot === 'checkin' ? 'sound/data' : `sound/${slot}`);
