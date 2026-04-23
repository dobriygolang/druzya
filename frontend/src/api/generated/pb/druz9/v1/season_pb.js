// season.proto — Connect-RPC contract for the `season` bounded context.
//
// Covers the single /season/current endpoint (GET). Season Pass progress is
// authenticated-only — the native Connect path is mounted behind requireAuth
// and REST traffic continues to flow through the gated group in main.go.
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
/**
 * SeasonHeader mirrors the inline `season` object of OpenAPI SeasonProgress.
 *
 * @generated from message druz9.v1.SeasonHeader
 */
export class SeasonHeader extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string name = 2;
     */
    name = "";
    /**
     * @generated from field: string slug = 3;
     */
    slug = "";
    /**
     * @generated from field: google.protobuf.Timestamp starts_at = 4;
     */
    startsAt;
    /**
     * @generated from field: google.protobuf.Timestamp ends_at = 5;
     */
    endsAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SeasonHeader";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "starts_at", kind: "message", T: Timestamp },
        { no: 5, name: "ends_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new SeasonHeader().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SeasonHeader().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SeasonHeader().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SeasonHeader, a, b);
    }
}
/**
 * SeasonTier is one rung of a reward ladder.
 *
 * @generated from message druz9.v1.SeasonTier
 */
export class SeasonTier extends Message {
    /**
     * @generated from field: int32 tier = 1;
     */
    tier = 0;
    /**
     * @generated from field: int32 required_points = 2;
     */
    requiredPoints = 0;
    /**
     * @generated from field: string reward_key = 3;
     */
    rewardKey = "";
    /**
     * @generated from field: bool claimed = 4;
     */
    claimed = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SeasonTier";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "tier", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "required_points", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "reward_key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "claimed", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new SeasonTier().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SeasonTier().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SeasonTier().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SeasonTier, a, b);
    }
}
/**
 * SeasonTrack is one reward ladder (free or premium).
 *
 * @generated from message druz9.v1.SeasonTrack
 */
export class SeasonTrack extends Message {
    /**
     * kind mirrors OpenAPI `tracks[].kind` — "free" | "premium". Kept as a
     * string since proto wants a dedicated enum per use and the domain already
     * treats it as a plain label (domain.TrackKind).
     *
     * @generated from field: string kind = 1;
     */
    kind = "";
    /**
     * @generated from field: repeated druz9.v1.SeasonTier tiers = 2;
     */
    tiers = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SeasonTrack";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "kind", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "tiers", kind: "message", T: SeasonTier, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new SeasonTrack().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SeasonTrack().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SeasonTrack().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SeasonTrack, a, b);
    }
}
/**
 * SeasonWeeklyChallenge mirrors the inline `weekly_challenges[]` item.
 *
 * @generated from message druz9.v1.SeasonWeeklyChallenge
 */
export class SeasonWeeklyChallenge extends Message {
    /**
     * @generated from field: string key = 1;
     */
    key = "";
    /**
     * @generated from field: string title = 2;
     */
    title = "";
    /**
     * @generated from field: int32 progress = 3;
     */
    progress = 0;
    /**
     * @generated from field: int32 target = 4;
     */
    target = 0;
    /**
     * @generated from field: int32 points_reward = 5;
     */
    pointsReward = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SeasonWeeklyChallenge";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "progress", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "target", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "points_reward", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new SeasonWeeklyChallenge().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SeasonWeeklyChallenge().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SeasonWeeklyChallenge().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SeasonWeeklyChallenge, a, b);
    }
}
/**
 * SeasonProgress mirrors OpenAPI SeasonProgress.
 *
 * @generated from message druz9.v1.SeasonProgress
 */
export class SeasonProgress extends Message {
    /**
     * @generated from field: druz9.v1.SeasonHeader season = 1;
     */
    season;
    /**
     * @generated from field: int32 my_points = 2;
     */
    myPoints = 0;
    /**
     * @generated from field: int32 tier = 3;
     */
    tier = 0;
    /**
     * @generated from field: bool is_premium = 4;
     */
    isPremium = false;
    /**
     * @generated from field: repeated druz9.v1.SeasonTrack tracks = 5;
     */
    tracks = [];
    /**
     * @generated from field: repeated druz9.v1.SeasonWeeklyChallenge weekly_challenges = 6;
     */
    weeklyChallenges = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SeasonProgress";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "season", kind: "message", T: SeasonHeader },
        { no: 2, name: "my_points", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "tier", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "is_premium", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 5, name: "tracks", kind: "message", T: SeasonTrack, repeated: true },
        { no: 6, name: "weekly_challenges", kind: "message", T: SeasonWeeklyChallenge, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new SeasonProgress().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SeasonProgress().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SeasonProgress().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SeasonProgress, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetCurrentSeasonRequest
 */
export class GetCurrentSeasonRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetCurrentSeasonRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetCurrentSeasonRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetCurrentSeasonRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetCurrentSeasonRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetCurrentSeasonRequest, a, b);
    }
}
