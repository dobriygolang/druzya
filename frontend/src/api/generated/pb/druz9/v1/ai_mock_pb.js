// ai_mock.proto — Connect-RPC contract for the `ai_mock` bounded context.
//
// Covers the six /mock/session/* REST endpoints. The /ws/mock/{sessionId}
// WebSocket is NOT modelled here — it stays as a raw chi route wired to
// mockWS.Handle in main.go (token streaming + stress pushes are out of scope
// for Connect transcoding).
import { Message, proto3, protoInt64, Timestamp } from "@bufbuild/protobuf";
import { Difficulty, EditorEventType, LLMModel, MessageRole, MockStatus, Section } from "./common_pb.js";
/**
 * MockTaskPublic mirrors OpenAPI TaskPublic used by ai_mock. Kept separate from
 * ArenaTaskPublic to avoid cross-service coupling, though the wire shape is
 * identical.
 *
 * @generated from message druz9.v1.MockTaskPublic
 */
export class MockTaskPublic extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string slug = 2;
     */
    slug = "";
    /**
     * @generated from field: string title = 3;
     */
    title = "";
    /**
     * @generated from field: string description = 4;
     */
    description = "";
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 5;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Section section = 6;
     */
    section = Section.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockTaskPublic";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 6, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
    ]);
    static fromBinary(bytes, options) {
        return new MockTaskPublic().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockTaskPublic().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockTaskPublic().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockTaskPublic, a, b);
    }
}
/**
 * MockStressProfile mirrors OpenAPI StressProfile.
 *
 * @generated from message druz9.v1.MockStressProfile
 */
export class MockStressProfile extends Message {
    /**
     * @generated from field: int32 pauses_score = 1;
     */
    pausesScore = 0;
    /**
     * @generated from field: int32 backspace_score = 2;
     */
    backspaceScore = 0;
    /**
     * @generated from field: int32 chaos_score = 3;
     */
    chaosScore = 0;
    /**
     * @generated from field: int32 paste_attempts = 4;
     */
    pasteAttempts = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockStressProfile";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "pauses_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "backspace_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "chaos_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "paste_attempts", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new MockStressProfile().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockStressProfile().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockStressProfile().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockStressProfile, a, b);
    }
}
/**
 * MockMessage mirrors OpenAPI MockMessage.
 *
 * @generated from message druz9.v1.MockMessage
 */
export class MockMessage extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: druz9.v1.MessageRole role = 2;
     */
    role = MessageRole.UNSPECIFIED;
    /**
     * @generated from field: string content = 3;
     */
    content = "";
    /**
     * @generated from field: int32 tokens_used = 4;
     */
    tokensUsed = 0;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 5;
     */
    createdAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockMessage";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "role", kind: "enum", T: proto3.getEnumType(MessageRole) },
        { no: 3, name: "content", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "tokens_used", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "created_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new MockMessage().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockMessage().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockMessage().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockMessage, a, b);
    }
}
/**
 * MockSession mirrors OpenAPI MockSession.
 *
 * @generated from message druz9.v1.MockSession
 */
export class MockSession extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: druz9.v1.MockStatus status = 2;
     */
    status = MockStatus.UNSPECIFIED;
    /**
     * @generated from field: string company_id = 3;
     */
    companyId = "";
    /**
     * @generated from field: druz9.v1.Section section = 4;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 5;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: int32 duration_min = 6;
     */
    durationMin = 0;
    /**
     * @generated from field: druz9.v1.MockTaskPublic task = 7;
     */
    task;
    /**
     * @generated from field: google.protobuf.Timestamp started_at = 8;
     */
    startedAt;
    /**
     * @generated from field: google.protobuf.Timestamp finished_at = 9;
     */
    finishedAt;
    /**
     * @generated from field: repeated druz9.v1.MockMessage last_messages = 10;
     */
    lastMessages = [];
    /**
     * @generated from field: druz9.v1.MockStressProfile stress_profile = 11;
     */
    stressProfile;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockSession";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "status", kind: "enum", T: proto3.getEnumType(MockStatus) },
        { no: 3, name: "company_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 5, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 6, name: "duration_min", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 7, name: "task", kind: "message", T: MockTaskPublic },
        { no: 8, name: "started_at", kind: "message", T: Timestamp },
        { no: 9, name: "finished_at", kind: "message", T: Timestamp },
        { no: 10, name: "last_messages", kind: "message", T: MockMessage, repeated: true },
        { no: 11, name: "stress_profile", kind: "message", T: MockStressProfile },
    ]);
    static fromBinary(bytes, options) {
        return new MockSession().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockSession().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockSession().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockSession, a, b);
    }
}
/**
 * CreateMockRequest mirrors OpenAPI CreateMockRequest.
 *
 * @generated from message druz9.v1.CreateMockRequest
 */
