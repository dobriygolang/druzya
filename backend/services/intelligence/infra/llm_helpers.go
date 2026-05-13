package infra

// briefJSONEnvelope mirrors the JSON shape locked in by the system prompt.

func firstN(s string, n int) string {
	if n <= 0 {
		return ""
	}
	if len([]rune(s)) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// ─── NoteAnswerer (TaskNoteQA) ────────────────────────────────────────────
