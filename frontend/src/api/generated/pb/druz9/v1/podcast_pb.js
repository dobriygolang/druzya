// podcast.proto — Connect-RPC contract for the `podcast` bounded context.
//
// Covers GET /podcast (catalog) and PUT /podcast/{id}/progress (progress).
// Section filter on the catalog uses the shared Section enum, with
// SECTION_UNSPECIFIED meaning "any section".
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Section } from "./common_pb.js";
/**
 * Podcast mirrors OpenAPI Podcast (catalog entry with user progress overlay).
 *
 * @generated from message druz9.v1.Podcast
 */
export class Podcast extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string title = 2;
     */
    title = "";
    /**
     * @generated from field: string description = 3;
     */
    description = "";
    /**
     * @generated from field: druz9.v1.Section section = 4;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 duration_sec = 5;
     */
    durationSec = 0;
    /**
     * @generated from field: string audio_url = 6;
     */
    audioUrl = "";
    /**
     * @generated from field: int32 progress_sec = 7;
     */
    progressSec = 0;
    /**
     * @generated from field: bool completed = 8;
     */
    completed = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Podcast";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 5, name: "duration_sec", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 6, name: "audio_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 7, name: "progress_sec", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 8, name: "completed", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new Podcast().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Podcast().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Podcast().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Podcast, a, b);
    }
}
/**
 * PodcastCatalog is the vanguard-friendly response wrapper. OpenAPI returns a
 * raw JSON array; vanguard transcodes repeated fields of a wrapper message
 * into a top-level array on the REST wire when the RPC response has exactly
 * one field. Keeping this wrapper avoids google.api.HttpBody.
 *
 * @generated from message druz9.v1.PodcastCatalog
 */
export class PodcastCatalog extends Message {
    /**
     * @generated from field: repeated druz9.v1.Podcast items = 1;
     */
    items = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.PodcastCatalog";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: Podcast, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new PodcastCatalog().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new PodcastCatalog().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new PodcastCatalog().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(PodcastCatalog, a, b);
    }
}
/**
 * PodcastProgress mirrors OpenAPI PodcastProgress (PUT response).
 *
 * @generated from message druz9.v1.PodcastProgress
 */
export class PodcastProgress extends Message {
    /**
     * @generated from field: string podcast_id = 1;
     */
    podcastId = "";
    /**
     * @generated from field: int32 progress_sec = 2;
     */
    progressSec = 0;
    /**
     * @generated from field: bool completed = 3;
     */
    completed = false;
    /**
     * @generated from field: google.protobuf.Timestamp completed_at = 4;
     */
    completedAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.PodcastProgress";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "podcast_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "progress_sec", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "completed", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 4, name: "completed_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new PodcastProgress().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new PodcastProgress().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new PodcastProgress().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(PodcastProgress, a, b);
    }
}
/**
 * ListCatalogRequest — section is optional via SECTION_UNSPECIFIED.
 *
 * @generated from message druz9.v1.ListCatalogRequest
 */
export class ListCatalogRequest extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListCatalogRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
    ]);
    static fromBinary(bytes, options) {
        return new ListCatalogRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListCatalogRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListCatalogRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListCatalogRequest, a, b);
    }
}
/**
 * UpdateProgressRequest mirrors OpenAPI PodcastProgressRequest plus the path
 * param.
 *
 * @generated from message druz9.v1.UpdateProgressRequest
 */
export class UpdateProgressRequest extends Message {
    /**
     * path param
     *
     * @generated from field: string podcast_id = 1;
     */
    podcastId = "";
    /**
     * @generated from field: int32 progress_sec = 2;
     */
    progressSec = 0;
    /**
     * completed is optional in OpenAPI — proto3 bool defaults to false. Use
     * the dedicated `completed_hint` below to distinguish "unset" from "false".
     * The REST wire preserves the OpenAPI shape: `completed` is a plain bool
     * field the client may omit.
     *
     * @generated from field: bool completed = 3;
     */
    completed = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.UpdateProgressRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "podcast_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "progress_sec", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "completed", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new UpdateProgressRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new UpdateProgressRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new UpdateProgressRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(UpdateProgressRequest, a, b);
    }
}