export class CreateMockRequest extends Message {
    /**
     * @generated from field: string company_id = 1;
     */
    companyId = "";
    /**
     * @generated from field: druz9.v1.Section section = 2;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 3;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: int32 duration_min = 4;
     */
    durationMin = 0;
    /**
     * @generated from field: bool voice_mode = 5;
     */
    voiceMode = false;
    /**
     * @generated from field: string paired_user_id = 6;
     */
    pairedUserId = "";
    /**
     * @generated from field: bool devils_advocate = 7;
     */
    devilsAdvocate = false;
    /**
     * @generated from field: druz9.v1.LLMModel llm_model = 8;
     */
    llmModel = LLMModel.LLM_MODEL_UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateMockRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "company_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 3, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 4, name: "duration_min", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "voice_mode", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 6, name: "paired_user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 7, name: "devils_advocate", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 8, name: "llm_model", kind: "enum", T: proto3.getEnumType(LLMModel) },
    ]);
    static fromBinary(bytes, options) {
        return new CreateMockRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateMockRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateMockRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateMockRequest, a, b);
    }
}
/**
 * MockMessageRequest mirrors OpenAPI MockMessageRequest.
 *
 * @generated from message druz9.v1.MockMessageRequest
 */
export class MockMessageRequest extends Message {
    /**
     * path param
     *
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    /**
     * @generated from field: string content = 2;
     */
    content = "";
    /**
     * @generated from field: string code_snapshot = 3;
     */
    codeSnapshot = "";
    /**
     * @generated from field: string voice_transcript = 4;
     */
    voiceTranscript = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockMessageRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "content", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "code_snapshot", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "voice_transcript", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new MockMessageRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockMessageRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockMessageRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockMessageRequest, a, b);
    }
}
/**
 * StressEvent mirrors OpenAPI StressEvent. Metadata is free-form JSON in
 * OpenAPI; proto collapses it to map<string,string> (scalar values round-trip
 * safely; complex values should be JSON-encoded as strings at the edge).
 *
 * @generated from message druz9.v1.StressEvent
 */
export class StressEvent extends Message {
    /**
     * @generated from field: druz9.v1.EditorEventType type = 1;
     */
    type = EditorEventType.UNSPECIFIED;
    /**
     * @generated from field: int64 at_ms = 2;
     */
    atMs = protoInt64.zero;
    /**
     * @generated from field: int64 duration_ms = 3;
     */
    durationMs = protoInt64.zero;
    /**
     * @generated from field: map<string, string> metadata = 4;
     */
    metadata = {};
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.StressEvent";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "type", kind: "enum", T: proto3.getEnumType(EditorEventType) },
        { no: 2, name: "at_ms", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 3, name: "duration_ms", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 4, name: "metadata", kind: "map", K: 9 /* ScalarType.STRING */, V: { kind: "scalar", T: 9 /* ScalarType.STRING */ } },
    ]);
    static fromBinary(bytes, options) {
        return new StressEvent().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new StressEvent().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new StressEvent().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(StressEvent, a, b);
    }
}
/**
 * StressEventsBatch mirrors OpenAPI StressEventsBatch.
 *
 * @generated from message druz9.v1.StressEventsBatch
 */
export class StressEventsBatch extends Message {
    /**
     * path param
     *
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    /**
     * @generated from field: repeated druz9.v1.StressEvent events = 2;
     */
    events = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.StressEventsBatch";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "events", kind: "message", T: StressEvent, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new StressEventsBatch().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new StressEventsBatch().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new StressEventsBatch().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(StressEventsBatch, a, b);
    }
}
/**
 * MockScoredSection mirrors OpenAPI ScoredSection.
 *
 * @generated from message druz9.v1.MockScoredSection
 */
export class MockScoredSection extends Message {
    /**
     * @generated from field: int32 score = 1;
     */
    score = 0;
    /**
     * @generated from field: string comment = 2;
     */
    comment = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockScoredSection";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "comment", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new MockScoredSection().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockScoredSection().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockScoredSection().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockScoredSection, a, b);
    }
}
/**
 * MockReportSections mirrors the inline `sections` object on OpenAPI MockReport.
 *
 * @generated from message druz9.v1.MockReportSections
 */
