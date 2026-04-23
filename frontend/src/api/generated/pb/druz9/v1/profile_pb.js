// profile.proto — Connect-RPC contract for the `profile` bounded context.
//
// Covers the five /profile/* endpoints: me, atlas, weekly report, settings
// (PUT), and the public username lookup. The /profile/{username} endpoint
// is public (bypasses bearer auth via publicPaths-style exemption — see
// main.go). For proto3 the public carve-out is applied in the REST gate and
// the native Connect mount.
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { CharClass, Language, Section, SubscriptionPlan } from "./common_pb.js";
import { NotificationPreferences } from "./notify_pb.js";
/**
 * Attributes mirrors OpenAPI Attributes.
 *
 * @generated from message druz9.v1.Attributes
 */
export class Attributes extends Message {
    /**
     * @generated from field: int32 intellect = 1;
     */
    intellect = 0;
    /**
     * @generated from field: int32 strength = 2;
     */
    strength = 0;
    /**
     * @generated from field: int32 dexterity = 3;
     */
    dexterity = 0;
    /**
     * @generated from field: int32 will = 4;
     */
    will = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Attributes";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "intellect", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "strength", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "dexterity", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "will", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new Attributes().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Attributes().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Attributes().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Attributes, a, b);
    }
}
/**
 * ProfileSubscription mirrors the inline `subscription` object on ProfileFull.
 *
 * @generated from message druz9.v1.ProfileSubscription
 */
export class ProfileSubscription extends Message {
    /**
     * @generated from field: druz9.v1.SubscriptionPlan plan = 1;
     */
    plan = SubscriptionPlan.UNSPECIFIED;
    /**
     * current_period_end is optional — zero Timestamp when no paid plan.
     *
     * @generated from field: google.protobuf.Timestamp current_period_end = 2;
     */
    currentPeriodEnd;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ProfileSubscription";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "plan", kind: "enum", T: proto3.getEnumType(SubscriptionPlan) },
        { no: 2, name: "current_period_end", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new ProfileSubscription().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ProfileSubscription().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ProfileSubscription().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ProfileSubscription, a, b);
    }
}
/**
 * ProfileFull mirrors OpenAPI ProfileFull.
 *
 * @generated from message druz9.v1.ProfileFull
 */
export class ProfileFull extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string username = 2;
     */
    username = "";
    /**
     * @generated from field: string display_name = 3;
     */
    displayName = "";
    /**
     * @generated from field: string avatar_frame = 4;
     */
    avatarFrame = "";
    /**
     * @generated from field: string title = 5;
     */
    title = "";
    /**
     * @generated from field: int32 level = 6;
     */
    level = 0;
    /**
     * @generated from field: int32 xp = 7;
     */
    xp = 0;
    /**
     * @generated from field: int32 xp_to_next = 8;
     */
    xpToNext = 0;
    /**
     * @generated from field: druz9.v1.CharClass char_class = 9;
     */
    charClass = CharClass.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Attributes attributes = 10;
     */
    attributes;
    /**
     * @generated from field: int32 global_power_score = 11;
     */
    globalPowerScore = 0;
    /**
     * career_stage is "junior" | "middle" | ... | "principal" in OpenAPI. Kept
     * as a string to avoid another tiny enum; server guarantees validity.
     *
     * @generated from field: string career_stage = 12;
     */
    careerStage = "";
    /**
     * @generated from field: druz9.v1.ProfileSubscription subscription = 13;
     */
    subscription;
    /**
     * @generated from field: int32 ai_credits = 14;
     */
    aiCredits = 0;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 15;
     */
    createdAt;
    /**
     * avatar_url берётся из users.avatar_url (заполняется при OAuth-логине,
     * см. миграцию 00010_users_avatar.sql и login_yandex/login_telegram).
     *
     * @generated from field: string avatar_url = 16;
     */
    avatarUrl = "";
    /**
     * email из users.email — нужен на /settings (карточка аккаунта). Может быть
     * пустым у Telegram-логина без подтверждённого email.
     *
     * @generated from field: string email = 17;
     */
    email = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ProfileFull";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "display_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "avatar_frame", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "level", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 7, name: "xp", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 8, name: "xp_to_next", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 9, name: "char_class", kind: "enum", T: proto3.getEnumType(CharClass) },
        { no: 10, name: "attributes", kind: "message", T: Attributes },
        { no: 11, name: "global_power_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 12, name: "career_stage", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 13, name: "subscription", kind: "message", T: ProfileSubscription },
        { no: 14, name: "ai_credits", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 15, name: "created_at", kind: "message", T: Timestamp },
        { no: 16, name: "avatar_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 17, name: "email", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new ProfileFull().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ProfileFull().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ProfileFull().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ProfileFull, a, b);
    }
}
/**
 * SectionRating mirrors the top-level OpenAPI SectionRating (rating.proto
 * has its own nested SectionRating which predates this file; the two are
 * structurally identical but the proto package rules keep them separate).
 *
 * @generated from message druz9.v1.ProfileSectionRating
 */
