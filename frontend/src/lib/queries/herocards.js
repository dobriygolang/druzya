// Hero Cards queries — INTENTIONALLY NOT WIRED.
//
// There is no `hero_cards` bounded context in backend/services/ today and
// there is no `/herocards` route on the BFF. The HeroCardsPage UI now
// renders a ComingSoon banner; this module is preserved as a place to land
// real types once the backend ships, so the page wiring is a one-line
// change later.
//
// Until then, every export here is unused on purpose. Do NOT call
// useHeroCardsQuery — it will 404.
export {};