export class MockReportSections extends Message {
    /**
     * @generated from field: druz9.v1.MockScoredSection problem_solving = 1;
     */
    problemSolving;
    /**
     * @generated from field: druz9.v1.MockScoredSection code_quality = 2;
     */
    codeQuality;
    /**
     * @generated from field: druz9.v1.MockScoredSection communication = 3;
     */
    communication;
    /**
     * @generated from field: druz9.v1.MockScoredSection stress_handling = 4;
     */
    stressHandling;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockReportSections";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "problem_solving", kind: "message", T: MockScoredSection },
        { no: 2, name: "code_quality", kind: "message", T: MockScoredSection },
        { no: 3, name: "communication", kind: "message", T: MockScoredSection },
        { no: 4, name: "stress_handling", kind: "message", T: MockScoredSection },
    ]);
    static fromBinary(bytes, options) {
        return new MockReportSections().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockReportSections().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockReportSections().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockReportSections, a, b);
    }
}
/**
 * MockRecommendationAction mirrors the OpenAPI Recommendation.action struct.
 *
 * @generated from message druz9.v1.MockRecommendationAction
 */
export class MockRecommendationAction extends Message {
    /**
     * @generated from field: string kind = 1;
     */
    kind = "";
    /**
     * @generated from field: map<string, string> params = 2;
     */
    params = {};
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockRecommendationAction";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "kind", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "params", kind: "map", K: 9 /* ScalarType.STRING */, V: { kind: "scalar", T: 9 /* ScalarType.STRING */ } },
    ]);
    static fromBinary(bytes, options) {
        return new MockRecommendationAction().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockRecommendationAction().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockRecommendationAction().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockRecommendationAction, a, b);
    }
}
/**
 * MockRecommendation mirrors OpenAPI Recommendation (re-declared here to avoid
 * a cross-service import from profile.proto).
 *
 * @generated from message druz9.v1.MockRecommendation
 */
export class MockRecommendation extends Message {
    /**
     * @generated from field: string title = 1;
     */
    title = "";
    /**
     * @generated from field: string description = 2;
     */
    description = "";
    /**
     * @generated from field: druz9.v1.MockRecommendationAction action = 3;
     */
    action;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockRecommendation";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "action", kind: "message", T: MockRecommendationAction },
    ]);
    static fromBinary(bytes, options) {
        return new MockRecommendation().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockRecommendation().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockRecommendation().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockRecommendation, a, b);
    }
}
/**
 * MockReport mirrors OpenAPI MockReport.
 *
 * @generated from message druz9.v1.MockReport
 */
export class MockReport extends Message {
    /**
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    /**
     * "processing" is returned when the report job has not yet written its
     * draft (bible §8). Kept as a plain string — not an enum — because the
     * OpenAPI schema omits the field entirely when the report is ready.
     *
     * @generated from field: string status = 2;
     */
    status = "";
    /**
     * @generated from field: int32 overall_score = 3;
     */
    overallScore = 0;
    /**
     * @generated from field: druz9.v1.MockReportSections sections = 4;
     */
    sections;
    /**
     * @generated from field: repeated string strengths = 5;
     */
    strengths = [];
    /**
     * @generated from field: repeated string weaknesses = 6;
     */
    weaknesses = [];
    /**
     * @generated from field: repeated druz9.v1.MockRecommendation recommendations = 7;
     */
    recommendations = [];
    /**
     * @generated from field: string stress_analysis = 8;
     */
    stressAnalysis = "";
    /**
     * @generated from field: string replay_url = 9;
     */
    replayUrl = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.MockReport";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "status", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "overall_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "sections", kind: "message", T: MockReportSections },
        { no: 5, name: "strengths", kind: "scalar", T: 9 /* ScalarType.STRING */, repeated: true },
        { no: 6, name: "weaknesses", kind: "scalar", T: 9 /* ScalarType.STRING */, repeated: true },
        { no: 7, name: "recommendations", kind: "message", T: MockRecommendation, repeated: true },
        { no: 8, name: "stress_analysis", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 9, name: "replay_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new MockReport().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new MockReport().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new MockReport().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(MockReport, a, b);
    }
}
/**
 * Empty request shapes.
 *
 * @generated from message druz9.v1.GetMockSessionRequest
 */
export class GetMockSessionRequest extends Message {
    /**
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMockSessionRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetMockSessionRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMockSessionRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMockSessionRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMockSessionRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.FinishMockSessionRequest
 */
export class FinishMockSessionRequest extends Message {
    /**
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.FinishMockSessionRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new FinishMockSessionRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new FinishMockSessionRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new FinishMockSessionRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(FinishMockSessionRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMockReportRequest
 */
export class GetMockReportRequest extends Message {
    /**
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMockReportRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetMockReportRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMockReportRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMockReportRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMockReportRequest, a, b);
    }
}
