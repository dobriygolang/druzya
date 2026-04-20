package enums

type SeverityLevel string

const (
	SeverityLow    SeverityLevel = "low"
	SeverityMedium SeverityLevel = "medium"
	SeverityHigh   SeverityLevel = "high"
)

func (s SeverityLevel) IsValid() bool {
	switch s {
	case SeverityLow, SeverityMedium, SeverityHigh:
		return true
	}
	return false
}

func (s SeverityLevel) String() string { return string(s) }

type AnticheatSignalType string

const (
	AnticheatPasteDetected     AnticheatSignalType = "paste_detected"
	AnticheatTabSwitch         AnticheatSignalType = "tab_switch"
	AnticheatAnomalousSpeed    AnticheatSignalType = "anomalous_speed"
	AnticheatSuspiciousPattern AnticheatSignalType = "suspicious_pattern"
)

func (a AnticheatSignalType) IsValid() bool {
	switch a {
	case AnticheatPasteDetected, AnticheatTabSwitch,
		AnticheatAnomalousSpeed, AnticheatSuspiciousPattern:
		return true
	}
	return false
}

func (a AnticheatSignalType) String() string { return string(a) }
