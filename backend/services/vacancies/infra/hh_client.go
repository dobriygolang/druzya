// hh_client.go is intentionally near-empty.
//
// The HH.ru REST client lives in the dedicated sub-package
// druz9/vacancies/infra/hhapi so that the per-source parsers under
// druz9/vacancies/infra/parsers can import it without creating a circular
// dependency on this package (vacancies/infra also pulls in parsers from
// the wiring layer).
package infra
