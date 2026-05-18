package infra

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"druz9/google_calendar/domain"
)

const (
	googleAuthURL     = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL    = "https://oauth2.googleapis.com/token"
	googleRevokeURL   = "https://oauth2.googleapis.com/revoke"
	googleCalendarAPI = "https://www.googleapis.com/calendar/v3"

	exchangeCodeTimeout = 30 * time.Second
	refreshTokenTimeout = 10 * time.Second
	listEventsTimeout   = 15 * time.Second
	insertEventTimeout  = 20 * time.Second
	patchEventTimeout   = 20 * time.Second
	deleteEventTimeout  = 15 * time.Second
	revokeTokenTimeout  = 10 * time.Second
)

type GoogleAPI struct {
	clientID     string
	clientSecret string
	scopes       []string
	httpc        *http.Client
}

func NewGoogleAPI(clientID, clientSecret string, scopes []string) *GoogleAPI {
	if len(scopes) == 0 {
		scopes = []string{"https://www.googleapis.com/auth/calendar.events"}
	}
	return &GoogleAPI{
		clientID:     clientID,
		clientSecret: clientSecret,
		scopes:       scopes,
		httpc:        &http.Client{},
	}
}

func (g *GoogleAPI) AuthURL(state, redirectURI string) string {
	q := url.Values{}
	q.Set("client_id", g.clientID)
	q.Set("redirect_uri", redirectURI)
	q.Set("response_type", "code")
	q.Set("scope", strings.Join(g.scopes, " "))
	q.Set("access_type", "offline")
	q.Set("prompt", "consent")
	q.Set("include_granted_scopes", "true")
	q.Set("state", state)
	return googleAuthURL + "?" + q.Encode()
}

type tokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	IDToken      string `json:"id_token,omitempty"`
}

func (g *GoogleAPI) ExchangeCode(ctx context.Context, code, redirectURI string) (domain.GoogleCredentials, error) {
	ctx, cancel := context.WithTimeout(ctx, exchangeCodeTimeout)
	defer cancel()
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", g.clientID)
	form.Set("client_secret", g.clientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("google_calendar.ExchangeCode: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := g.httpc.Do(req)
	if err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("%w: ExchangeCode do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return domain.GoogleCredentials{}, fmt.Errorf("%w: ExchangeCode status %d: %s", domain.ErrUpstream, resp.StatusCode, body)
	}
	var tr tokenResp
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return domain.GoogleCredentials{}, fmt.Errorf("google_calendar.ExchangeCode decode: %w", err)
	}
	return domain.GoogleCredentials{
		AccessToken:  tr.AccessToken,
		RefreshToken: tr.RefreshToken,
		Expiry:       time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second).UTC(),
		Scopes:       strings.Fields(tr.Scope),
	}, nil
}

func (g *GoogleAPI) RefreshToken(ctx context.Context, refresh string) (string, time.Time, string, error) {
	ctx, cancel := context.WithTimeout(ctx, refreshTokenTimeout)
	defer cancel()
	form := url.Values{}
	form.Set("refresh_token", refresh)
	form.Set("client_id", g.clientID)
	form.Set("client_secret", g.clientSecret)
	form.Set("grant_type", "refresh_token")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", time.Time{}, "", fmt.Errorf("google_calendar.RefreshToken: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := g.httpc.Do(req)
	if err != nil {
		return "", time.Time{}, "", fmt.Errorf("%w: RefreshToken do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return "", time.Time{}, "", fmt.Errorf("%w: RefreshToken status %d: %s", domain.ErrUpstream, resp.StatusCode, body)
	}
	var tr tokenResp
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return "", time.Time{}, "", fmt.Errorf("google_calendar.RefreshToken decode: %w", err)
	}
	return tr.AccessToken, time.Now().Add(time.Duration(tr.ExpiresIn) * time.Second).UTC(), tr.RefreshToken, nil
}