export class ProfileSectionRating extends Message {
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
    static typeName = "druz9.v1.ProfileSectionRating";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "elo", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "matches_count", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "percentile", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "decaying", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new ProfileSectionRating().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ProfileSectionRating().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ProfileSectionRating().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ProfileSectionRating, a, b);
    }
}
/**
 * Achievement mirrors OpenAPI Achievement.
 *
 * @generated from message druz9.v1.Achievement
 */
export class Achievement extends Message {
    /**
     * @generated from field: string key = 1;
     */
    key = "";
    /**
     * @generated from field: string title = 2;
     */
    title = "";
    /**
     * @generated from field: string description = 3;
     */
    description = "";
    /**
     * @generated from field: google.protobuf.Timestamp earned_at = 4;
     */
    earnedAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Achievement";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "earned_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new Achievement().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Achievement().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Achievement().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Achievement, a, b);
    }
}
/**
 * SkillNode mirrors OpenAPI SkillNode.
 *
 * @generated from message druz9.v1.SkillNode
 */
export class SkillNode extends Message {
    /**
     * @generated from field: string key = 1;
     */
    key = "";
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
     * kind is "normal" | "keystone" | "ascendant" in OpenAPI; string preserves
     * wire compat without declaring another enum.
     *
     * @generated from field: string kind = 5;
     */
    kind = "";
    /**
     * @generated from field: int32 progress = 6;
     */
    progress = 0;
    /**
     * @generated from field: bool unlocked = 7;
     */
    unlocked = false;
    /**
     * @generated from field: google.protobuf.Timestamp unlocked_at = 8;
     */
    unlockedAt;
    /**
     * @generated from field: bool decaying = 9;
     */
    decaying = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SkillNode";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 5, name: "kind", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "progress", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 7, name: "unlocked", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 8, name: "unlocked_at", kind: "message", T: Timestamp },
        { no: 9, name: "decaying", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new SkillNode().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SkillNode().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SkillNode().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SkillNode, a, b);
    }
}
/**
 * SkillEdge mirrors OpenAPI SkillEdge.
 *
 * @generated from message druz9.v1.SkillEdge
 */
export class SkillEdge extends Message {
    /**
     * @generated from field: string from = 1;
     */
    from = "";
    /**
     * @generated from field: string to = 2;
     */
    to = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SkillEdge";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "from", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "to", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new SkillEdge().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SkillEdge().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SkillEdge().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SkillEdge, a, b);
    }
}
/**
 * SkillAtlas mirrors OpenAPI SkillAtlas — carries the nodes/edges graph.
 *
 * @generated from message druz9.v1.SkillAtlas
 */
export class SkillAtlas extends Message {
    /**
     * @generated from field: string center_node = 1;
     */
    centerNode = "";
    /**
     * @generated from field: repeated druz9.v1.SkillNode nodes = 2;
     */
    nodes = [];
    /**
     * @generated from field: repeated druz9.v1.SkillEdge edges = 3;
     */
    edges = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SkillAtlas";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "center_node", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "nodes", kind: "message", T: SkillNode, repeated: true },
        { no: 3, name: "edges", kind: "message", T: SkillEdge, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new SkillAtlas().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SkillAtlas().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SkillAtlas().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SkillAtlas, a, b);
    }
}
/**
 * ProfilePublic mirrors OpenAPI ProfilePublic.
 *
 * @generated from message druz9.v1.ProfilePublic
 */
