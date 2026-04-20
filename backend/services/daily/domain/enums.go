package domain

// AutopsyOutcome is the user-reported result of an external interview.
// Kept in this package because it is not used by any other domain; should the
// surface expand, promote to shared/enums.
type AutopsyOutcome string

const (
	AutopsyOutcomeOffer     AutopsyOutcome = "offer"
	AutopsyOutcomeRejection AutopsyOutcome = "rejection"
	AutopsyOutcomePending   AutopsyOutcome = "pending"
)

// IsValid enforces exhaustive switches.
func (o AutopsyOutcome) IsValid() bool {
	switch o {
	case AutopsyOutcomeOffer, AutopsyOutcomeRejection, AutopsyOutcomePending:
		return true
	}
	return false
}

// String implements fmt.Stringer.
func (o AutopsyOutcome) String() string { return string(o) }

// AutopsyStatus is the background-job state of an autopsy.
type AutopsyStatus string

const (
	AutopsyStatusProcessing AutopsyStatus = "processing"
	AutopsyStatusReady      AutopsyStatus = "ready"
	AutopsyStatusFailed     AutopsyStatus = "failed"
)

// IsValid enforces exhaustive switches.
func (s AutopsyStatus) IsValid() bool {
	switch s {
	case AutopsyStatusProcessing, AutopsyStatusReady, AutopsyStatusFailed:
		return true
	}
	return false
}

// String implements fmt.Stringer.
func (s AutopsyStatus) String() string { return string(s) }
