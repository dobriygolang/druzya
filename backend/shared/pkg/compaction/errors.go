package compaction

import "errors"

// ErrInvalidConfig — невалидный Config (window_size/threshold).
var ErrInvalidConfig = errors.New("compaction: invalid config")

// ErrWorkerStopped — попытка Submit после Shutdown.
var ErrWorkerStopped = errors.New("compaction: worker stopped")

type cfgErr struct{ msg string }

func (e *cfgErr) Error() string { return "compaction: invalid config: " + e.msg }
func (e *cfgErr) Unwrap() error { return ErrInvalidConfig }

func errInvalidConfig(msg string) error { return &cfgErr{msg: msg} }
