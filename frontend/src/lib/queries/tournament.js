// Tournament queries — INTENTIONALLY NOT WIRED.
//
// There is no `tournament` bounded context in backend/services/ today and
// there is no `/tournament/*` route on the BFF. The TournamentPage UI now
// renders a ComingSoon banner; this module is preserved as a place to land
// real types once the backend ships, so we don't have to thread imports
// through the page again at that point.
//
// Until then, every export here is unused on purpose. Do NOT call
// useTournamentQuery — it will 404.
export {};