export class ProfilePublic extends Message {
    /**
     * @generated from field: string username = 1;
     */
    username = "";
    /**
     * @generated from field: string display_name = 2;
     */
    displayName = "";
    /**
     * @generated from field: string title = 3;
     */
    title = "";
    /**
     * @generated from field: int32 level = 4;
     */
    level = 0;
    /**
     * @generated from field: druz9.v1.CharClass char_class = 5;
     */
    charClass = CharClass.UNSPECIFIED;
    /**
     * @generated from field: string career_stage = 6;
     */
    careerStage = "";
    /**
     * @generated from field: int32 global_power_score = 7;
     */
    globalPowerScore = 0;
    /**
     * @generated from field: repeated druz9.v1.ProfileSectionRating ratings = 8;
     */
    ratings = [];
    /**
     * @generated from field: repeated druz9.v1.Achievement achievements = 9;
     */
    achievements = [];
    /**
     * @generated from field: druz9.v1.SkillAtlas atlas_preview = 10;
     */
    atlasPreview;
    /**
     * avatar_url из users.avatar_url. См. comment в ProfileFull.
     *
     * @generated from field: string avatar_url = 11;
     */
    avatarUrl = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ProfilePublic";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "display_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "level", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "char_class", kind: "enum", T: proto3.getEnumType(CharClass) },
        { no: 6, name: "career_stage", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 7, name: "global_power_score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 8, name: "ratings", kind: "message", T: ProfileSectionRating, repeated: true },
        { no: 9, name: "achievements", kind: "message", T: Achievement, repeated: true },
        { no: 10, name: "atlas_preview", kind: "message", T: SkillAtlas },
        { no: 11, name: "avatar_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new ProfilePublic().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ProfilePublic().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ProfilePublic().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ProfilePublic, a, b);
    }
}
/**
 * ReportMetrics mirrors the inline `metrics` block of OpenAPI WeeklyReport.
 *
 * @generated from message druz9.v1.ReportMetrics
 */
export class ReportMetrics extends Message {
    /**
     * @generated from field: int32 tasks_solved = 1;
     */
    tasksSolved = 0;
    /**
     * @generated from field: int32 matches_won = 2;
     */
    matchesWon = 0;
    /**
     * @generated from field: int32 rating_change = 3;
     */
    ratingChange = 0;
    /**
     * @generated from field: int32 xp_earned = 4;
     */
    xpEarned = 0;
    /**
     * @generated from field: int32 time_minutes = 5;
     */
    timeMinutes = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ReportMetrics";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "tasks_solved", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 2, name: "matches_won", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "rating_change", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "xp_earned", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "time_minutes", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new ReportMetrics().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ReportMetrics().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ReportMetrics().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ReportMetrics, a, b);
    }
}
/**
 * ReportWeakness mirrors the inline weakness object in OpenAPI WeeklyReport.
 *
 * @generated from message druz9.v1.ReportWeakness
 */
export class ReportWeakness extends Message {
    /**
     * @generated from field: string atlas_node_key = 1;
     */
    atlasNodeKey = "";
    /**
     * @generated from field: string reason = 2;
     */
    reason = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ReportWeakness";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "atlas_node_key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "reason", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new ReportWeakness().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ReportWeakness().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ReportWeakness().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ReportWeakness, a, b);
    }
}
/**
 * RecommendationAction mirrors the inline action block in OpenAPI Recommendation.
 *
 * @generated from message druz9.v1.RecommendationAction
 */
export class RecommendationAction extends Message {
    /**
     * kind is one of: start_mock, solve_task, listen_podcast, open_atlas,
     * open_arena. Preserved as string to avoid another tiny enum.
     *
     * @generated from field: string kind = 1;
     */
    kind = "";
    /**
     * params is a free-form map<string,string> — OpenAPI allows any JSON value
     * via additionalProperties: true; we collapse to string values because
     * Connect clients round-trip scalars losslessly.
     *
     * @generated from field: map<string, string> params = 2;
     */
    params = {};
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.RecommendationAction";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "kind", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "params", kind: "map", K: 9 /* ScalarType.STRING */, V: { kind: "scalar", T: 9 /* ScalarType.STRING */ } },
    ]);
    static fromBinary(bytes, options) {
        return new RecommendationAction().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new RecommendationAction().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new RecommendationAction().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(RecommendationAction, a, b);
    }
}
/**
 * Recommendation mirrors OpenAPI Recommendation.
 *
 * @generated from message druz9.v1.Recommendation
 */
