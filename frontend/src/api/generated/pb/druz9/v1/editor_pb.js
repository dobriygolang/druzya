// editor.proto — Connect-RPC contract for the `editor` bounded context.
//
// Covers the five REST endpoints under /editor/room/*. The collaborative
// WebSocket at /ws/editor/{roomId} is NOT part of this proto — Connect does
// not transcode WebSockets, and the existing raw chi handler in ports/ws.go
// keeps handling YJS op fanout unchanged (same split as arena / ai_mock).
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Difficulty, EditorRole, Language, Section } from "./common_pb.js";
/**
 * EditorTaskPublic mirrors OpenAPI TaskPublic when embedded in an EditorRoom.
 * Named separately to keep each domain's public task projection isolated.
 *
 * @generated from message druz9.v1.EditorTaskPublic
 */
export class EditorTaskPublic extends Message {
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
    static typeName = "druz9.v1.EditorTaskPublic";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 6, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
    ]);
    static fromBinary(bytes, options) {
        return new EditorTaskPublic().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new EditorTaskPublic().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new EditorTaskPublic().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(EditorTaskPublic, a, b);
    }
}
/**
 * EditorParticipant mirrors OpenAPI EditorParticipant.
 *
 * @generated from message druz9.v1.EditorParticipant
 */
export class EditorParticipant extends Message {
    /**
     * @generated from field: string user_id = 1;
     */
    userId = "";
    /**
     * @generated from field: string username = 2;
     */
    username = "";
    /**
     * @generated from field: druz9.v1.EditorRole role = 3;
     */
    role = EditorRole.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.EditorParticipant";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "role", kind: "enum", T: proto3.getEnumType(EditorRole) },
    ]);
    static fromBinary(bytes, options) {
        return new EditorParticipant().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new EditorParticipant().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new EditorParticipant().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(EditorParticipant, a, b);
    }
}
/**
 * EditorRoom mirrors OpenAPI EditorRoom.
 *
 * @generated from message druz9.v1.EditorRoom
 */
export class EditorRoom extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string owner_id = 2;
     */
    ownerId = "";
    /**
     * type is "practice" | "interview" | "pair_mock" in OpenAPI — kept as a
     * string (the domain already treats it as a plain label via
     * domain.RoomType with three values; keeping it string preserves REST
     * wire compatibility with no extra enum).
     *
     * @generated from field: string type = 3;
     */
    type = "";
    /**
     * @generated from field: druz9.v1.EditorTaskPublic task = 4;
     */
    task;
    /**
     * @generated from field: druz9.v1.Language language = 5;
     */
    language = Language.UNSPECIFIED;
    /**
     * @generated from field: bool is_frozen = 6;
     */
    isFrozen = false;
    /**
     * @generated from field: repeated druz9.v1.EditorParticipant participants = 7;
     */
    participants = [];
    /**
     * @generated from field: string ws_url = 8;
     */
    wsUrl = "";
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 9;
     */
    expiresAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.EditorRoom";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "owner_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "type", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "task", kind: "message", T: EditorTaskPublic },
        { no: 5, name: "language", kind: "enum", T: proto3.getEnumType(Language) },
        { no: 6, name: "is_frozen", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 7, name: "participants", kind: "message", T: EditorParticipant, repeated: true },
        { no: 8, name: "ws_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 9, name: "expires_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new EditorRoom().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new EditorRoom().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new EditorRoom().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(EditorRoom, a, b);
    }
}
/**
 * InviteLink mirrors OpenAPI InviteLink.
 *
 * @generated from message druz9.v1.InviteLink
 */
export class InviteLink extends Message {
    /**
     * @generated from field: string url = 1;
     */
    url = "";
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 2;
     */
    expiresAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.InviteLink";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "expires_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new InviteLink().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new InviteLink().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new InviteLink().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(InviteLink, a, b);
    }
}
/**
 * ReplayUrl mirrors OpenAPI ReplayUrl.
 *
 * @generated from message druz9.v1.ReplayUrl
 */
export class ReplayUrl extends Message {
    /**
     * @generated from field: string url = 1;
     */
    url = "";
    /**
     * @generated from field: google.protobuf.Timestamp expires_at = 2;
     */
    expiresAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ReplayUrl";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "expires_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new ReplayUrl().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ReplayUrl().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ReplayUrl().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ReplayUrl, a, b);
    }
}
/**
 * CreateRoomRequest mirrors OpenAPI CreateRoomRequest.
 *
 * @generated from message druz9.v1.CreateRoomRequest
 */
export class CreateRoomRequest extends Message {
    /**
     * @generated from field: string type = 1;
     */
    type = "";
    /**
     * @generated from field: string task_id = 2;
     */
    taskId = "";
    /**
     * @generated from field: druz9.v1.Language language = 3;
     */
    language = Language.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateRoomRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "type", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "task_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "language", kind: "enum", T: proto3.getEnumType(Language) },
    ]);
    static fromBinary(bytes, options) {
        return new CreateRoomRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateRoomRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateRoomRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateRoomRequest, a, b);
    }
}
/**
 * GetRoomRequest wraps the path param.
 *
 * @generated from message druz9.v1.GetRoomRequest
 */
export class GetRoomRequest extends Message {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetRoomRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "room_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetRoomRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetRoomRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetRoomRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetRoomRequest, a, b);
    }
}
/**
 * CreateInviteRequest wraps the path param.
 *
 * @generated from message druz9.v1.CreateInviteRequest
 */
export class CreateInviteRequest extends Message {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateInviteRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "room_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new CreateInviteRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateInviteRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateInviteRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateInviteRequest, a, b);
    }
}
/**
 * FreezeRoomRequest mirrors the POST body.
 *
 * @generated from message druz9.v1.FreezeRoomRequest
 */
export class FreezeRoomRequest extends Message {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId = "";
    /**
     * @generated from field: bool frozen = 2;
     */
    frozen = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.FreezeRoomRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "room_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "frozen", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new FreezeRoomRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new FreezeRoomRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new FreezeRoomRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(FreezeRoomRequest, a, b);
    }
}
/**
 * GetReplayRequest wraps the path param.
 *
 * @generated from message druz9.v1.GetReplayRequest
 */
export class GetReplayRequest extends Message {
    /**
     * @generated from field: string room_id = 1;
     */
    roomId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetReplayRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "room_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetReplayRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetReplayRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetReplayRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetReplayRequest, a, b);
    }
}
