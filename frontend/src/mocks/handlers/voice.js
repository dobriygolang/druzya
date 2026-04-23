// MSW handlers for the voice feature.
//
// /voice/tts → returns either a tiny silent MP3 OR 402 if the requested
//              voice is `premium-*` and the dev-toggled tier is 'free'.
// /voice/turn → echoes a canned AI reply after a 500ms "thinking" delay.
import { delay, http, HttpResponse } from 'msw';
const base = '/api/v1';
// Minimal valid silent MP3 (ID3v2 header + a single tiny MPEG frame).
// Browsers happily accept this and `.play()` resolves immediately. Not
// audible — exists purely so the audio pipeline runs end-to-end in tests.
function buildSilentMp3() {
    // ID3v2.3 tag with an empty payload.
    const id3 = [
        0x49, 0x44, 0x33, // 'ID3'
        0x03, 0x00, // version 2.3
        0x00, // flags
        0x00, 0x00, 0x00, 0x0a, // size = 10
        // 10 zero bytes of padding
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    // MPEG-1 Layer III frame header for 32 kbps / 22.05 kHz mono — produces a
    // very short slice of silence. We pad with 0x00 to fill a tiny frame body.
    const frameHeader = [0xff, 0xfb, 0x14, 0xc4];
    const framePadding = new Array(96).fill(0x00);
    return new Uint8Array([...id3, ...frameHeader, ...framePadding]);
}
const silentMp3 = buildSilentMp3();
const replies = [
    'Хороший вопрос. Расскажи, как ты бы реализовал eviction policy.',
    'Понятно. А что произойдёт под высокой конкурентной нагрузкой?',
    'Объясни глубже про amortized complexity этого подхода.',
    'Ок, перейдём к следующему вопросу — расскажи про индексы.',
];
function readTier() {
    if (typeof localStorage === 'undefined')
        return 'free';
    return localStorage.getItem('druz9_user_tier') ?? 'free';
}
export const voiceHandlers = [
    http.post(`${base}/voice/tts`, async ({ request }) => {
        const body = (await request.json().catch(() => ({})));
        const tier = readTier();
        if (typeof body.voice === 'string' && body.voice.startsWith('premium-') && tier === 'free') {
            return HttpResponse.json({ error: 'premium_required', tier_required: 'premium' }, { status: 402 });
        }
        return new HttpResponse(silentMp3, {
            headers: {
                'Content-Type': 'audio/mpeg',
                'Content-Length': String(silentMp3.byteLength),
            },
        });
    }),
    http.post(`${base}/voice/turn`, async () => {
        await delay(500);
        const aiText = replies[Math.floor(Math.random() * replies.length)];
        return HttpResponse.json({ aiText, audioUrl: null });
    }),
];
