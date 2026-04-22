package services

import (
	"fmt"
	"net/http"

	"connectrpc.com/vanguard"
)

// mustTranscode wraps a Connect handler in a vanguard transcoder so the same
// implementation serves both the native Connect path and the REST aliases
// declared via google.api.http annotations. Failure here means the proto
// descriptors are malformed — there is no recoverable behaviour, so we
// panic with a name-tagged message and let bootstrap convert it to
// os.Exit(1).
func mustTranscode(name, path string, h http.Handler) http.Handler {
	t, err := vanguard.NewTranscoder([]*vanguard.Service{
		vanguard.NewService(path, h),
	})
	if err != nil {
		panic(fmt.Errorf("vanguard.NewTranscoder %s: %w", name, err))
	}
	return t
}
