// Speech-to-Text via the Web Speech API (browser-native, $0 cost).
//
// Wraps webkitSpeechRecognition || SpeechRecognition with auto-restart for
// `continuous` mode (browsers silently close the recognizer after ~60s of
// silence; we resurrect it transparently).
function getCtor() {
    if (typeof window === 'undefined')
        return null;
    const w = window;
    return w.SpeechRecognition ??
        w.webkitSpeechRecognition ?? null;
}
export function isSTTSupported() {
    return getCtor() !== null;
}
export function createSTT(opts) {
    const Ctor = getCtor();
    const lang = opts.lang ?? 'ru-RU';
    const continuous = opts.continuous ?? true;
    let rec = null;
    let userWantsRunning = false;
    let state = 'idle';
    const setState = (s) => {
        state = s;
        handle.state = s;
        opts.onStateChange?.(s);
    };
    const build = () => {
        if (!Ctor)
            return null;
        const r = new Ctor();
        r.lang = lang;
        r.continuous = continuous;
        r.interimResults = true;
        r.onstart = () => setState('listening');
        r.onresult = (e) => {
            let interim = '';
            let final = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const res = e.results[i];
                const txt = res[0]?.transcript ?? '';
                if (res.isFinal)
                    final += txt;
                else
                    interim += txt;
            }
            if (interim)
                opts.onInterim?.(interim);
            if (final) {
                setState('finalizing');
                opts.onFinal?.(final);
                if (continuous)
                    setState('listening');
            }
        };
        r.onerror = (e) => {
            // 'no-speech' / 'aborted' are normal — only escalate on real errors.
            if (e.error === 'no-speech' || e.error === 'aborted')
                return;
            setState('error');
            opts.onError?.(e.error);
        };
        r.onend = () => {
            if (userWantsRunning && continuous) {
                // Browser closed it (timeout / silence). Restart silently.
                try {
                    r.start();
                }
                catch {
                    // Already starting — ignore.
                }
            }
            else {
                setState('idle');
            }
        };
        return r;
    };
    const handle = {
        state,
        start() {
            if (!Ctor) {
                opts.onError?.('stt-unsupported');
                setState('error');
                return;
            }
            userWantsRunning = true;
            if (!rec)
                rec = build();
            try {
                rec?.start();
            }
            catch {
                // Already running.
            }
        },
        stop() {
            userWantsRunning = false;
            try {
                rec?.stop();
            }
            catch {
                /* noop */
            }
        },
        abort() {
            userWantsRunning = false;
            try {
                rec?.abort();
            }
            catch {
                /* noop */
            }
            setState('idle');
        },
    };
    return handle;
}
