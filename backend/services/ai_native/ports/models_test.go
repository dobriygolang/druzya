package ports

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestModelsHandler_KeyPresent_ReturnsCatalogue(t *testing.T) {
	t.Parallel()
	h := NewModelsHandler(true)
	rec := httptest.NewRecorder()
	h.handleList(rec, httptest.NewRequest(http.MethodGet, "/ai/models", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp ModelsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.Available {
		t.Errorf("Available = false, want true")
	}
	if len(resp.Items) == 0 {
		t.Fatalf("empty catalogue")
	}
	var foundFree, foundPremium bool
	for _, m := range resp.Items {
		switch m.Tier {
		case "free":
			foundFree = true
		case "premium":
			foundPremium = true
		default:
			t.Errorf("unexpected tier %q for %s", m.Tier, m.ID)
		}
	}
	if !foundFree {
		t.Error("no free model registered")
	}
	if !foundPremium {
		t.Error("no premium model registered")
	}
}

func TestModelsHandler_NoKey_ReturnsEmpty(t *testing.T) {
	t.Parallel()
	h := NewModelsHandler(false)
	rec := httptest.NewRecorder()
	h.handleList(rec, httptest.NewRequest(http.MethodGet, "/ai/models", nil))
	var resp ModelsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Available {
		t.Errorf("Available = true, want false")
	}
	if len(resp.Items) != 0 {
		t.Errorf("items should be empty when key missing, got %d", len(resp.Items))
	}
}