func (g *GoogleAPI) RevokeToken(ctx context.Context, accessToken string) error {
	ctx, cancel := context.WithTimeout(ctx, revokeTokenTimeout)
	defer cancel()
	form := url.Values{}
	form.Set("token", accessToken)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleRevokeURL, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("google_calendar.RevokeToken: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := g.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("%w: RevokeToken do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%w: RevokeToken status %d", domain.ErrUpstream, resp.StatusCode)
	}
	return nil
}

// --- events API ----------------------------------------------------------

type calendarListResp struct {
	Items []calendarEventItem `json:"items"`
}

type calendarEventItem struct {
	ID          string                `json:"id"`
	Etag        string                `json:"etag"`
	Summary     string                `json:"summary"`
	Description string                `json:"description"`
	Status      string                `json:"status"`
	Updated     string                `json:"updated"`
	Start       calendarEventDateTime `json:"start"`
	End         calendarEventDateTime `json:"end"`
}

type calendarEventDateTime struct {
	DateTime string `json:"dateTime,omitempty"`
	Date     string `json:"date,omitempty"`
	TimeZone string `json:"timeZone,omitempty"`
}

func (d calendarEventDateTime) Parse() time.Time {
	if d.DateTime != "" {
		if t, err := time.Parse(time.RFC3339, d.DateTime); err == nil {
			return t.UTC()
		}
	}
	if d.Date != "" {
		if t, err := time.Parse("2006-01-02", d.Date); err == nil {
			return t.UTC()
		}
	}
	return time.Time{}
}

func (g *GoogleAPI) ListEvents(ctx context.Context, accessToken, calendarID string, timeMin, timeMax, updatedMin time.Time) ([]domain.GoogleEventDTO, error) {
	ctx, cancel := context.WithTimeout(ctx, listEventsTimeout)
	defer cancel()
	if calendarID == "" {
		calendarID = "primary"
	}
	q := url.Values{}
	q.Set("singleEvents", "true")
	q.Set("orderBy", "startTime")
	q.Set("maxResults", "250")
	if !timeMin.IsZero() {
		q.Set("timeMin", timeMin.UTC().Format(time.RFC3339))
	}
	if !timeMax.IsZero() {
		q.Set("timeMax", timeMax.UTC().Format(time.RFC3339))
	}
	if !updatedMin.IsZero() {
		q.Set("updatedMin", updatedMin.UTC().Format(time.RFC3339))
		// updatedMin без showDeleted=true пропускает cancelled — для soft-delete
		// нам нужны статусы cancelled тоже.
		q.Set("showDeleted", "true")
	}
	endpoint := fmt.Sprintf("%s/calendars/%s/events?%s", googleCalendarAPI, url.PathEscape(calendarID), q.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("google_calendar.ListEvents: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := g.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: ListEvents do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%w: ListEvents status %d: %s", domain.ErrUpstream, resp.StatusCode, body)
	}
	var raw calendarListResp
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("google_calendar.ListEvents decode: %w", err)
	}
	out := make([]domain.GoogleEventDTO, 0, len(raw.Items))
	for _, it := range raw.Items {
		updated, _ := time.Parse(time.RFC3339, it.Updated)
		out = append(out, domain.GoogleEventDTO{
			ID:          it.ID,
			Etag:        it.Etag,
			Summary:     it.Summary,
			Description: it.Description,
			Start:       it.Start.Parse(),
			End:         it.End.Parse(),
			Status:      it.Status,
			UpdatedAt:   updated.UTC(),
		})
	}
	return out, nil
}

type insertEventBody struct {
	Summary     string                `json:"summary"`
	Description string                `json:"description,omitempty"`
	Start       calendarEventDateTime `json:"start"`
	End         calendarEventDateTime `json:"end"`
}

