// cohort.proto — Connect-RPC contract for the `cohort` bounded context.
//
// Covers cohort lookup, war state, and contribute endpoint. Contributors are
// modelled via a flat list on each WarLine (matches OpenAPI).
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Language, Section } from "./common_pb.js";
/**
 * CohortMember mirrors OpenAPI CohortMember.
 *
 * @generated from message druz9.v1.CohortMember
 */
export class CohortMember extends Message {
    /**
     * @generated from field: string user_id = 1;
     */
    userId = "";
    /**
     * @generated from field: string username = 2;
     */
    username = "";
    /**
     * role is "captain" | "member" in OpenAPI; kept as string so we don't need
     * yet another tiny enum for 2 values.
     *
     * @generated from field: string role = 3;
     */
    role = "";
    /**
     * @generated from field: google.protobuf.Timestamp joined_at = 4;
     */
    joinedAt;
    /**
     * assigned_section is optional — uses SECTION_UNSPECIFIED for "unassigned".
     *
     * @generated from field: druz9.v1.Section assigned_section = 5;
     */
    assignedSection = Section.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CohortMember";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "role", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "joined_at", kind: "message", T: Timestamp },
        { no: 5, name: "assigned_section", kind: "enum", T: proto3.getEnumType(Section) },
    ]);
    static fromBinary(bytes, options) {
        return new CohortMember().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CohortMember().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CohortMember().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CohortMember, a, b);
    }
}
/**
 * Cohort mirrors OpenAPI Cohort.
 *
 * @generated from message druz9.v1.Cohort
 */
export class Cohort extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string name = 2;
     */
    name = "";
    /**
     * @generated from field: string emblem = 3;
     */
    emblem = "";
    /**
     * @generated from field: int32 cohort_elo = 4;
     */
    cohortElo = 0;
    /**
     * @generated from field: repeated druz9.v1.CohortMember members = 5;
     */
    members = [];
    /**
     * current_war_id is optional — empty string when no active war.
     *
     * @generated from field: string current_war_id = 6;
     */
    currentWarId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Cohort";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "emblem", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "cohort_elo", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "members", kind: "message", T: CohortMember, repeated: true },
        { no: 6, name: "current_war_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new Cohort().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Cohort().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Cohort().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Cohort, a, b);
    }
}
/**
 * CohortSummary is the small { id, name, emblem } shape used inside CohortWar.
 *
 * @generated from message druz9.v1.CohortSummary
 */
export class CohortSummary extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string name = 2;
     */
    name = "";
    /**
     * @generated from field: string emblem = 3;
     */
    emblem = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CohortSummary";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "emblem", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new CohortSummary().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CohortSummary().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CohortSummary().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CohortSummary, a, b);
    }
}
/**
 * WarLineContributor mirrors the inline contributor shape inside OpenAPI WarLine.
 *
 * @generated from message druz9.v1.WarLineContributor
 */
export class WarLineContributor extends Message {
    /**
     * @generated from field: string user_id = 1;
     */
    userId = "";
    /**
     * @generated from field: string username = 2;
     */
    username = "";
    /**
     * side is "a" | "b" in OpenAPI — string preserves wire compatibility with
     * REST transcoding (vanguard). An enum would also work; we match the OpenAPI
     * literal.
     *
     * @generated from field: string side = 3;
     */
    side = "";
    /**
     * @generated from field: int32 score = 4;
     */
    score = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.WarLineContributor";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "side", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "score", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new WarLineContributor().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new WarLineContributor().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new WarLineContributor().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(WarLineContributor, a, b);
    }
}
/**
 * WarLine mirrors OpenAPI WarLine.
 *
 * @generated from message druz9.v1.WarLine
 */
export class WarLine extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 score_a = 2;
     */
    scoreA = 0;
    /**
     * @generated from field: int32 score_b = 3;
     */
    scoreB = 0;
    /**
     * @generated from field: repeated druz9.v1.WarLineContributor contributors = 4;
     */
    contributors = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.WarLine";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "score_a", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "score_b", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "contributors", kind: "message", T: WarLineContributor, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new WarLine().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new WarLine().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new WarLine().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(WarLine, a, b);
    }
}
/**
 * CohortWar mirrors OpenAPI CohortWar. Uses ISO-8601 date strings for week
 * boundaries; proto3 has no native Date type.
 *
 * @generated from message druz9.v1.CohortWar
 */
