package enums

type SlotStatus string

const (
	SlotStatusAvailable SlotStatus = "available"
	SlotStatusBooked    SlotStatus = "booked"
	SlotStatusCompleted SlotStatus = "completed"
	SlotStatusCancelled SlotStatus = "cancelled"
	SlotStatusNoShow    SlotStatus = "no_show"
)

func (s SlotStatus) IsValid() bool {
	switch s {
	case SlotStatusAvailable, SlotStatusBooked, SlotStatusCompleted,
		SlotStatusCancelled, SlotStatusNoShow:
		return true
	}
	return false
}

func (s SlotStatus) String() string { return string(s) }
