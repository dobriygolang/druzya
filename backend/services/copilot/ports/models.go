package ports

import (
	"druz9/copilot/domain"
	"druz9/shared/enums"
	pb "druz9/shared/generated/pb/druz9/v1"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// ─────────────────────────────────────────────────────────────────────────
// Enum projections
// ─────────────────────────────────────────────────────────────────────────

func planToProto(p enums.SubscriptionPlan) pb.SubscriptionPlan {
	switch p {
	case enums.SubscriptionPlanFree:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_FREE
	case enums.SubscriptionPlanSeeker:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_SEEKER
	case enums.SubscriptionPlanAscendant:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_ASCENDANT
	default:
		return pb.SubscriptionPlan_SUBSCRIPTION_PLAN_UNSPECIFIED
	}
}

func roleToProto(r enums.MessageRole) pb.MessageRole {
	switch r {
	case enums.MessageRoleSystem:
		return pb.MessageRole_MESSAGE_ROLE_SYSTEM
	case enums.MessageRoleUser:
		return pb.MessageRole_MESSAGE_ROLE_USER
	case enums.MessageRoleAssistant:
		return pb.MessageRole_MESSAGE_ROLE_ASSISTANT
	default:
		return pb.MessageRole_MESSAGE_ROLE_UNSPECIFIED
	}
}

func speedClassToProto(s domain.ModelSpeedClass) pb.ModelSpeedClass {
	switch s {
	case domain.ModelSpeedClassUnspecified:
		return pb.ModelSpeedClass_MODEL_SPEED_CLASS_UNSPECIFIED
	case domain.ModelSpeedClassFast:
		return pb.ModelSpeedClass_MODEL_SPEED_CLASS_FAST
	case domain.ModelSpeedClassBalanced:
		return pb.ModelSpeedClass_MODEL_SPEED_CLASS_BALANCED
	case domain.ModelSpeedClassReasoning:
		return pb.ModelSpeedClass_MODEL_SPEED_CLASS_REASONING
	default:
		return pb.ModelSpeedClass_MODEL_SPEED_CLASS_UNSPECIFIED
	}
}

func hotkeyActionToProto(a domain.HotkeyAction) pb.HotkeyAction {
	switch a {
	case domain.HotkeyActionUnspecified:
		return pb.HotkeyAction_HOTKEY_ACTION_UNSPECIFIED
	case domain.HotkeyActionScreenshotArea:
		return pb.HotkeyAction_HOTKEY_ACTION_SCREENSHOT_AREA
	case domain.HotkeyActionScreenshotFull:
		return pb.HotkeyAction_HOTKEY_ACTION_SCREENSHOT_FULL
	case domain.HotkeyActionVoiceInput:
		return pb.HotkeyAction_HOTKEY_ACTION_VOICE_INPUT
	case domain.HotkeyActionToggleWindow:
		return pb.HotkeyAction_HOTKEY_ACTION_TOGGLE_WINDOW
	case domain.HotkeyActionQuickPrompt:
		return pb.HotkeyAction_HOTKEY_ACTION_QUICK_PROMPT
	case domain.HotkeyActionClearConversation:
		return pb.HotkeyAction_HOTKEY_ACTION_CLEAR_CONVERSATION
	case domain.HotkeyActionCursorFreezeToggle:
		return pb.HotkeyAction_HOTKEY_ACTION_CURSOR_FREEZE_TOGGLE
	default:
		return pb.HotkeyAction_HOTKEY_ACTION_UNSPECIFIED
	}
}

func hotkeyActionFromProto(p pb.HotkeyAction) domain.HotkeyAction {
	switch p {
	case pb.HotkeyAction_HOTKEY_ACTION_UNSPECIFIED:
		return domain.HotkeyActionUnspecified
	case pb.HotkeyAction_HOTKEY_ACTION_SCREENSHOT_AREA:
		return domain.HotkeyActionScreenshotArea
	case pb.HotkeyAction_HOTKEY_ACTION_SCREENSHOT_FULL:
		return domain.HotkeyActionScreenshotFull
	case pb.HotkeyAction_HOTKEY_ACTION_VOICE_INPUT:
		return domain.HotkeyActionVoiceInput
	case pb.HotkeyAction_HOTKEY_ACTION_TOGGLE_WINDOW:
		return domain.HotkeyActionToggleWindow
	case pb.HotkeyAction_HOTKEY_ACTION_QUICK_PROMPT:
		return domain.HotkeyActionQuickPrompt
	case pb.HotkeyAction_HOTKEY_ACTION_CLEAR_CONVERSATION:
		return domain.HotkeyActionClearConversation
	case pb.HotkeyAction_HOTKEY_ACTION_CURSOR_FREEZE_TOGGLE:
		return domain.HotkeyActionCursorFreezeToggle
	default:
		return domain.HotkeyActionUnspecified
	}
}

func clientOSFromProto(p pb.ClientOS) domain.ClientOS {
	switch p {
	case pb.ClientOS_CLIENT_OS_UNSPECIFIED:
		return domain.ClientOSUnspecified
	case pb.ClientOS_CLIENT_OS_MACOS:
		return domain.ClientOSMacOS
	case pb.ClientOS_CLIENT_OS_WINDOWS:
		return domain.ClientOSWindows
	case pb.ClientOS_CLIENT_OS_LINUX:
		return domain.ClientOSLinux
	default:
		return domain.ClientOSUnspecified
	}
}

func attachmentKindFromProto(p pb.CopilotAttachmentKind) domain.AttachmentKind {
	switch p {
	case pb.CopilotAttachmentKind_COPILOT_ATTACHMENT_KIND_UNSPECIFIED:
		return domain.AttachmentKindUnspecified
	case pb.CopilotAttachmentKind_COPILOT_ATTACHMENT_KIND_SCREENSHOT:
		return domain.AttachmentKindScreenshot
	case pb.CopilotAttachmentKind_COPILOT_ATTACHMENT_KIND_VOICE_TRANSCRIPT:
		return domain.AttachmentKindVoiceTranscript
	default:
		return domain.AttachmentKindUnspecified
	}
}

// ─────────────────────────────────────────────────────────────────────────
// Domain → proto
// ─────────────────────────────────────────────────────────────────────────

func conversationToProto(c domain.Conversation, messageCount int) *pb.CopilotConversation {
	return &pb.CopilotConversation{
		Id:           c.ID.String(),
		Title:        c.Title,
		Model:        c.Model,
		CreatedAt:    timestamppb.New(c.CreatedAt),
		UpdatedAt:    timestamppb.New(c.UpdatedAt),
		MessageCount: int32(messageCount),
	}
}

func conversationSummaryToProto(s domain.ConversationSummary) *pb.CopilotConversation {
	return conversationToProto(s.Conversation, s.MessageCount)
}

func messageToProto(m domain.Message) *pb.CopilotMessage {
	out := &pb.CopilotMessage{
		Id:             m.ID.String(),
		ConversationId: m.ConversationID.String(),
		Role:           roleToProto(m.Role),
		Content:        m.Content,
		HasScreenshot:  m.HasScreenshot,
		TokensIn:       int32(m.TokensIn),
		TokensOut:      int32(m.TokensOut),
		LatencyMs:      int32(m.LatencyMs),
		CreatedAt:      timestamppb.New(m.CreatedAt),
	}
	if m.Rating != nil {
		out.Rating = int32(*m.Rating)
	}
	return out
}

func conversationDetailToProto(d domain.ConversationDetail) *pb.CopilotConversationDetail {
	msgs := make([]*pb.CopilotMessage, 0, len(d.Messages))
	for _, m := range d.Messages {
		msgs = append(msgs, messageToProto(m))
	}
	return &pb.CopilotConversationDetail{
		Conversation: conversationToProto(d.Conversation, len(d.Messages)),
		Messages:     msgs,
	}
}

func quotaToProto(q domain.Quota) *pb.CopilotQuota {
	return &pb.CopilotQuota{
		Plan:          planToProto(q.Plan),
		RequestsUsed:  int32(q.RequestsUsed),
		RequestsCap:   int32(q.RequestsCap),
		ResetsAt:      timestamppb.New(q.ResetsAt),
		ModelsAllowed: append([]string(nil), q.ModelsAllowed...),
	}
}

func providerModelToProto(m domain.ProviderModel) *pb.CopilotProviderModel {
	return &pb.CopilotProviderModel{
		Id:                     m.ID,
		DisplayName:            m.DisplayName,
		ProviderName:           m.ProviderName,
		SpeedClass:             speedClassToProto(m.SpeedClass),
		SupportsVision:         m.SupportsVision,
		SupportsReasoning:      m.SupportsReasoning,
		TypicalLatencyMs:       int32(m.TypicalLatencyMs),
		ContextWindowTokens:    int32(m.ContextWindowTokens),
		AvailableOnCurrentPlan: m.AvailableOnCurrentPlan,
	}
}

func hotkeyBindingToProto(b domain.HotkeyBinding) *pb.HotkeyBinding {
	return &pb.HotkeyBinding{
		Action:      hotkeyActionToProto(b.Action),
		Accelerator: b.Accelerator,
	}
}

func featureFlagToProto(f domain.FeatureFlag) *pb.FeatureFlag {
	return &pb.FeatureFlag{Key: f.Key, Enabled: f.Enabled}
}

func paywallCopyToProto(p domain.PaywallCopy) *pb.PaywallCopy {
	return &pb.PaywallCopy{
		PlanId:       p.PlanID,
		DisplayName:  p.DisplayName,
		PriceLabel:   p.PriceLabel,
		Tagline:      p.Tagline,
		Bullets:      append([]string(nil), p.Bullets...),
		CtaLabel:     p.CTALabel,
		SubscribeUrl: p.SubscribeURL,
	}
}

func stealthEntryToProto(s domain.StealthCompatEntry) *pb.StealthCompatEntry {
	return &pb.StealthCompatEntry{
		OsVersionMin:      s.OSVersionMin,
		OsVersionMax:      s.OSVersionMax,
		BrowserId:         s.BrowserID,
		BrowserVersionMin: s.BrowserVersionMin,
		BrowserVersionMax: s.BrowserVersionMax,
		Note:              s.Note,
	}
}

func desktopConfigToProto(c domain.DesktopConfig) *pb.DesktopConfig {
	out := &pb.DesktopConfig{
		Rev:                c.Rev,
		DefaultModelId:     c.DefaultModelID,
		UpdateFeedUrl:      c.UpdateFeedURL,
		MinClientVersion:   c.MinClientVersion,
		AnalyticsPolicyKey: c.AnalyticsPolicyKey,
	}
	out.Models = make([]*pb.CopilotProviderModel, 0, len(c.Models))
	for _, m := range c.Models {
		out.Models = append(out.Models, providerModelToProto(m))
	}
	out.DefaultHotkeys = make([]*pb.HotkeyBinding, 0, len(c.DefaultHotkeys))
	for _, h := range c.DefaultHotkeys {
		out.DefaultHotkeys = append(out.DefaultHotkeys, hotkeyBindingToProto(h))
	}
	out.Flags = make([]*pb.FeatureFlag, 0, len(c.Flags))
	for _, f := range c.Flags {
		out.Flags = append(out.Flags, featureFlagToProto(f))
	}
	out.Paywall = make([]*pb.PaywallCopy, 0, len(c.Paywall))
	for _, p := range c.Paywall {
		out.Paywall = append(out.Paywall, paywallCopyToProto(p))
	}
	out.StealthWarnings = make([]*pb.StealthCompatEntry, 0, len(c.StealthWarnings))
	for _, s := range c.StealthWarnings {
		out.StealthWarnings = append(out.StealthWarnings, stealthEntryToProto(s))
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// Proto → domain
// ─────────────────────────────────────────────────────────────────────────

func attachmentFromProto(p *pb.CopilotAttachmentInput) domain.AttachmentInput {
	if p == nil {
		return domain.AttachmentInput{}
	}
	return domain.AttachmentInput{
		Kind:     attachmentKindFromProto(p.GetKind()),
		Data:     p.GetData(),
		MimeType: p.GetMimeType(),
		Width:    int(p.GetWidth()),
		Height:   int(p.GetHeight()),
	}
}

func attachmentsFromProto(in []*pb.CopilotAttachmentInput) []domain.AttachmentInput {
	out := make([]domain.AttachmentInput, 0, len(in))
	for _, p := range in {
		out = append(out, attachmentFromProto(p))
	}
	return out
}

func sessionKindFromProto(k pb.CopilotSessionKind) domain.SessionKind {
	switch k {
	case pb.CopilotSessionKind_COPILOT_SESSION_KIND_INTERVIEW:
		return domain.SessionKindInterview
	case pb.CopilotSessionKind_COPILOT_SESSION_KIND_WORK:
		return domain.SessionKindWork
	case pb.CopilotSessionKind_COPILOT_SESSION_KIND_CASUAL:
		return domain.SessionKindCasual
	default:
		return domain.SessionKindUnspecified
	}
}

func sessionKindToProto(k domain.SessionKind) pb.CopilotSessionKind {
	switch k {
	case domain.SessionKindInterview:
		return pb.CopilotSessionKind_COPILOT_SESSION_KIND_INTERVIEW
	case domain.SessionKindWork:
		return pb.CopilotSessionKind_COPILOT_SESSION_KIND_WORK
	case domain.SessionKindCasual:
		return pb.CopilotSessionKind_COPILOT_SESSION_KIND_CASUAL
	default:
		return pb.CopilotSessionKind_COPILOT_SESSION_KIND_UNSPECIFIED
	}
}

func analysisStatusToProto(s domain.AnalysisStatus) pb.CopilotAnalysisStatus {
	switch s {
	case domain.AnalysisStatusPending:
		return pb.CopilotAnalysisStatus_COPILOT_ANALYSIS_STATUS_PENDING
	case domain.AnalysisStatusRunning:
		return pb.CopilotAnalysisStatus_COPILOT_ANALYSIS_STATUS_RUNNING
	case domain.AnalysisStatusReady:
		return pb.CopilotAnalysisStatus_COPILOT_ANALYSIS_STATUS_READY
	case domain.AnalysisStatusFailed:
		return pb.CopilotAnalysisStatus_COPILOT_ANALYSIS_STATUS_FAILED
	default:
		return pb.CopilotAnalysisStatus_COPILOT_ANALYSIS_STATUS_UNSPECIFIED
	}
}

func sessionToProto(s domain.Session, convCount int) *pb.CopilotSession {
	out := &pb.CopilotSession{
		Id:                s.ID.String(),
		Kind:              sessionKindToProto(s.Kind),
		StartedAt:         timestamppb.New(s.StartedAt),
		ConversationCount: int32(convCount),
		ByokOnly:          s.BYOKOnly,
	}
	if s.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(*s.FinishedAt)
	}
	return out
}

func sessionSummaryToProto(s domain.SessionSummary) *pb.CopilotSession {
	return sessionToProto(s.Session, s.ConversationCount)
}

func reportToProto(r domain.SessionReport) *pb.CopilotSessionAnalysis {
	out := &pb.CopilotSessionAnalysis{
		SessionId:       r.SessionID.String(),
		Status:          analysisStatusToProto(r.Status),
		OverallScore:    int32(r.OverallScore),
		SectionScores:   make(map[string]int32, len(r.SectionScores)),
		Weaknesses:      append([]string(nil), r.Weaknesses...),
		Recommendations: append([]string(nil), r.Recommendations...),
		ReportMarkdown:  r.ReportMarkdown,
		ReportUrl:       r.ReportURL,
		ErrorMessage:    r.ErrorMessage,
	}
	for k, v := range r.SectionScores {
		out.SectionScores[k] = int32(v)
	}
	for _, l := range r.Links {
		out.Links = append(out.Links, &pb.CopilotAnalysisLink{Label: l.Label, Url: l.URL})
	}
	if r.StartedAt != nil {
		out.StartedAt = timestamppb.New(*r.StartedAt)
	}
	if r.FinishedAt != nil {
		out.FinishedAt = timestamppb.New(*r.FinishedAt)
	}
	return out
}

func clientContextFromProto(p *pb.ClientContext) domain.ClientContext {
	if p == nil {
		return domain.ClientContext{}
	}
	return domain.ClientContext{
		OS:             clientOSFromProto(p.GetOs()),
		OSVersion:      p.GetOsVersion(),
		AppVersion:     p.GetAppVersion(),
		TriggerAction:  hotkeyActionFromProto(p.GetTriggerAction()),
		FocusedAppHint: p.GetFocusedAppHint(),
	}
}
