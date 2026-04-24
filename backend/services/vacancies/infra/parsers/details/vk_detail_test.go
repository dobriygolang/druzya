package details

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"druz9/vacancies/domain"
)

const vkDetailFixture = `<!DOCTYPE html>
<html><head><title>VK Vacancy</title></head><body>
<header>nav</header>
<main>
<div class="article-block-wrapper article" itemprop="description">
<h3>Требования</h3>
<ul><li>Опыт C++ 5+ лет</li><li>Знание Linux</li></ul>
<h3>Обязанности</h3>
<ul><li>Разрабатывать low-level компоненты</li></ul>
<p>Работа на удалёнке возможна.</p>
<script>alert('xss')</script>
</div>
</main>
</body></html>`

func TestVKDetail_ScrapesHTML(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(vkDetailFixture))
	}))
	defer srv.Close()

	f := NewVK(testLog()).WithBaseURL(srv.URL)
	listing := domain.Vacancy{Source: domain.SourceVK, ExternalID: "42", Company: "VK"}
	d, err := f.FetchDetails(context.Background(), "42", listing)
	if err != nil {
		t.Fatalf("FetchDetails: %v", err)
	}
	if d.Vacancy.Company != "VK" {
		t.Errorf("listing pass-through lost")
	}
	if !strings.Contains(d.DescriptionHTML, "Опыт C++ 5+ лет") {
		t.Errorf("description content missing: %q", d.DescriptionHTML)
	}
	if !strings.Contains(d.DescriptionHTML, "<ul>") || !strings.Contains(d.DescriptionHTML, "<li>") {
		t.Errorf("structural tags lost: %q", d.DescriptionHTML)
	}
	// Sanitiser must strip <script>
	if strings.Contains(d.DescriptionHTML, "<script") || strings.Contains(d.DescriptionHTML, "alert(") {
		t.Errorf("sanitiser allowed <script>: %q", d.DescriptionHTML)
	}
}

func TestVKDetail_MissingBlock(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html><body><div>nothing here</div></body></html>`))
	}))
	defer srv.Close()
	f := NewVK(testLog()).WithBaseURL(srv.URL)
	if _, err := f.FetchDetails(context.Background(), "1", domain.Vacancy{}); err == nil {
		t.Fatalf("expected error on missing block")
	}
}