export class Recommendation extends Message {
    /**
     * @generated from field: string title = 1;
     */
    title = "";
    /**
     * @generated from field: string description = 2;
     */
    description = "";
    /**
     * @generated from field: druz9.v1.RecommendationAction action = 3;
     */
    action;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Recommendation";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "action", kind: "message", T: RecommendationAction },
    ]);
    static fromBinary(bytes, options) {
        return new Recommendation().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Recommendation().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Recommendation().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Recommendation, a, b);
    }
}
/**
 * SectionBreakdown — агрегат XP / wins / losses по одной секции за период.
 * Используется в WeeklyReport для блоков «Сильные/Слабые секции» — frontend
 * раньше держал захардкоженный массив, теперь читает реальные данные.
 *
 * @generated from message druz9.v1.SectionBreakdown
 */
export class SectionBreakdown extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 matches = 2;
     */
    matches = 0;
    /**
     * @generated from field: int32 wins = 3;
     */
    wins = 0;
    /**
     * @generated from field: int32 losses = 4;
     */
    losses = 0;
    /**
     * @generated from field: int32 xp_delta = 5;
     */
    xpDelta = 0;
    /**
     * win_rate — целое число процентов (0..100); считается на бэке, чтобы
     * фронт не дублировал арифметику.
     *
     * @generated from field: int32 win_rate_pct = 6;
     */
    winRatePct = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SectionBreakdown";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "matches", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "wins", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "losses", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "xp_delta", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 6, name: "win_rate_pct", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new SectionBreakdown().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SectionBreakdown().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SectionBreakdown().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SectionBreakdown, a, b);
    }
}
/**
 * WeekComparison — XP за конкретную неделю в прошлом. label = "Эта" |
 * "-1" | "-2" | "-3" (порядок сохраняется на бэке).
 *
 * @generated from message druz9.v1.WeekComparison
 */
export class WeekComparison extends Message {
    /**
     * @generated from field: string label = 1;
     */
    label = "";
    /**
     * @generated from field: int32 xp = 2;
     */
    xp = 0;
    /**
     * pct — относительная высота для гистограммы (0..100). Считается так,
     * чтобы максимум среди 4 строк → 100%.
     *
     * @generated from field: int32 pct = 3;
     */
    pct = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.WeekComparison";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "label", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "xp", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "pct", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new WeekComparison().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new WeekComparison().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new WeekComparison().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(WeekComparison, a, b);
    }
}
/**
 * WeeklyReport mirrors OpenAPI WeeklyReport.
 *
 * @generated from message druz9.v1.WeeklyReport
 */
