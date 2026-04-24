package extractor

import (
	"archive/zip"
	"bytes"
	"errors"
	"strings"
	"testing"

	"druz9/documents/domain"
)

// buildDocx собирает минимальный .docx из кусков XML. Это лучше, чем
// класть бинарный fixture в репо: тест самодокументируется, reviewer
// видит, какую структуру парсер должен переварить.
func buildDocx(t *testing.T, documentXML string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	// [Content_Types].xml — реальный docx имеет, но наш парсер его не
	// читает, поэтому пропускаем для минимализма.
	f, err := zw.Create("word/document.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte(documentXML)); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// TestExtractDOCX_Basic — один параграф с одним run'ом. Проверяем,
// что текст извлечён. Namespace 'w' используем полный — реальные docx
// именно так.
func TestExtractDOCX_Basic(t *testing.T) {
	xml := `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello world</w:t></w:r></w:p>
  </w:body>
</w:document>`
	got, err := ExtractDOCX(buildDocx(t, xml))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got, "Hello world") {
		t.Errorf("missing text: %q", got)
	}
}

// TestExtractDOCX_MultipleParagraphs — каждый <w:p> закрывается newline'ом.
// Чанкер потом использует эти разрывы для сентенс-сплита; если бы
// параграфы слиплись — два предложения стали бы одним длинным.
func TestExtractDOCX_MultipleParagraphs(t *testing.T) {
	xml := `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>First paragraph.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Third paragraph.</w:t></w:r></w:p>
  </w:body>
</w:document>`
	got, err := ExtractDOCX(buildDocx(t, xml))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// Нормализация схлопывает пробелы, но не newlines.
	if !strings.Contains(got, "First paragraph.") ||
		!strings.Contains(got, "Second paragraph.") ||
		!strings.Contains(got, "Third paragraph.") {
		t.Errorf("paragraph content lost: %q", got)
	}
	// Должно быть хотя бы одно newline между параграфами.
	if !strings.Contains(got, "\n") {
		t.Errorf("paragraphs merged into one line: %q", got)
	}
}

// TestExtractDOCX_MixedRuns — несколько <w:r>/<w:t> внутри одного
// параграфа (это как Word сохраняет подкрашенные/жирные фрагменты).
// Текст должен собраться последовательно без потерь.
func TestExtractDOCX_MixedRuns(t *testing.T) {
	xml := `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>Hello </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>
      <w:r><w:t> world</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
	got, err := ExtractDOCX(buildDocx(t, xml))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !strings.Contains(got, "Hello bold world") {
		t.Errorf("mixed runs didn't concatenate: %q", got)
	}
}

// TestExtractDOCX_TabAndBreak — <w:tab/> → space, <w:br/> → newline.
// Без этого словоотделения таблицы слипнутся в одно длинное слово.
func TestExtractDOCX_TabAndBreak(t *testing.T) {
	xml := `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r><w:t>left</w:t></w:r>
      <w:r><w:tab/></w:r>
      <w:r><w:t>right</w:t></w:r>
      <w:r><w:br/></w:r>
      <w:r><w:t>next-line</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`
	got, err := ExtractDOCX(buildDocx(t, xml))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if strings.Contains(got, "leftright") {
		t.Errorf("tab didn't separate words: %q", got)
	}
	if !strings.Contains(got, "left right") {
		t.Errorf("'left right' not found: %q", got)
	}
	if !strings.Contains(got, "next-line") {
		t.Errorf("next-line missing: %q", got)
	}
}

// TestExtractDOCX_NotZip — любой файл, не являющийся zip'ом (напр.
// legacy .doc в OLE-формате), должен отклоняться с ErrUnsupportedMIME.
// Регрессия здесь — пользователи получали бы "internal server error"
// вместо понятного «формат не поддерживается».
func TestExtractDOCX_NotZip(t *testing.T) {
	_, err := ExtractDOCX([]byte("this is not a zip file"))
	if !errors.Is(err, domain.ErrUnsupportedMIME) {
		t.Errorf("want ErrUnsupportedMIME, got %v", err)
	}
}

// TestExtractDOCX_MissingDocumentXML — zip без word/document.xml
// (напр. .xlsx или повреждённый .docx) → ErrUnsupportedMIME.
func TestExtractDOCX_MissingDocumentXML(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	f, _ := zw.Create("xl/workbook.xml")
	_, _ = f.Write([]byte("<workbook/>"))
	_ = zw.Close()

	_, err := ExtractDOCX(buf.Bytes())
	if !errors.Is(err, domain.ErrUnsupportedMIME) {
		t.Errorf("want ErrUnsupportedMIME, got %v", err)
	}
}

// TestExtractDOCX_EmptyBody — валидный docx, но document.xml без текста.
// Должен вернуть ErrEmptyContent (чтобы UI показал понятное сообщение).
func TestExtractDOCX_EmptyBody(t *testing.T) {
	xml := `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p/></w:body>
</w:document>`
	_, err := ExtractDOCX(buildDocx(t, xml))
	if !errors.Is(err, domain.ErrEmptyContent) {
		t.Errorf("want ErrEmptyContent, got %v", err)
	}
}