func (g *GoogleAPI) InsertEvent(ctx context.Context, accessToken, calendarID string, in domain.EventInput) (domain.GoogleEventDTO, error) {
	ctx, cancel := context.WithTimeout(ctx, insertEventTimeout)
	defer cancel()
	if calendarID == "" {
		calendarID = "primary"
	}
	body := insertEventBody{
		Summary:     in.Title,
		Description: in.Description,
		Start:       calendarEventDateTime{DateTime: in.Start.UTC().Format(time.RFC3339)},
		End:         calendarEventDateTime{DateTime: in.End.UTC().Format(time.RFC3339)},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("google_calendar.InsertEvent marshal: %w", err)
	}
	endpoint := fmt.Sprintf("%s/calendars/%s/events", googleCalendarAPI, url.PathEscape(calendarID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("google_calendar.InsertEvent: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.httpc.Do(req)
	if err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("%w: InsertEvent do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return domain.GoogleEventDTO{}, fmt.Errorf("%w: InsertEvent status %d: %s", domain.ErrUpstream, resp.StatusCode, body)
	}
	return decodeEventItem(resp.Body)
}

func (g *GoogleAPI) PatchEvent(ctx context.Context, accessToken, calendarID, googleEventID string, in domain.EventInput) (domain.GoogleEventDTO, error) {
	ctx, cancel := context.WithTimeout(ctx, patchEventTimeout)
	defer cancel()
	if calendarID == "" {
		calendarID = "primary"
	}
	body := insertEventBody{
		Summary:     in.Title,
		Description: in.Description,
		Start:       calendarEventDateTime{DateTime: in.Start.UTC().Format(time.RFC3339)},
		End:         calendarEventDateTime{DateTime: in.End.UTC().Format(time.RFC3339)},
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("google_calendar.PatchEvent marshal: %w", err)
	}
	endpoint := fmt.Sprintf("%s/calendars/%s/events/%s", googleCalendarAPI, url.PathEscape(calendarID), url.PathEscape(googleEventID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(raw))
	if err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("google_calendar.PatchEvent: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.httpc.Do(req)
	if err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("%w: PatchEvent do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return domain.GoogleEventDTO{}, fmt.Errorf("%w: PatchEvent status %d: %s", domain.ErrUpstream, resp.StatusCode, body)
	}
	return decodeEventItem(resp.Body)
}

func (g *GoogleAPI) DeleteEvent(ctx context.Context, accessToken, calendarID, googleEventID string) error {
	ctx, cancel := context.WithTimeout(ctx, deleteEventTimeout)
	defer cancel()
	if calendarID == "" {
		calendarID = "primary"
	}
	endpoint := fmt.Sprintf("%s/calendars/%s/events/%s", googleCalendarAPI, url.PathEscape(calendarID), url.PathEscape(googleEventID))
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return fmt.Errorf("google_calendar.DeleteEvent: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	resp, err := g.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("%w: DeleteEvent do: %v", domain.ErrUpstream, err)
	}
	defer func() { _ = resp.Body.Close() }()
	// 410 (Gone) — уже удалён, считаем idempotent success.
	if resp.StatusCode == http.StatusGone {
		return nil
	}
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("%w: DeleteEvent status %d: %s", domain.ErrUpstream, resp.StatusCode, body)
	}
	return nil
}

func decodeEventItem(r io.Reader) (domain.GoogleEventDTO, error) {
	var it calendarEventItem
	if err := json.NewDecoder(r).Decode(&it); err != nil {
		return domain.GoogleEventDTO{}, fmt.Errorf("google_calendar: decode event: %w", err)
	}
	updated, _ := time.Parse(time.RFC3339, it.Updated)
	return domain.GoogleEventDTO{
		ID:          it.ID,
		Etag:        it.Etag,
		Summary:     it.Summary,
		Description: it.Description,
		Start:       it.Start.Parse(),
		End:         it.End.Parse(),
		Status:      it.Status,
		UpdatedAt:   updated.UTC(),
	}, nil
}

var _ domain.GoogleAPI = (*GoogleAPI)(nil)