export class WeeklyReport extends Message {
    /**
     * week_start / week_end are ISO-8601 calendar dates (YYYY-MM-DD). OpenAPI
     * types them as `format: date`; proto3 has no date, so we use strings.
     *
     * @generated from field: string week_start = 1;
     */
    weekStart = "";
    /**
     * @generated from field: string week_end = 2;
     */
    weekEnd = "";
    /**
     * @generated from field: druz9.v1.ReportMetrics metrics = 3;
     */
    metrics;
    /**
     * heatmap is 7 cells with intensity 0..4.
     *
     * @generated from field: repeated int32 heatmap = 4;
     */
    heatmap = [];
    /**
     * @generated from field: repeated string strengths = 5;
     */
    strengths = [];
    /**
     * @generated from field: repeated druz9.v1.ReportWeakness weaknesses = 6;
     */
    weaknesses = [];
    /**
     * @generated from field: string stress_analysis = 7;
     */
    stressAnalysis = "";
    /**
     * @generated from field: repeated druz9.v1.Recommendation recommendations = 8;
     */
    recommendations = [];
    /**
     * Агрегаты для фронта /report (WeeklyReportPage). Раньше были захардкожены
     * в JSX; теперь приходят с бэка готовыми к рендеру.
     *
     * @generated from field: int32 actions_count = 9;
     */
    actionsCount = 0;
    /**
     * @generated from field: int32 streak_days = 10;
     */
    streakDays = 0;
    /**
     * @generated from field: int32 best_streak = 11;
     */
    bestStreak = 0;
    /**
     * @generated from field: int32 prev_xp_earned = 12;
     */
    prevXpEarned = 0;
    /**
     * Сильные / слабые секции на фронте, отсортированные по xp_delta DESC/ASC.
     * Бэк гарантирует, что одна и та же секция не попадёт в оба списка.
     *
     * @generated from field: repeated druz9.v1.SectionBreakdown strong_sections = 13;
     */
    strongSections = [];
    /**
     * @generated from field: repeated druz9.v1.SectionBreakdown weak_sections = 14;
     */
    weakSections = [];
    /**
     * Сравнение XP за последние 4 недели (включая текущую). Длина = 4.
     *
     * @generated from field: repeated druz9.v1.WeekComparison weekly_xp = 15;
     */
    weeklyXp = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.WeeklyReport";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "week_start", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "week_end", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "metrics", kind: "message", T: ReportMetrics },
        { no: 4, name: "heatmap", kind: "scalar", T: 5 /* ScalarType.INT32 */, repeated: true },
        { no: 5, name: "strengths", kind: "scalar", T: 9 /* ScalarType.STRING */, repeated: true },
        { no: 6, name: "weaknesses", kind: "message", T: ReportWeakness, repeated: true },
        { no: 7, name: "stress_analysis", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 8, name: "recommendations", kind: "message", T: Recommendation, repeated: true },
        { no: 9, name: "actions_count", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 10, name: "streak_days", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 11, name: "best_streak", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 12, name: "prev_xp_earned", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 13, name: "strong_sections", kind: "message", T: SectionBreakdown, repeated: true },
        { no: 14, name: "weak_sections", kind: "message", T: SectionBreakdown, repeated: true },
        { no: 15, name: "weekly_xp", kind: "message", T: WeekComparison, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new WeeklyReport().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new WeeklyReport().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new WeeklyReport().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(WeeklyReport, a, b);
    }
}
/**
 * ProfileSettings mirrors OpenAPI ProfileSettings.
 *
 * @generated from message druz9.v1.ProfileSettings
 */
export class ProfileSettings extends Message {
    /**
     * @generated from field: string display_name = 1;
     */
    displayName = "";
    /**
     * @generated from field: druz9.v1.Language default_language = 2;
     */
    defaultLanguage = Language.UNSPECIFIED;
    /**
     * locale is "ru" | "en" — string keeps wire compat with REST.
     *
     * @generated from field: string locale = 3;
     */
    locale = "";
    /**
     * @generated from field: druz9.v1.NotificationPreferences notifications = 4;
     */
    notifications;
    /**
     * @generated from field: bool voice_mode_enabled = 5;
     */
    voiceModeEnabled = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ProfileSettings";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "display_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "default_language", kind: "enum", T: proto3.getEnumType(Language) },
        { no: 3, name: "locale", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "notifications", kind: "message", T: NotificationPreferences },
        { no: 5, name: "voice_mode_enabled", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new ProfileSettings().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ProfileSettings().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ProfileSettings().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ProfileSettings, a, b);
    }
}
/**
 * UpdateProfileSettingsRequest wraps the ProfileSettings payload. OpenAPI
 * uses the settings object directly as the request body; Connect prefers a
 * named request type.
 *
 * @generated from message druz9.v1.UpdateProfileSettingsRequest
 */
export class UpdateProfileSettingsRequest extends Message {
    /**
     * @generated from field: druz9.v1.ProfileSettings settings = 1;
     */
    settings;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.UpdateProfileSettingsRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "settings", kind: "message", T: ProfileSettings },
    ]);
    static fromBinary(bytes, options) {
        return new UpdateProfileSettingsRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new UpdateProfileSettingsRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new UpdateProfileSettingsRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(UpdateProfileSettingsRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMyProfileRequest
 */
export class GetMyProfileRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMyProfileRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetMyProfileRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMyProfileRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMyProfileRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMyProfileRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMyAtlasRequest
 */
export class GetMyAtlasRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMyAtlasRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetMyAtlasRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMyAtlasRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMyAtlasRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMyAtlasRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMyReportRequest
 */
export class GetMyReportRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMyReportRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetMyReportRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMyReportRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMyReportRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMyReportRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetPublicProfileRequest
 */
export class GetPublicProfileRequest extends Message {
    /**
     * @generated from field: string username = 1;
     */
    username = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetPublicProfileRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetPublicProfileRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetPublicProfileRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetPublicProfileRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetPublicProfileRequest, a, b);
    }
}
