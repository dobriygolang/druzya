package enums

type UserRole string

const (
	UserRoleUser        UserRole = "user"
	UserRoleInterviewer UserRole = "interviewer"
	UserRoleAdmin       UserRole = "admin"
)

func (r UserRole) IsValid() bool {
	switch r {
	case UserRoleUser, UserRoleInterviewer, UserRoleAdmin:
		return true
	}
	return false
}

func (r UserRole) String() string { return string(r) }

type SubscriptionPlan string

const (
	SubscriptionPlanFree      SubscriptionPlan = "free"
	SubscriptionPlanSeeker    SubscriptionPlan = "seeker"
	SubscriptionPlanAscendant SubscriptionPlan = "ascendant"
)

func (p SubscriptionPlan) IsValid() bool {
	switch p {
	case SubscriptionPlanFree, SubscriptionPlanSeeker, SubscriptionPlanAscendant:
		return true
	}
	return false
}

func (p SubscriptionPlan) String() string { return string(p) }

type AuthProvider string

const (
	AuthProviderYandex   AuthProvider = "yandex"
	AuthProviderTelegram AuthProvider = "telegram"
)

func (p AuthProvider) IsValid() bool {
	switch p {
	case AuthProviderYandex, AuthProviderTelegram:
		return true
	}
	return false
}

func (p AuthProvider) String() string { return string(p) }

type CharClass string

const (
	CharClassNovice       CharClass = "novice"
	CharClassAlgorithmist CharClass = "algorithmist"
	CharClassDBA          CharClass = "dba"
	CharClassBackendDev   CharClass = "backend_dev"
	CharClassArchitect    CharClass = "architect"
	CharClassCommunicator CharClass = "communicator"
	CharClassAscendant    CharClass = "ascendant"
)

func (c CharClass) IsValid() bool {
	switch c {
	case CharClassNovice, CharClassAlgorithmist, CharClassDBA, CharClassBackendDev,
		CharClassArchitect, CharClassCommunicator, CharClassAscendant:
		return true
	}
	return false
}

func (c CharClass) String() string { return string(c) }
