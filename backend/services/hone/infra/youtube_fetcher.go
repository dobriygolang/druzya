package infra

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"druz9/hone/domain"
)

// YouTubeFetcher — yt-dlp adapter. Pulls metadata + auto-captions через
// бинарь `yt-dlp` (должен быть на PATH api контейнера). Никаких heavyweight
// download'ов — только metadata JSON + sub URL → fetch JSON3 → parse text.
//
// CLI invocation:
//
//	yt-dlp --skip-download --write-auto-sub --write-info-json
//	       --sub-langs <hint>,en,ru,en-orig
//	       --sub-format json3
//	       -o "<tmp>" <url>
//
// Но проще: `yt-dlp -j <url>` возвращает full info JSON в stdout, в нём
// есть `automatic_captions` map с URLs к каждому языку. Pull URL, parse
// JSON3 vtt-like формат → склеить text.
type YouTubeFetcher struct {
	Bin     string        // путь к yt-dlp бинарю; default "yt-dlp"
	Timeout time.Duration // default 30s
}

func NewYouTubeFetcher() *YouTubeFetcher {
	return &YouTubeFetcher{Bin: "yt-dlp", Timeout: 30 * time.Second}
}

// videoIDRe — extracts <id> from any common YouTube URL shape.
var videoIDRe = regexp.MustCompile(`(?:youtube\.com/(?:watch\?v=|embed/|shorts/)|youtu\.be/)([A-Za-z0-9_-]{11})`)

func extractVideoID(url string) string {
	m := videoIDRe.FindStringSubmatch(url)
	if len(m) < 2 {
		return ""
	}
	return m[1]
}

type ytDlpInfo struct {
	Title             string                  `json:"title"`
	WebpageURL        string                  `json:"webpage_url"`
	Subtitles         map[string][]ytSubtitle `json:"subtitles"`
	AutomaticCaptions map[string][]ytSubtitle `json:"automatic_captions"`
}

type ytSubtitle struct {
	Ext  string `json:"ext"`
	URL  string `json:"url"`
	Name string `json:"name"`
}

// Fetch implements domain.YouTubeFetcher.
func (f *YouTubeFetcher) Fetch(ctx context.Context, url, languageHint string) (domain.YouTubeFetchResult, error) {
	bin := f.Bin
	if bin == "" {
		bin = "yt-dlp"
	}
	timeout := f.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	if extractVideoID(url) == "" {
		return domain.YouTubeFetchResult{}, fmt.Errorf("hone.YouTubeFetcher: not a YouTube URL")
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// `yt-dlp -j <url>` — info-only JSON в stdout.
	cmd := exec.CommandContext(ctx, bin, "-j", "--no-warnings", url)
	out, err := cmd.Output()
	if err != nil {
		return domain.YouTubeFetchResult{}, fmt.Errorf("hone.YouTubeFetcher: yt-dlp failed (binary on PATH?): %w", err)
	}
	var info ytDlpInfo
	if jerr := json.Unmarshal(out, &info); jerr != nil {
		return domain.YouTubeFetchResult{}, fmt.Errorf("hone.YouTubeFetcher: parse info: %w", jerr)
	}

	// Pick best sub track. Order: explicit hint → en → ru → first available.
	// Subtitles (manual) предпочтительнее automatic (cleaner).
	pick := pickSubtitle(info.Subtitles, languageHint)
	usedAuto := false
	if pick.URL == "" {
		pick = pickSubtitle(info.AutomaticCaptions, languageHint)
		usedAuto = true
	}
	if pick.URL == "" {
		return domain.YouTubeFetchResult{}, fmt.Errorf("hone.YouTubeFetcher: no captions for video")
	}
	_ = usedAuto

	// Fetch the JSON3 transcript via curl-equivalent. yt-dlp gives URL;
	// we GET it directly. JSON3 имеет shape {events:[{tStartMs,segs:[{utf8}]}]}.
	transcript, err := fetchJSON3Transcript(ctx, pick.URL)
	if err != nil {
		// Fallback: pick.URL мог быть в другом ext (vtt/srt). Не тащим
		// доп parser сейчас — просим юзера вставить вручную.
		return domain.YouTubeFetchResult{}, fmt.Errorf("hone.YouTubeFetcher: extract transcript: %w", err)
	}

	canonical := info.WebpageURL
	if canonical == "" {
		canonical = url
	}
	return domain.YouTubeFetchResult{
		Title:            info.Title,
		Transcript:       transcript,
		CanonicalURL:     canonical,
		LanguageDetected: pick.Lang,
	}, nil
}

type pickedSub struct {
	URL  string
	Lang string
}

func pickSubtitle(m map[string][]ytSubtitle, hint string) pickedSub {
	if len(m) == 0 {
		return pickedSub{}
	}
	tryLangs := make([]string, 0, 5)
	if hint != "" {
		tryLangs = append(tryLangs, hint)
	}
	tryLangs = append(tryLangs, "en", "en-orig", "ru", "ru-orig")
	for _, lang := range tryLangs {
		subs, ok := m[lang]
		if !ok {
			continue
		}
		for _, s := range subs {
			if strings.EqualFold(s.Ext, "json3") {
				return pickedSub{URL: s.URL, Lang: lang}
			}
		}
	}
	// Fallback: any json3 sub.
	for lang, subs := range m {
		for _, s := range subs {
			if strings.EqualFold(s.Ext, "json3") {
				return pickedSub{URL: s.URL, Lang: lang}
			}
		}
	}
	return pickedSub{}
}

// json3 формат от YouTube: {events:[{tStartMs:int, dDurationMs:int,
//
//	segs:[{utf8:"text", tOffsetMs?:int}]}]}. Склеиваем текст с line breaks.
func fetchJSON3Transcript(ctx context.Context, url string) (string, error) {
	cmd := exec.CommandContext(ctx, "curl", "-sfL", url)
	out, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("curl: %w", err)
	}
	var blob struct {
		Events []struct {
			Segs []struct {
				Utf8 string `json:"utf8"`
			} `json:"segs"`
		} `json:"events"`
	}
	if err := json.Unmarshal(out, &blob); err != nil {
		return "", fmt.Errorf("parse json3: %w", err)
	}
	var b strings.Builder
	for _, ev := range blob.Events {
		line := ""
		for _, seg := range ev.Segs {
			line += seg.Utf8
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String()), nil
}
