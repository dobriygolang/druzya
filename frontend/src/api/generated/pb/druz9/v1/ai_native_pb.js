// ai_native.proto — Connect-RPC contract for the `ai_native` bounded context.
//
// Covers the five /native/session/* REST endpoints. SubmitPrompt is a
// server-streaming RPC — the native Connect path streams token deltas then a
// final response, while the REST path (via vanguard) returns only the final
// JSON body. See ports/server.go for the stub streaming implementation.
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Difficulty, LLMModel, NativeAction, ProvenanceKind, Section } from "./common_pb.js";
/**
 * NativeTaskPublic mirrors OpenAPI TaskPublic used by ai_native.
 *
 * @generated from message druz9.v1.NativeTaskPublic
 */
export class NativeTaskPublic extends Message {
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
    static typeName = "druz9.v1.NativeTaskPublic";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 6, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
    ]);
    static fromBinary(bytes, options) {
        return new NativeTaskPublic().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativeTaskPublic().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativeTaskPublic().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativeTaskPublic, a, b);
    }
}
/**
 * NativeScores mirrors OpenAPI NativeScores (the 4-axis rubric).
 *
 * @generated from message druz9.v1.NativeScores
 */
export class NativeScores extends Message {
    /**
     * @generated from field: int32 context = 1;
     */
    context = 0;
    /**
     * @generated from field: int32 verification = 2;
     */
    verification = 0;
    /**
     * @generated from field: int32 judgment = 3;
     */
    judgment = 0;
    /**
     * @generated from field: int32 delivery = 4;
     */
    delivery = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativeScores";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "context", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "verification", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "judgment", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "delivery", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new NativeScores().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativeScores().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativeScores().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativeScores, a, b);
    }
}
/**
 * NativeSession mirrors OpenAPI NativeSession.
 *
 * @generated from message druz9.v1.NativeSession
 */
export class NativeSession extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: druz9.v1.Section section = 2;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.NativeTaskPublic task = 3;
     */
    task;
    /**
     * @generated from field: google.protobuf.Timestamp started_at = 4;
     */
    startedAt;
    /**
     * @generated from field: google.protobuf.Timestamp finished_at = 5;
     */
    finishedAt;
    /**
     * @generated from field: druz9.v1.NativeScores scores = 6;
     */
    scores;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativeSession";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 3, name: "task", kind: "message", T: NativeTaskPublic },
        { no: 4, name: "started_at", kind: "message", T: Timestamp },
        { no: 5, name: "finished_at", kind: "message", T: Timestamp },
        { no: 6, name: "scores", kind: "message", T: NativeScores },
    ]);
    static fromBinary(bytes, options) {
        return new NativeSession().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativeSession().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativeSession().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativeSession, a, b);
    }
}
/**
 * CreateNativeRequest mirrors OpenAPI CreateNativeRequest.
 *
 * @generated from message druz9.v1.CreateNativeRequest
 */
export class CreateNativeRequest extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 2;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.LLMModel llm_model = 3;
     */
    llmModel = LLMModel.LLM_MODEL_UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateNativeRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 3, name: "llm_model", kind: "enum", T: proto3.getEnumType(LLMModel) },
    ]);
    static fromBinary(bytes, options) {
        return new CreateNativeRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateNativeRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateNativeRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateNativeRequest, a, b);
    }
}
/**
 * SubmitPromptRequest mirrors OpenAPI NativePromptRequest.
 *
 * @generated from message druz9.v1.SubmitPromptRequest
 */
export class SubmitPromptRequest extends Message {
    /**
     * path param
     *
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    /**
     * @generated from field: string prompt = 2;
     */
    prompt = "";
    /**
     * @generated from field: string context_code = 3;
     */
    contextCode = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SubmitPromptRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "prompt", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "context_code", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new SubmitPromptRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SubmitPromptRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SubmitPromptRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SubmitPromptRequest, a, b);
    }
}
/**
 * NativePromptResponse mirrors OpenAPI NativePromptResponse — this is the
 * final unary result of the prompt (emitted inside the last streaming event,
 * and returned directly for REST clients).
 *
 * @generated from message druz9.v1.NativePromptResponse
 */
export class NativePromptResponse extends Message {
    /**
     * @generated from field: string response_text = 1;
     */
    responseText = "";
    /**
     * @generated from field: bool contains_hallucination_trap = 2;
     */
    containsHallucinationTrap = false;
    /**
     * @generated from field: string provenance_id = 3;
     */
    provenanceId = "";
    /**
     * @generated from field: druz9.v1.NativeScores scores = 4;
     */
    scores;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativePromptResponse";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "response_text", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "contains_hallucination_trap", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 3, name: "provenance_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "scores", kind: "message", T: NativeScores },
    ]);
    static fromBinary(bytes, options) {
        return new NativePromptResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativePromptResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativePromptResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativePromptResponse, a, b);
    }
}
/**
 * NativePromptToken is a single streamed token delta.
 *
 * @generated from message druz9.v1.NativePromptToken
 */
