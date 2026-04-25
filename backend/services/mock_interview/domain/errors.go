package domain

import "errors"

// Domain errors. Ports translate these to HTTP status / Connect codes.
var (
	ErrNotFound        = errors.New("mock_interview: not found")
	ErrConflict        = errors.New("mock_interview: conflict")
	ErrValidation      = errors.New("mock_interview: validation")
	ErrNoTaskAvailable = errors.New("mock_interview: no task available for stage")
)
