package enums

type EditorRole string

const (
	EditorRoleOwner       EditorRole = "owner"
	EditorRoleInterviewer EditorRole = "interviewer"
	EditorRoleParticipant EditorRole = "participant"
	EditorRoleViewer      EditorRole = "viewer"
)

func (r EditorRole) IsValid() bool {
	switch r {
	case EditorRoleOwner, EditorRoleInterviewer, EditorRoleParticipant, EditorRoleViewer:
		return true
	}
	return false
}

func (r EditorRole) String() string { return string(r) }

func (r EditorRole) CanEdit() bool {
	switch r {
	case EditorRoleOwner, EditorRoleInterviewer, EditorRoleParticipant:
		return true
	case EditorRoleViewer:
		return false
	}
	return false
}

type EditorEventType string

const (
	EditorEventPause          EditorEventType = "pause"
	EditorEventBackspaceBurst EditorEventType = "backspace_burst"
	EditorEventChaoticEdit    EditorEventType = "chaotic_edit"
	EditorEventPasteAttempt   EditorEventType = "paste_attempt"
	EditorEventIdle           EditorEventType = "idle"
)

func (e EditorEventType) IsValid() bool {
	switch e {
	case EditorEventPause, EditorEventBackspaceBurst, EditorEventChaoticEdit,
		EditorEventPasteAttempt, EditorEventIdle:
		return true
	}
	return false
}

func (e EditorEventType) String() string { return string(e) }