export class NativePromptToken extends Message {
    /**
     * @generated from field: string text = 1;
     */
    text = "";
    /**
     * @generated from field: int32 index = 2;
     */
    index = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativePromptToken";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "text", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "index", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new NativePromptToken().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativePromptToken().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativePromptToken().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativePromptToken, a, b);
    }
}
/**
 * NativePromptDone carries the final response. Emitted once at the end of the
 * stream, after all NativePromptToken events.
 *
 * @generated from message druz9.v1.NativePromptDone
 */
export class NativePromptDone extends Message {
    /**
     * @generated from field: druz9.v1.NativePromptResponse final = 1;
     */
    final;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativePromptDone";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "final", kind: "message", T: NativePromptResponse },
    ]);
    static fromBinary(bytes, options) {
        return new NativePromptDone().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativePromptDone().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativePromptDone().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativePromptDone, a, b);
    }
}
/**
 * NativePromptStreamEvent is the server-streaming frame.
 *
 * @generated from message druz9.v1.NativePromptStreamEvent
 */
export class NativePromptStreamEvent extends Message {
    /**
     * @generated from oneof druz9.v1.NativePromptStreamEvent.kind
     */
    kind = { case: undefined };
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativePromptStreamEvent";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "token", kind: "message", T: NativePromptToken, oneof: "kind" },
        { no: 2, name: "done", kind: "message", T: NativePromptDone, oneof: "kind" },
    ]);
    static fromBinary(bytes, options) {
        return new NativePromptStreamEvent().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativePromptStreamEvent().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativePromptStreamEvent().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativePromptStreamEvent, a, b);
    }
}
/**
 * NativeVerifyRequest mirrors OpenAPI NativeVerifyRequest.
 *
 * @generated from message druz9.v1.NativeVerifyRequest
 */
export class NativeVerifyRequest extends Message {
    /**
     * path param
     *
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    /**
     * @generated from field: string provenance_id = 2;
     */
    provenanceId = "";
    /**
     * @generated from field: druz9.v1.NativeAction action = 3;
     */
    action = NativeAction.UNSPECIFIED;
    /**
     * @generated from field: string reason = 4;
     */
    reason = "";
    /**
     * @generated from field: string revised_code = 5;
     */
    revisedCode = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativeVerifyRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "provenance_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "action", kind: "enum", T: proto3.getEnumType(NativeAction) },
        { no: 4, name: "reason", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "revised_code", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new NativeVerifyRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativeVerifyRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativeVerifyRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativeVerifyRequest, a, b);
    }
}
/**
 * NativeProvenanceRecord mirrors OpenAPI ProvenanceRecord.
 *
 * @generated from message druz9.v1.NativeProvenanceRecord
 */
export class NativeProvenanceRecord extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: druz9.v1.ProvenanceKind kind = 2;
     */
    kind = ProvenanceKind.UNSPECIFIED;
    /**
     * @generated from field: string parent_id = 3;
     */
    parentId = "";
    /**
     * @generated from field: string snippet = 4;
     */
    snippet = "";
    /**
     * @generated from field: string ai_prompt = 5;
     */
    aiPrompt = "";
    /**
     * @generated from field: google.protobuf.Timestamp verified_at = 6;
     */
    verifiedAt;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 7;
     */
    createdAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativeProvenanceRecord";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "kind", kind: "enum", T: proto3.getEnumType(ProvenanceKind) },
        { no: 3, name: "parent_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "snippet", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "ai_prompt", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "verified_at", kind: "message", T: Timestamp },
        { no: 7, name: "created_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new NativeProvenanceRecord().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativeProvenanceRecord().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativeProvenanceRecord().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativeProvenanceRecord, a, b);
    }
}
/**
 * NativeProvenanceGraph mirrors OpenAPI ProvenanceGraph.
 *
 * @generated from message druz9.v1.NativeProvenanceGraph
 */
export class NativeProvenanceGraph extends Message {
    /**
     * @generated from field: repeated druz9.v1.NativeProvenanceRecord records = 1;
     */
    records = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NativeProvenanceGraph";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "records", kind: "message", T: NativeProvenanceRecord, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new NativeProvenanceGraph().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NativeProvenanceGraph().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NativeProvenanceGraph().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NativeProvenanceGraph, a, b);
    }
}
/**
 * Empty path-only requests.
 *
 * @generated from message druz9.v1.GetNativeProvenanceRequest
 */
export class GetNativeProvenanceRequest extends Message {
    /**
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetNativeProvenanceRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetNativeProvenanceRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetNativeProvenanceRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetNativeProvenanceRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetNativeProvenanceRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetNativeScoreRequest
 */
export class GetNativeScoreRequest extends Message {
    /**
     * @generated from field: string session_id = 1;
     */
    sessionId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetNativeScoreRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "session_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetNativeScoreRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetNativeScoreRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetNativeScoreRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetNativeScoreRequest, a, b);
    }
}
