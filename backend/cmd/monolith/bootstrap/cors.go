package bootstrap

import (
	"net/http"
	"os"
	"strings"
)

// CORS middleware. Прежний bootstrap не имел CORS-слоя — Hone (Electron)
// и `vite dev` (localhost:5173) обращаются к druz9.online через Connect-RPC,
// браузер шлёт preflight OPTIONS без Authorization, а RequireAuth ловит
// этот запрос → 401 → fetch fails в browser-side. Решение: top-level
// middleware пропускает OPTIONS без auth, echo'ит Origin из whitelist'а.
//
// Whitelist:
//   - file://             — Electron production build
//   - http://localhost:*  — vite dev (rendered + web frontend)
//   - https://druz9.online, https://druz9.ru — web прод-домены
//   - CORS_ALLOWED_ORIGINS env (csv) — операторский override без редеплоя
//
// «*» намеренно не используем: Connect-RPC шлёт `Authorization: Bearer …`,
// а wildcard несовместим с credentials в большинстве браузеров.
func corsMiddleware() func(http.Handler) http.Handler {
	extra := strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",")
	for i, v := range extra {
		extra[i] = strings.TrimSpace(v)
	}
	allow := func(origin string) bool {
		if origin == "" || origin == "null" {
			// Electron file:// часто шлёт Origin: null. Разрешаем — Hone
			// production билдится в file://.
			return true
		}
		switch origin {
		case "https://druz9.online", "https://druz9.ru", "https://www.druz9.online":
			return true
		}
		if strings.HasPrefix(origin, "http://localhost:") ||
			strings.HasPrefix(origin, "http://127.0.0.1:") {
			return true
		}
		for _, e := range extra {
			if e != "" && e == origin {
				return true
			}
		}
		return false
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && allow(origin) {
				h := w.Header()
				h.Set("Access-Control-Allow-Origin", originValue(origin))
				h.Set("Vary", "Origin")
				h.Set("Access-Control-Allow-Credentials", "true")
				if r.Method == http.MethodOptions {
					reqHeaders := r.Header.Get("Access-Control-Request-Headers")
					if reqHeaders == "" {
						reqHeaders = "authorization, content-type, connect-protocol-version, connect-timeout-ms, x-refresh-token, x-user-agent"
					}
					h.Set("Access-Control-Allow-Headers", reqHeaders)
					h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
					h.Set("Access-Control-Max-Age", "600")
					// Connect-Web reads these to surface server-side trailers.
					h.Set("Access-Control-Expose-Headers", "x-refresh-token, x-is-new-user, content-encoding, grpc-status, grpc-message")
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// originValue — браузер требует точное эхо origin'а, не "*",
// когда Allow-Credentials=true. file://-Origin специально не отдаём
// браузеру (Chrome ругается); вместо null отвечаем "null" буквой.
func originValue(origin string) string {
	if origin == "" {
		return "null"
	}
	return origin
}
