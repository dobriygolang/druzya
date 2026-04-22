// Subcommand `health` для distroless-образа: docker HEALTHCHECK не может
// дёрнуть wget/curl (их в образе нет), поэтому пробу делает сам бинарь.
//
//	HEALTHCHECK CMD ["/app/monolith", "health"]
//
// URL берётся из HTTP_ADDR (тот же, что слушает API). Возвращаем exit 0
// при HTTP 2xx, иначе exit 1 — docker сам пометит контейнер unhealthy.
package main

import (
	"context"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

func runHealth() {
	addr := os.Getenv("HTTP_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		// addr был в формате ":8080" — уже port-only.
		host, port = "", strings.TrimPrefix(addr, ":")
	}
	if host == "" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	url := "http://" + net.JoinHostPort(host, port) + "/health/ready"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		os.Exit(1)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		os.Exit(1)
	}
}
