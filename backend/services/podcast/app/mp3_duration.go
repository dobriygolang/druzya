package app

// MP3 duration extractor — pure Go, no deps. Парсит первый MP3-frame
// header после опционального ID3v2-тега, считает duration по
// первому-frame bitrate × file_size. Точно для CBR, ±5% для VBR
// (для UI prog-bar'а достаточно).
//
// Поддерживает MPEG-1 / MPEG-2 / MPEG-2.5, Layer III (типичный mp3).
// Для других контейнеров (m4a, opus) возвращает 0 — caller в этом
// случае оставляет user-provided DurationSec (или 0).

func extractMP3Duration(payload []byte) int {
	if len(payload) < 14 {
		return 0
	}
	offset := 0
	// Skip ID3v2 header (synchsafe size).
	if payload[0] == 'I' && payload[1] == 'D' && payload[2] == '3' {
		size := int(payload[6]&0x7F)<<21 |
			int(payload[7]&0x7F)<<14 |
			int(payload[8]&0x7F)<<7 |
			int(payload[9]&0x7F)
		offset = 10 + size
	}
	if offset >= len(payload)-4 {
		return 0
	}
	// Sync to first 0xFFE-prefixed frame header.
	syncIdx := -1
	for i := offset; i < len(payload)-4; i++ {
		if payload[i] == 0xFF && (payload[i+1]&0xE0) == 0xE0 {
			syncIdx = i
			break
		}
	}
	if syncIdx < 0 || syncIdx >= len(payload)-4 {
		return 0
	}
	h1 := payload[syncIdx+1]
	h2 := payload[syncIdx+2]
	versionID := (h1 >> 3) & 0x03 // 0=v2.5, 2=v2, 3=v1
	layer := (h1 >> 1) & 0x03     // 1=Layer III
	if layer != 1 {
		// Не Layer III — наш bitrate-таблица не подойдёт.
		return 0
	}
	bitrateIdx := (h2 >> 4) & 0x0F
	sampleRateIdx := (h2 >> 2) & 0x03
	if bitrateIdx == 0 || bitrateIdx == 0x0F || sampleRateIdx == 0x03 {
		return 0
	}

	// Layer III bitrate tables (kbps)
	var bitrateTable [16]int
	if versionID == 3 {
		// MPEG-1 L3
		bitrateTable = [16]int{
			0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
		}
	} else {
		// MPEG-2 / 2.5 L3
		bitrateTable = [16]int{
			0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
		}
	}
	bitrateKbps := bitrateTable[bitrateIdx]
	if bitrateKbps == 0 {
		return 0
	}

	// Sample-rate tables
	var sampleRates [3]int
	switch versionID {
	case 3: // V1
		sampleRates = [3]int{44100, 48000, 32000}
	case 2: // V2
		sampleRates = [3]int{22050, 24000, 16000}
	case 0: // V2.5
		sampleRates = [3]int{11025, 12000, 8000}
	default:
		return 0
	}
	sampleRate := sampleRates[sampleRateIdx]
	if sampleRate == 0 {
		return 0
	}

	bps := bitrateKbps * 1000
	audioBytes := len(payload) - syncIdx
	// duration_sec = audio_bytes * 8 / bitrate_bps
	sec := (audioBytes * 8) / bps
	if sec < 1 {
		return 0
	}
	return sec
}
