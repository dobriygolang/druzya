// rating.proto — pilot Connect-RPC contract for the `rating` domain.
//
// See docs/contract-first-with-buf.md for the migration plan. The
// `google.api.http` annotations allow REST clients to keep hitting the
// existing /api/v1/rating/* paths via vanguard-go transcoding; native
// Connect clients reach the same handlers at /druz9.v1.RatingService/*.
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Section } from "./common_pb.js";
/**
 * @generated from message druz9.v1.SectionRating
 */
export class SectionRating extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 elo = 2;
     */
    elo = 0;
    /**
     * @generated from field: int32 matches_count = 3;
     */
    matchesCount = 0;
    /**
     * @generated from field: int32 percentile = 4;
     */
    percentile = 0;
    /**
     * @generated from field: bool decaying = 5;
     */
    decaying = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SectionRating";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "elo", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "matches_count", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "percentile", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "decaying", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new SectionRating().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SectionRating().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SectionRating().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SectionRating, a, b);
    }
}
/**
 * @generated from message druz9.v1.HistorySample
 */
export class HistorySample extends Message {
    /**
     * ISO-8601 calendar date for the Monday of the ISO week (UTC).
     *
     * @generated from field: string week_start = 1;
     */
    weekStart = "";
    /**
     * @generated from field: int32 global_power_score = 2;
     */
    globalPowerScore = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.HistorySample";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "week_start", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "global_power_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new HistorySample().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new HistorySample().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new HistorySample().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(HistorySample, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMyRatingsRequest
 */
export class GetMyRatingsRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMyRatingsRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetMyRatingsRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMyRatingsRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMyRatingsRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMyRatingsRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMyRatingsResponse
 */
export class GetMyRatingsResponse extends Message {
    /**
     * @generated from field: repeated druz9.v1.SectionRating ratings = 1;
     */
    ratings = [];
    /**
     * @generated from field: int32 global_power_score = 2;
     */
    globalPowerScore = 0;
    /**
     * @generated from field: repeated druz9.v1.HistorySample history = 3;
     */
    history = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMyRatingsResponse";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "ratings", kind: "message", T: SectionRating, repeated: true },
        { no: 2, name: "global_power_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "history", kind: "message", T: HistorySample, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new GetMyRatingsResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMyRatingsResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMyRatingsResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMyRatingsResponse, a, b);
    }
}
/**
 * @generated from message druz9.v1.LeaderboardEntry
 */
export class LeaderboardEntry extends Message {
    /**
     * @generated from field: int32 rank = 1;
     */
    rank = 0;
    /**
     * @generated from field: string user_id = 2;
     */
    userId = "";
    /**
     * @generated from field: string username = 3;
     */
    username = "";
    /**
     * @generated from field: int32 elo = 4;
     */
    elo = 0;
    /**
     * @generated from field: string title = 5;
     */
    title = "";
    /**
     * @generated from field: string cohort_emblem = 6;
     */
    cohortEmblem = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.LeaderboardEntry";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "rank", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "elo", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "cohort_emblem", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new LeaderboardEntry().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new LeaderboardEntry().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new LeaderboardEntry().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(LeaderboardEntry, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetLeaderboardRequest
 */
export class GetLeaderboardRequest extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 limit = 2;
     */
    limit = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetLeaderboardRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "limit", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetLeaderboardRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetLeaderboardRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetLeaderboardRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetLeaderboardRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetLeaderboardResponse
 */
export class GetLeaderboardResponse extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 2;
     */
    updatedAt;
    /**
     * @generated from field: int32 my_rank = 3;
     */
    myRank = 0;
    /**
     * @generated from field: repeated druz9.v1.LeaderboardEntry entries = 4;
     */
    entries = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetLeaderboardResponse";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "updated_at", kind: "message", T: Timestamp },
        { no: 3, name: "my_rank", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "entries", kind: "message", T: LeaderboardEntry, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new GetLeaderboardResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetLeaderboardResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetLeaderboardResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetLeaderboardResponse, a, b);
    }
}
