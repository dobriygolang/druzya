package domain

import "errors"

// Sentinel errors. ports/server.go maps them to Connect codes via
// the toConnectErr switch — keeps app/infra stack-free of HTTP awareness.
var (
	ErrNotFound         = errors.New("tutor: not found")
	ErrInviteExpired    = errors.New("tutor: invite expired")
	ErrInviteRevoked    = errors.New("tutor: invite revoked")
	ErrInviteAccepted   = errors.New("tutor: invite already accepted")
	ErrSelfInvite       = errors.New("tutor: cannot accept own invite")
	ErrAlreadyEnrolled  = errors.New("tutor: already enrolled with this tutor")
	ErrInvalidInput     = errors.New("tutor: invalid input")
	ErrAlreadyCompleted = errors.New("tutor: assignment already completed")
)
