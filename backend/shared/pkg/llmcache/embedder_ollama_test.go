package llmcache

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestOllamaEmbedder_Success(t *testing.T) {
	// Генерируем "вектор" длины 384 с одной ненулевой компонентой — это
	// упрощает проверку нормализации.
	vec := make([]float64, BgeSmallEnDim)
	vec[0] = 3 // после нормализации должна стать 1.

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "bad method", http.StatusMethodNotAllowed)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"embedding": vec})
	}))
	defer srv.Close()

	e := NewOllamaEmbedder(srv.URL, "bge-small-en-v1.5", 2*time.Second)
	if e.Dim() != BgeSmallEnDim {
		t.Fatalf("dim want %d, got %d", BgeSmallEnDim, e.Dim())
	}
	out, err := e.Embed(context.Background(), "hello")
	if err != nil {
		t.Fatalf("Embed: %v", err)
	}
	if len(out) != BgeSmallEnDim {
		t.Fatalf("len want %d, got %d", BgeSmallEnDim, len(out))
	}
	if math.Abs(float64(out[0])-1.0) > 1e-5 {
		t.Fatalf("normalization failed: out[0]=%v", out[0])
	}
}

func TestOllamaEmbedder_NonOKStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()

	e := NewOllamaEmbedder(srv.URL, "", time.Second)
	_, err := e.Embed(context.Background(), "x")
	if err == nil {
		t.Fatalf("want error on 500")
	}
}

func TestOllamaEmbedder_DimMismatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"embedding": []float64{1, 2, 3}})
	}))
	defer srv.Close()
	e := NewOllamaEmbedder(srv.URL, "", time.Second)
	_, err := e.Embed(context.Background(), "x")
	if err == nil {
		t.Fatalf("want dim mismatch error")
	}
}

func TestOllamaEmbedder_Timeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_ = json.NewEncoder(w).Encode(map[string]any{"embedding": make([]float64, BgeSmallEnDim)})
	}))
	defer srv.Close()
	e := NewOllamaEmbedder(srv.URL, "", 50*time.Millisecond)
	_, err := e.Embed(context.Background(), "x")
	if err == nil {
		t.Fatalf("want timeout error")
	}
}

func TestOllamaEmbedder_EmptyHostDefaultTimeout(t *testing.T) {
	// Sanity: конструктор с пустым host не паникует, dim корректен.
	e := NewOllamaEmbedder("", "", 0)
	if e.Dim() != BgeSmallEnDim {
		t.Fatalf("dim: %d", e.Dim())
	}
}