export class CohortWar extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * week_start is an ISO-8601 date (YYYY-MM-DD) per the OpenAPI contract.
     *
     * @generated from field: string week_start = 2;
     */
    weekStart = "";
    /**
     * @generated from field: string week_end = 3;
     */
    weekEnd = "";
    /**
     * @generated from field: druz9.v1.CohortSummary cohort_a = 4;
     */
    cohortA;
    /**
     * @generated from field: druz9.v1.CohortSummary cohort_b = 5;
     */
    cohortB;
    /**
     * @generated from field: repeated druz9.v1.WarLine lines = 6;
     */
    lines = [];
    /**
     * winner_cohort_id is optional — empty string when the war is still active.
     *
     * @generated from field: string winner_cohort_id = 7;
     */
    winnerCohortId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CohortWar";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "week_start", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "week_end", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "cohort_a", kind: "message", T: CohortSummary },
        { no: 5, name: "cohort_b", kind: "message", T: CohortSummary },
        { no: 6, name: "lines", kind: "message", T: WarLine, repeated: true },
        { no: 7, name: "winner_cohort_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new CohortWar().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CohortWar().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CohortWar().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CohortWar, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetMyCohortRequest
 */
export class GetMyCohortRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetMyCohortRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetMyCohortRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetMyCohortRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetMyCohortRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetMyCohortRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetCohortRequest
 */
export class GetCohortRequest extends Message {
    /**
     * @generated from field: string cohort_id = 1;
     */
    cohortId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetCohortRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "cohort_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetCohortRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetCohortRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetCohortRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetCohortRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetCohortWarRequest
 */
export class GetCohortWarRequest extends Message {
    /**
     * @generated from field: string cohort_id = 1;
     */
    cohortId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetCohortWarRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "cohort_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new GetCohortWarRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetCohortWarRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetCohortWarRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetCohortWarRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.ContributeRequest
 */
export class ContributeRequest extends Message {
    /**
     * @generated from field: string cohort_id = 1;
     */
    cohortId = "";
    /**
     * @generated from field: druz9.v1.Section section = 2;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: string code = 3;
     */
    code = "";
    /**
     * @generated from field: druz9.v1.Language language = 4;
     */
    language = Language.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ContributeRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "cohort_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 3, name: "code", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "language", kind: "enum", T: proto3.getEnumType(Language) },
    ]);
    static fromBinary(bytes, options) {
        return new ContributeRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ContributeRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ContributeRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ContributeRequest, a, b);
    }
}
/**
 * TopCohortSummary — одна строка топ-листа когорт.
 * Используется в ListTopCohorts (страница /cohort без cohort_id, для не-членов).
 *
 * @generated from message druz9.v1.TopCohortSummary
 */
export class TopCohortSummary extends Message {
    /**
     * @generated from field: string cohort_id = 1;
     */
    cohortId = "";
    /**
     * @generated from field: string name = 2;
     */
    name = "";
    /**
     * @generated from field: string emblem = 3;
     */
    emblem = "";
    /**
     * @generated from field: int32 members_count = 4;
     */
    membersCount = 0;
    /**
     * @generated from field: int32 elo_total = 5;
     */
    eloTotal = 0;
    /**
     * @generated from field: int32 wars_won = 6;
     */
    warsWon = 0;
    /**
     * @generated from field: int32 rank = 7;
     */
    rank = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.TopCohortSummary";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "cohort_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "emblem", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "members_count", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "elo_total", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 6, name: "wars_won", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 7, name: "rank", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new TopCohortSummary().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new TopCohortSummary().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new TopCohortSummary().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(TopCohortSummary, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListTopCohortsRequest
 */
export class ListTopCohortsRequest extends Message {
    /**
     * limit: 1..100, default 20.
     *
     * @generated from field: int32 limit = 1;
     */
    limit = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListTopCohortsRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "limit", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new ListTopCohortsRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListTopCohortsRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListTopCohortsRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListTopCohortsRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListTopCohortsResponse
 */
export class ListTopCohortsResponse extends Message {
    /**
     * @generated from field: repeated druz9.v1.TopCohortSummary items = 1;
     */
    items = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListTopCohortsResponse";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: TopCohortSummary, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new ListTopCohortsResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListTopCohortsResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListTopCohortsResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListTopCohortsResponse, a, b);
    }
}
