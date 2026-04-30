package domain

import (
	"errors"
	"testing"
)

func TestTrack_IsValid(t *testing.T) {
	t.Parallel()
	for _, tt := range AllTracks() {
		if !tt.IsValid() {
			t.Errorf("AllTracks() returned invalid track: %q", tt)
		}
	}
	if Track("").IsValid() {
		t.Error("empty track must be invalid")
	}
	if Track("nonsense").IsValid() {
		t.Error("nonsense must be invalid")
	}
}

func TestSeniority_IsValid(t *testing.T) {
	t.Parallel()
	cases := map[Seniority]bool{
		"":              true, // empty = N/A (english)
		SeniorityJunior: true,
		SeniorityMiddle: true,
		SenioritySenior: true,
		SeniorityLead:   true,
		"principal":     false, // not in CHECK constraint
		"NonsenseLevel": false,
	}
	for s, want := range cases {
		if got := s.IsValid(); got != want {
			t.Errorf("Seniority(%q).IsValid() = %v, want %v", s, got, want)
		}
	}
}

func TestValidateTrackList_HappyPath(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: TrackDevSenior, Seniority: SenioritySenior, Primary: true},
		{Track: TrackEnglish, Seniority: "", Primary: false},
	}
	if err := ValidateTrackList(items); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestValidateTrackList_RejectsEmpty(t *testing.T) {
	t.Parallel()
	if err := ValidateTrackList(nil); !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("nil: want ErrInvalidTracks, got %v", err)
	}
	if err := ValidateTrackList([]UserTrack{}); !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("empty slice: want ErrInvalidTracks, got %v", err)
	}
}

func TestValidateTrackList_RejectsZeroPrimary(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: TrackDev, Seniority: SeniorityMiddle, Primary: false},
		{Track: TrackEnglish, Primary: false},
	}
	err := ValidateTrackList(items)
	if !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("want ErrInvalidTracks, got %v", err)
	}
}

func TestValidateTrackList_RejectsMultiplePrimary(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: TrackDev, Seniority: SeniorityMiddle, Primary: true},
		{Track: TrackEnglish, Primary: true},
	}
	err := ValidateTrackList(items)
	if !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("want ErrInvalidTracks, got %v", err)
	}
}

func TestValidateTrackList_RejectsDuplicateTrack(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: TrackDev, Seniority: SeniorityMiddle, Primary: true},
		{Track: TrackDev, Seniority: SenioritySenior, Primary: false},
	}
	err := ValidateTrackList(items)
	if !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("want ErrInvalidTracks, got %v", err)
	}
}

func TestValidateTrackList_RejectsInvalidTrack(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: Track("designer"), Seniority: SeniorityMiddle, Primary: true},
	}
	err := ValidateTrackList(items)
	if !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("want ErrInvalidTracks, got %v", err)
	}
}

func TestValidateTrackList_RejectsInvalidSeniority(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: TrackDev, Seniority: Seniority("guru"), Primary: true},
	}
	err := ValidateTrackList(items)
	if !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("want ErrInvalidTracks, got %v", err)
	}
}

func TestValidateTrackList_RejectsEnglishWithSeniority(t *testing.T) {
	t.Parallel()
	items := []UserTrack{
		{Track: TrackEnglish, Seniority: SeniorityMiddle, Primary: true},
	}
	err := ValidateTrackList(items)
	if !errors.Is(err, ErrInvalidTracks) {
		t.Fatalf("english with seniority must be rejected, got %v", err)
	}
}

func TestValidateTrackList_RejectsEngineeringWithoutSeniority(t *testing.T) {
	t.Parallel()
	cases := []Track{TrackDev, TrackDevSenior, TrackSysanalyst, TrackProductAnalyst, TrackQA}
	for _, tk := range cases {
		items := []UserTrack{
			{Track: tk, Seniority: "", Primary: true},
		}
		err := ValidateTrackList(items)
		if !errors.Is(err, ErrInvalidTracks) {
			t.Errorf("%s without seniority must be rejected, got %v", tk, err)
		}
	}
}

func TestAllTracks_CoversAllConstants(t *testing.T) {
	t.Parallel()
	want := map[Track]struct{}{
		TrackDev: {}, TrackDevSenior: {}, TrackSysanalyst: {},
		TrackProductAnalyst: {}, TrackQA: {}, TrackEnglish: {},
	}
	got := AllTracks()
	if len(got) != len(want) {
		t.Fatalf("AllTracks() returned %d items, want %d (must enumerate every Track constant)", len(got), len(want))
	}
	for _, tk := range got {
		if _, ok := want[tk]; !ok {
			t.Errorf("AllTracks() returned unknown track %q", tk)
		}
		delete(want, tk)
	}
	if len(want) > 0 {
		t.Errorf("AllTracks() missed: %v", want)
	}
}
