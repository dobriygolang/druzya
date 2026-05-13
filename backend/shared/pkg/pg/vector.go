// vector.go — pgvector helper.
//
// Сериализует []float32 в строку формата '[v1,v2,...]', которую pgvector
// extension парсит как `vector(N)` value. Альтернатива — использовать
// pgvector-go driver, но он требует pgx-extension wiring; для нашего
// scale (single Postgres) текстовая сериализация даёт identical write
// performance и не требует init-кода.
//
// Usage:
//
//	pool.Exec(ctx, `UPDATE t SET embedding_vec = $1::vector WHERE id = $2`,
//	    sharedpg.VectorString(vec), id)
package pg

import (
	"strconv"
	"strings"
)

// VectorString форматирует []float32 в "[v1,v2,...]" строку для pgvector.
// Empty slice → пустая строка (caller должен skip-write на nil/empty).
func VectorString(v []float32) string {
	if len(v) == 0 {
		return ""
	}
	var b strings.Builder
	b.Grow(len(v) * 8)
	b.WriteByte('[')
	for i, x := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		// strconv.FormatFloat с 'g' даёт shortest round-trippable
		// представление; pgvector принимает любой стандартный float
		// literal.
		b.WriteString(strconv.FormatFloat(float64(x), 'g', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}
