package subclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestGetTier_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/druz9.v1.SubscriptionService/GetTierByUserID" {
			t.Errorf("bad path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"tier":"seeker"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "token", nil)
	tier, err := c.GetTier(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if tier != TierSeeker {
		t.Fatalf("want seeker, got %s", tier)
	}
}

func TestGetTier_Non200_FailOpenToFree(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := New(srv.URL, "", nil)
	tier, err := c.GetTier(context.Background(), "user-1")
	if tier != TierFree {
		t.Fatalf("non-200 must degrade to free, got %s", tier)
	}
	if err == nil {
		t.Fatal("want err for observability")
	}
}

func TestGetTier_BadJSON_FailOpenToFree(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`not json`))
	}))
	defer srv.Close()

	c := New(srv.URL, "", nil)
	tier, _ := c.GetTier(context.Background(), "user-1")
	if tier != TierFree {
		t.Fatalf("bad json must degrade, got %s", tier)
	}
}

func TestGetTier_UnknownTier_FailOpenToFree(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"tier":"diamond_god"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "", nil)
	tier, _ := c.GetTier(context.Background(), "user-1")
	if tier != TierFree {
		t.Fatalf("unknown tier must degrade, got %s", tier)
	}
}

func TestGetTier_Timeout_FailOpenToFree(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{"tier":"seeker"}`))
	}))
	defer srv.Close()

	c := New(srv.URL, "", nil).WithTimeout(50 * time.Millisecond)
	tier, err := c.GetTier(context.Background(), "user-1")
	if tier != TierFree {
		t.Fatalf("timeout must degrade, got %s", tier)
	}
	if err == nil {
		t.Fatal("want err for observability")
	}
}

func TestGetTier_EmptyBase_Fails(t *testing.T) {
	c := New("", "", nil)
	tier, err := c.GetTier(context.Background(), "user-1")
	if tier != TierFree || err == nil {
		t.Fatalf("empty base must fail-open with err, got tier=%s err=%v", tier, err)
	}
}

func TestHasAccess_Table(t *testing.T) {
	cases := []struct {
		u, r Tier
		want bool
	}{
		{TierFree, TierFree, true},
		{TierFree, TierSeeker, false},
		{TierSeeker, TierSeeker, true},
		{TierSeeker, TierAscendant, false},
		{TierAscendant, TierAscendant, true},
	}
	for _, c := range cases {
		if got := HasAccess(c.u, c.r); got != c.want {
			t.Errorf("HasAccess(%s, %s)=%v want %v", c.u, c.r, got, c.want)
		}
	}
}
