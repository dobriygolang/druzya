// admin.proto — Connect-RPC contract for the `admin` bounded context.
//
// Admin is a CMS/ops surface (bible §3.14). Every RPC requires role=admin;
// the role gate lives in ports/server.go — apigen had its requireAdmin
// inside the port and this proto preserves that split. main.go still wraps
// the handler in requireAuth (same as every other domain) — the extra
// admin role check happens inside the port method bodies.
//
// ── solution_hint EXCEPTION ──────────────────────────────────────────────
// AdminTask INTENTIONALLY exposes `solution_hint`. Every OTHER proto in
// this repo (profile's atlas, daily's kata, arena's task, mock's task,
// native's task) MUST NOT. The role gate on this service is the sole
// guardrail. Do not create a public Task alias of AdminTask — they are
// kept as separate messages by design.
import { Message, proto3, protoInt64, Timestamp, Value } from "@bufbuild/protobuf";
import { Difficulty, DungeonTier, Section, SeverityLevel } from "./common_pb.js";
/**
 * ConfigEntryType mirrors the `type` discriminator on ConfigEntry.
 *
 * @generated from enum druz9.v1.ConfigEntryType
 */
export var ConfigEntryType;
(function (ConfigEntryType) {
    /**
     * @generated from enum value: CONFIG_ENTRY_TYPE_UNSPECIFIED = 0;
     */
    ConfigEntryType[ConfigEntryType["UNSPECIFIED"] = 0] = "UNSPECIFIED";
    /**
     * @generated from enum value: CONFIG_ENTRY_TYPE_INT = 1;
     */
    ConfigEntryType[ConfigEntryType["INT"] = 1] = "INT";
    /**
     * @generated from enum value: CONFIG_ENTRY_TYPE_FLOAT = 2;
     */
    ConfigEntryType[ConfigEntryType["FLOAT"] = 2] = "FLOAT";
    /**
     * @generated from enum value: CONFIG_ENTRY_TYPE_STRING = 3;
     */
    ConfigEntryType[ConfigEntryType["STRING"] = 3] = "STRING";
    /**
     * @generated from enum value: CONFIG_ENTRY_TYPE_BOOL = 4;
     */
    ConfigEntryType[ConfigEntryType["BOOL"] = 4] = "BOOL";
    /**
     * @generated from enum value: CONFIG_ENTRY_TYPE_JSON = 5;
     */
    ConfigEntryType[ConfigEntryType["JSON"] = 5] = "JSON";
})(ConfigEntryType || (ConfigEntryType = {}));
// Retrieve enum metadata with: proto3.getEnumType(ConfigEntryType)
proto3.util.setEnumType(ConfigEntryType, "druz9.v1.ConfigEntryType", [
    { no: 0, name: "CONFIG_ENTRY_TYPE_UNSPECIFIED" },
    { no: 1, name: "CONFIG_ENTRY_TYPE_INT" },
    { no: 2, name: "CONFIG_ENTRY_TYPE_FLOAT" },
    { no: 3, name: "CONFIG_ENTRY_TYPE_STRING" },
    { no: 4, name: "CONFIG_ENTRY_TYPE_BOOL" },
    { no: 5, name: "CONFIG_ENTRY_TYPE_JSON" },
]);
/**
 * AdminTaskTestCase mirrors the inline test-case item in OpenAPI AdminTask.
 *
 * @generated from message druz9.v1.AdminTaskTestCase
 */
export class AdminTaskTestCase extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string input = 2;
     */
    input = "";
    /**
     * @generated from field: string expected_output = 3;
     */
    expectedOutput = "";
    /**
     * @generated from field: bool is_hidden = 4;
     */
    isHidden = false;
    /**
     * @generated from field: int32 order_num = 5;
     */
    orderNum = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminTaskTestCase";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "input", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "expected_output", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "is_hidden", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 5, name: "order_num", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new AdminTaskTestCase().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminTaskTestCase().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminTaskTestCase().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminTaskTestCase, a, b);
    }
}
/**
 * AdminTaskFollowUpQuestion mirrors the inline follow-up item.
 *
 * @generated from message druz9.v1.AdminTaskFollowUpQuestion
 */
export class AdminTaskFollowUpQuestion extends Message {
    /**
     * @generated from field: string question_ru = 1;
     */
    questionRu = "";
    /**
     * @generated from field: string question_en = 2;
     */
    questionEn = "";
    /**
     * @generated from field: string answer_hint = 3;
     */
    answerHint = "";
    /**
     * @generated from field: int32 order_num = 4;
     */
    orderNum = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminTaskFollowUpQuestion";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "question_ru", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "question_en", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "answer_hint", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "order_num", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new AdminTaskFollowUpQuestion().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminTaskFollowUpQuestion().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminTaskFollowUpQuestion().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminTaskFollowUpQuestion, a, b);
    }
}
/**
 * AdminTask is the curator-facing task projection — INCLUDES solution_hint.
 *
 * @generated from message druz9.v1.AdminTask
 */
export class AdminTask extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string slug = 2;
     */
    slug = "";
    /**
     * @generated from field: string title_ru = 3;
     */
    titleRu = "";
    /**
     * @generated from field: string title_en = 4;
     */
    titleEn = "";
    /**
     * @generated from field: string description_ru = 5;
     */
    descriptionRu = "";
    /**
     * @generated from field: string description_en = 6;
     */
    descriptionEn = "";
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 7;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Section section = 8;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 time_limit_sec = 9;
     */
    timeLimitSec = 0;
    /**
     * @generated from field: int32 memory_limit_mb = 10;
     */
    memoryLimitMb = 0;
    /**
     * admin-only (see package doc)
     *
     * @generated from field: string solution_hint = 11;
     */
    solutionHint = "";
    /**
     * @generated from field: int32 version = 12;
     */
    version = 0;
    /**
     * @generated from field: bool is_active = 13;
     */
    isActive = false;
    /**
     * @generated from field: repeated druz9.v1.AdminTaskTestCase test_cases = 14;
     */
    testCases = [];
    /**
     * @generated from field: repeated druz9.v1.AdminTaskFollowUpQuestion follow_up_questions = 15;
     */
    followUpQuestions = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminTask";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "title_ru", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "title_en", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "description_ru", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "description_en", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 7, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 8, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 9, name: "time_limit_sec", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 10, name: "memory_limit_mb", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 11, name: "solution_hint", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 12, name: "version", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 13, name: "is_active", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 14, name: "test_cases", kind: "message", T: AdminTaskTestCase, repeated: true },
        { no: 15, name: "follow_up_questions", kind: "message", T: AdminTaskFollowUpQuestion, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new AdminTask().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminTask().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminTask().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminTask, a, b);
    }
}
/**
 * AdminTaskList mirrors OpenAPI AdminTaskList.
 *
 * @generated from message druz9.v1.AdminTaskList
 */
export class AdminTaskList extends Message {
    /**
     * @generated from field: repeated druz9.v1.AdminTask items = 1;
     */
    items = [];
    /**
     * @generated from field: int32 total = 2;
     */
    total = 0;
    /**
     * @generated from field: int32 page = 3;
     */
    page = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminTaskList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: AdminTask, repeated: true },
        { no: 2, name: "total", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "page", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new AdminTaskList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminTaskList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminTaskList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminTaskList, a, b);
    }
}
/**
 * AdminTaskUpsert mirrors OpenAPI AdminTaskUpsert (POST/PUT body).
 *
 * @generated from message druz9.v1.AdminTaskUpsert
 */
export class AdminTaskUpsert extends Message {
    /**
     * @generated from field: string slug = 1;
     */
    slug = "";
    /**
     * @generated from field: string title_ru = 2;
     */
    titleRu = "";
    /**
     * @generated from field: string title_en = 3;
     */
    titleEn = "";
    /**
     * @generated from field: string description_ru = 4;
     */
    descriptionRu = "";
    /**
     * @generated from field: string description_en = 5;
     */
    descriptionEn = "";
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 6;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Section section = 7;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: int32 time_limit_sec = 8;
     */
    timeLimitSec = 0;
    /**
     * @generated from field: int32 memory_limit_mb = 9;
     */
    memoryLimitMb = 0;
    /**
     * @generated from field: string solution_hint = 10;
     */
    solutionHint = "";
    /**
     * @generated from field: bool is_active = 11;
     */
    isActive = false;
    /**
     * @generated from field: repeated druz9.v1.AdminTaskTestCase test_cases = 12;
     */
    testCases = [];
    /**
     * @generated from field: repeated druz9.v1.AdminTaskFollowUpQuestion follow_up_questions = 13;
     */
    followUpQuestions = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminTaskUpsert";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "title_ru", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "title_en", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "description_ru", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "description_en", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 7, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 8, name: "time_limit_sec", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 9, name: "memory_limit_mb", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 10, name: "solution_hint", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 11, name: "is_active", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 12, name: "test_cases", kind: "message", T: AdminTaskTestCase, repeated: true },
        { no: 13, name: "follow_up_questions", kind: "message", T: AdminTaskFollowUpQuestion, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new AdminTaskUpsert().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminTaskUpsert().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminTaskUpsert().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminTaskUpsert, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListAdminTasksRequest
 */
export class ListAdminTasksRequest extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 2;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * is_active_set=true means the is_active filter is applied (value in
     * is_active). Keeping the tri-state requires a companion flag since
     * proto3 bool has no "unset" sentinel.
     *
     * @generated from field: bool is_active = 3;
     */
    isActive = false;
    /**
     * @generated from field: bool is_active_set = 4;
     */
    isActiveSet = false;
    /**
     * @generated from field: int32 page = 5;
     */
    page = 0;
    /**
     * @generated from field: int32 limit = 6;
     */
    limit = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListAdminTasksRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 3, name: "is_active", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 4, name: "is_active_set", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 5, name: "page", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 6, name: "limit", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new ListAdminTasksRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListAdminTasksRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListAdminTasksRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListAdminTasksRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.CreateAdminTaskRequest
 */
export class CreateAdminTaskRequest extends Message {
    /**
     * @generated from field: druz9.v1.AdminTaskUpsert task = 1;
     */
    task;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateAdminTaskRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "task", kind: "message", T: AdminTaskUpsert },
    ]);
    static fromBinary(bytes, options) {
        return new CreateAdminTaskRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateAdminTaskRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateAdminTaskRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateAdminTaskRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.UpdateAdminTaskRequest
 */
export class UpdateAdminTaskRequest extends Message {
    /**
     * @generated from field: string task_id = 1;
     */
    taskId = "";
    /**
     * @generated from field: druz9.v1.AdminTaskUpsert task = 2;
     */
    task;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.UpdateAdminTaskRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "task_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "task", kind: "message", T: AdminTaskUpsert },
    ]);
    static fromBinary(bytes, options) {
        return new UpdateAdminTaskRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new UpdateAdminTaskRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new UpdateAdminTaskRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(UpdateAdminTaskRequest, a, b);
    }
}
/**
 * Company mirrors OpenAPI Company.
 *
 * @generated from message druz9.v1.Company
 */
export class Company extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string slug = 2;
     */
    slug = "";
    /**
     * @generated from field: string name = 3;
     */
    name = "";
    /**
     * @generated from field: druz9.v1.DungeonTier difficulty = 4;
     */
    difficulty = DungeonTier.UNSPECIFIED;
    /**
     * @generated from field: int32 min_level_required = 5;
     */
    minLevelRequired = 0;
    /**
     * @generated from field: repeated druz9.v1.Section sections = 6;
     */
    sections = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Company";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "difficulty", kind: "enum", T: proto3.getEnumType(DungeonTier) },
        { no: 5, name: "min_level_required", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 6, name: "sections", kind: "enum", T: proto3.getEnumType(Section), repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new Company().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Company().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Company().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Company, a, b);
    }
}
/**
 * @generated from message druz9.v1.CompanyList
 */
export class CompanyList extends Message {
    /**
     * @generated from field: repeated druz9.v1.Company items = 1;
     */
    items = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CompanyList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: Company, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new CompanyList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CompanyList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CompanyList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CompanyList, a, b);
    }
}
/**
 * CompanyUpsert mirrors OpenAPI CompanyUpsert (POST body).
 *
 * @generated from message druz9.v1.CompanyUpsert
 */
export class CompanyUpsert extends Message {
    /**
     * @generated from field: string slug = 1;
     */
    slug = "";
    /**
     * @generated from field: string name = 2;
     */
    name = "";
    /**
     * @generated from field: druz9.v1.DungeonTier difficulty = 3;
     */
    difficulty = DungeonTier.UNSPECIFIED;
    /**
     * @generated from field: int32 min_level_required = 4;
     */
    minLevelRequired = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CompanyUpsert";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "difficulty", kind: "enum", T: proto3.getEnumType(DungeonTier) },
        { no: 4, name: "min_level_required", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new CompanyUpsert().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CompanyUpsert().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CompanyUpsert().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CompanyUpsert, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListCompaniesRequest
 */
export class ListCompaniesRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListCompaniesRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new ListCompaniesRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListCompaniesRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListCompaniesRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListCompaniesRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.CreateCompanyRequest
 */
export class CreateCompanyRequest extends Message {
    /**
     * @generated from field: druz9.v1.CompanyUpsert company = 1;
     */
    company;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateCompanyRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "company", kind: "message", T: CompanyUpsert },
    ]);
    static fromBinary(bytes, options) {
        return new CreateCompanyRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateCompanyRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateCompanyRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateCompanyRequest, a, b);
    }
}
/**
 * ConfigEntry mirrors OpenAPI ConfigEntry. The OpenAPI `value` field is a
 * oneOf<number|string|bool|object>; we use google.protobuf.Value to keep the
 * JSON shape opaque on the wire. The app layer still round-trips the raw
 * bytes through the ConfigType discriminator (see ports/server.go).
 *
 * @generated from message druz9.v1.ConfigEntry
 */
export class ConfigEntry extends Message {
    /**
     * @generated from field: string key = 1;
     */
    key = "";
    /**
     * @generated from field: google.protobuf.Value value = 2;
     */
    value;
    /**
     * @generated from field: druz9.v1.ConfigEntryType type = 3;
     */
    type = ConfigEntryType.UNSPECIFIED;
    /**
     * @generated from field: string description = 4;
     */
    description = "";
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 5;
     */
    updatedAt;
    /**
     * updated_by is optional — empty when no writer recorded.
     *
     * @generated from field: string updated_by = 6;
     */
    updatedBy = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ConfigEntry";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "value", kind: "message", T: Value },
        { no: 3, name: "type", kind: "enum", T: proto3.getEnumType(ConfigEntryType) },
        { no: 4, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "updated_at", kind: "message", T: Timestamp },
        { no: 6, name: "updated_by", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new ConfigEntry().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ConfigEntry().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ConfigEntry().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ConfigEntry, a, b);
    }
}
/**
 * @generated from message druz9.v1.ConfigEntryList
 */
export class ConfigEntryList extends Message {
    /**
     * @generated from field: repeated druz9.v1.ConfigEntry items = 1;
     */
    items = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ConfigEntryList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: ConfigEntry, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new ConfigEntryList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ConfigEntryList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ConfigEntryList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ConfigEntryList, a, b);
    }
}
/**
 * ConfigUpdate mirrors OpenAPI ConfigUpdate (PUT body). `value` is the same
 * opaque JSON as ConfigEntry.value.
 *
 * @generated from message druz9.v1.UpdateConfigRequest
 */
export class UpdateConfigRequest extends Message {
    /**
     * @generated from field: string key = 1;
     */
    key = "";
    /**
     * @generated from field: google.protobuf.Value value = 2;
     */
    value;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.UpdateConfigRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "key", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "value", kind: "message", T: Value },
    ]);
    static fromBinary(bytes, options) {
        return new UpdateConfigRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new UpdateConfigRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new UpdateConfigRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(UpdateConfigRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListConfigRequest
 */
export class ListConfigRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListConfigRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new ListConfigRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListConfigRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListConfigRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListConfigRequest, a, b);
    }
}
/**
 * AnticheatSignal mirrors OpenAPI AnticheatSignal.
 *
 * @generated from message druz9.v1.AnticheatSignal
 */
export class AnticheatSignal extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string user_id = 2;
     */
    userId = "";
    /**
     * @generated from field: string username = 3;
     */
    username = "";
    /**
     * @generated from field: string match_id = 4;
     */
    matchId = "";
    /**
     * `type` in OpenAPI is a free-form string example — we keep it as a
     * string here for wire compatibility. The shared enum
     * AnticheatSignalType in common.proto lists the known values; the REST
     * wire surface is a plain string.
     *
     * @generated from field: string type = 5;
     */
    type = "";
    /**
     * @generated from field: druz9.v1.SeverityLevel severity = 6;
     */
    severity = SeverityLevel.UNSPECIFIED;
    /**
     * metadata is a free-form JSON object — again kept opaque via Value.
     *
     * @generated from field: google.protobuf.Value metadata = 7;
     */
    metadata;
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 8;
     */
    createdAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AnticheatSignal";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "match_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "type", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "severity", kind: "enum", T: proto3.getEnumType(SeverityLevel) },
        { no: 7, name: "metadata", kind: "message", T: Value },
        { no: 8, name: "created_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new AnticheatSignal().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AnticheatSignal().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AnticheatSignal().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AnticheatSignal, a, b);
    }
}
/**
 * @generated from message druz9.v1.AnticheatSignalList
 */
export class AnticheatSignalList extends Message {
    /**
     * @generated from field: repeated druz9.v1.AnticheatSignal items = 1;
     */
    items = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AnticheatSignalList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: AnticheatSignal, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new AnticheatSignalList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AnticheatSignalList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AnticheatSignalList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AnticheatSignalList, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListAnticheatRequest
 */
export class ListAnticheatRequest extends Message {
    /**
     * @generated from field: druz9.v1.SeverityLevel severity = 1;
     */
    severity = SeverityLevel.UNSPECIFIED;
    /**
     * @generated from field: google.protobuf.Timestamp from = 2;
     */
    from;
    /**
     * @generated from field: int32 limit = 3;
     */
    limit = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListAnticheatRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "severity", kind: "enum", T: proto3.getEnumType(SeverityLevel) },
        { no: 2, name: "from", kind: "message", T: Timestamp },
        { no: 3, name: "limit", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new ListAnticheatRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListAnticheatRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListAnticheatRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListAnticheatRequest, a, b);
    }
}
/**
 * AdminDashboard mirrors the JSON shape served by GET /api/v1/admin/dashboard.
 * Counters are live aggregates with a 60s server-side Redis cache. Every
 * "active_*" timeframe is computed off users.updated_at (see stats.go for
 * the same proxy used by /stats/public).
 *
 * @generated from message druz9.v1.AdminDashboard
 */
export class AdminDashboard extends Message {
    /**
     * @generated from field: int64 users_total = 1;
     */
    usersTotal = protoInt64.zero;
    /**
     * @generated from field: int64 users_active_today = 2;
     */
    usersActiveToday = protoInt64.zero;
    /**
     * @generated from field: int64 users_active_week = 3;
     */
    usersActiveWeek = protoInt64.zero;
    /**
     * @generated from field: int64 users_active_month = 4;
     */
    usersActiveMonth = protoInt64.zero;
    /**
     * @generated from field: int64 users_banned = 5;
     */
    usersBanned = protoInt64.zero;
    /**
     * @generated from field: int64 matches_today = 6;
     */
    matchesToday = protoInt64.zero;
    /**
     * @generated from field: int64 matches_week = 7;
     */
    matchesWeek = protoInt64.zero;
    /**
     * @generated from field: int64 katas_today = 8;
     */
    katasToday = protoInt64.zero;
    /**
     * @generated from field: int64 katas_week = 9;
     */
    katasWeek = protoInt64.zero;
    /**
     * @generated from field: int64 active_mock_sessions = 10;
     */
    activeMockSessions = protoInt64.zero;
    /**
     * @generated from field: int64 active_arena_matches = 11;
     */
    activeArenaMatches = protoInt64.zero;
    /**
     * @generated from field: int64 reports_pending = 12;
     */
    reportsPending = protoInt64.zero;
    /**
     * @generated from field: int64 anticheat_signals_24h = 13;
     */
    anticheatSignals24h = protoInt64.zero;
    /**
     * generated_at — when the snapshot was assembled (cache miss timestamp).
     *
     * @generated from field: google.protobuf.Timestamp generated_at = 14;
     */
    generatedAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminDashboard";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "users_total", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 2, name: "users_active_today", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 3, name: "users_active_week", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 4, name: "users_active_month", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 5, name: "users_banned", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 6, name: "matches_today", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 7, name: "matches_week", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 8, name: "katas_today", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 9, name: "katas_week", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 10, name: "active_mock_sessions", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 11, name: "active_arena_matches", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 12, name: "reports_pending", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 13, name: "anticheat_signals_24h", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 14, name: "generated_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new AdminDashboard().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminDashboard().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminDashboard().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminDashboard, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetAdminDashboardRequest
 */
export class GetAdminDashboardRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetAdminDashboardRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetAdminDashboardRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetAdminDashboardRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetAdminDashboardRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetAdminDashboardRequest, a, b);
    }
}
/**
 * AdminUserRow is the row shape returned by GET /api/v1/admin/users.
 * Mirrors users + (optional) currently-active user_bans row.
 *
 * @generated from message druz9.v1.AdminUserRow
 */
export class AdminUserRow extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string username = 2;
     */
    username = "";
    /**
     * @generated from field: string email = 3;
     */
    email = "";
    /**
     * @generated from field: string display_name = 4;
     */
    displayName = "";
    /**
     * @generated from field: string role = 5;
     */
    role = "";
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 6;
     */
    createdAt;
    /**
     * @generated from field: google.protobuf.Timestamp updated_at = 7;
     */
    updatedAt;
    /**
     * @generated from field: bool is_banned = 8;
     */
    isBanned = false;
    /**
     * ban_reason / ban_expires_at populated when is_banned=true.
     *
     * @generated from field: string ban_reason = 9;
     */
    banReason = "";
    /**
     * @generated from field: google.protobuf.Timestamp ban_expires_at = 10;
     */
    banExpiresAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminUserRow";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "email", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "display_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "role", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "created_at", kind: "message", T: Timestamp },
        { no: 7, name: "updated_at", kind: "message", T: Timestamp },
        { no: 8, name: "is_banned", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 9, name: "ban_reason", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 10, name: "ban_expires_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new AdminUserRow().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminUserRow().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminUserRow().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminUserRow, a, b);
    }
}
/**
 * @generated from message druz9.v1.AdminUserList
 */
export class AdminUserList extends Message {
    /**
     * @generated from field: repeated druz9.v1.AdminUserRow items = 1;
     */
    items = [];
    /**
     * @generated from field: int32 total = 2;
     */
    total = 0;
    /**
     * @generated from field: int32 page = 3;
     */
    page = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminUserList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: AdminUserRow, repeated: true },
        { no: 2, name: "total", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "page", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new AdminUserList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminUserList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminUserList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminUserList, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListAdminUsersRequest
 */
export class ListAdminUsersRequest extends Message {
    /**
     * Free-form query — case-insensitive prefix match on username + email.
     *
     * @generated from field: string query = 1;
     */
    query = "";
    /**
     * Filter by status: "" / "all" / "banned" / "active".
     *
     * @generated from field: string status = 2;
     */
    status = "";
    /**
     * @generated from field: int32 page = 3;
     */
    page = 0;
    /**
     * @generated from field: int32 limit = 4;
     */
    limit = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListAdminUsersRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "query", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "status", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "page", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 4, name: "limit", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new ListAdminUsersRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListAdminUsersRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListAdminUsersRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListAdminUsersRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.BanUserRequest
 */
export class BanUserRequest extends Message {
    /**
     * @generated from field: string user_id = 1;
     */
    userId = "";
    /**
     * @generated from field: string reason = 2;
     */
    reason = "";
    /**
     * expires_at optional — empty means permanent.
     *
     * @generated from field: google.protobuf.Timestamp expires_at = 3;
     */
    expiresAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.BanUserRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "reason", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "expires_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new BanUserRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new BanUserRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new BanUserRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(BanUserRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.UnbanUserRequest
 */
export class UnbanUserRequest extends Message {
    /**
     * @generated from field: string user_id = 1;
     */
    userId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.UnbanUserRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new UnbanUserRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new UnbanUserRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new UnbanUserRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(UnbanUserRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.BanUserResponse
 */
export class BanUserResponse extends Message {
    /**
     * @generated from field: druz9.v1.AdminUserRow user = 1;
     */
    user;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.BanUserResponse";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user", kind: "message", T: AdminUserRow },
    ]);
    static fromBinary(bytes, options) {
        return new BanUserResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new BanUserResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new BanUserResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(BanUserResponse, a, b);
    }
}
/**
 * @generated from message druz9.v1.AdminReport
 */
export class AdminReport extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string reporter_id = 2;
     */
    reporterId = "";
    /**
     * @generated from field: string reporter_name = 3;
     */
    reporterName = "";
    /**
     * @generated from field: string reported_id = 4;
     */
    reportedId = "";
    /**
     * @generated from field: string reported_name = 5;
     */
    reportedName = "";
    /**
     * @generated from field: string reason = 6;
     */
    reason = "";
    /**
     * @generated from field: string description = 7;
     */
    description = "";
    /**
     * pending / resolved / dismissed
     *
     * @generated from field: string status = 8;
     */
    status = "";
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 9;
     */
    createdAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminReport";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "reporter_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "reporter_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "reported_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "reported_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "reason", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 7, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 8, name: "status", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 9, name: "created_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new AdminReport().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminReport().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminReport().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminReport, a, b);
    }
}
/**
 * @generated from message druz9.v1.AdminReportList
 */
export class AdminReportList extends Message {
    /**
     * @generated from field: repeated druz9.v1.AdminReport items = 1;
     */
    items = [];
    /**
     * @generated from field: int32 total = 2;
     */
    total = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AdminReportList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: AdminReport, repeated: true },
        { no: 2, name: "total", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new AdminReportList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AdminReportList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AdminReportList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AdminReportList, a, b);
    }
}
/**
 * @generated from message druz9.v1.ListAdminReportsRequest
 */
export class ListAdminReportsRequest extends Message {
    /**
     * status filter — "" means pending only.
     *
     * @generated from field: string status = 1;
     */
    status = "";
    /**
     * @generated from field: int32 limit = 2;
     */
    limit = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListAdminReportsRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "status", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "limit", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new ListAdminReportsRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListAdminReportsRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListAdminReportsRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListAdminReportsRequest, a, b);
    }
}
/**
 * StatusServiceState reports the current health of one infra component.
 *
 * @generated from message druz9.v1.StatusServiceState
 */
export class StatusServiceState extends Message {
    /**
     * human label e.g. "PostgreSQL"
     *
     * @generated from field: string name = 1;
     */
    name = "";
    /**
     * machine slug e.g. "postgres"
     *
     * @generated from field: string slug = 2;
     */
    slug = "";
    /**
     * operational / degraded / down
     *
     * @generated from field: string status = 3;
     */
    status = "";
    /**
     * formatted percentage (e.g. "99.97%")
     *
     * @generated from field: string uptime_30d = 4;
     */
    uptime30d = "";
    /**
     * last probe latency
     *
     * @generated from field: int64 latency_ms = 5;
     */
    latencyMs = protoInt64.zero;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.StatusServiceState";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slug", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "status", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "uptime_30d", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "latency_ms", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
    ]);
    static fromBinary(bytes, options) {
        return new StatusServiceState().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new StatusServiceState().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new StatusServiceState().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(StatusServiceState, a, b);
    }
}
/**
 * StatusIncident mirrors an incidents row.
 *
 * @generated from message druz9.v1.StatusIncident
 */
export class StatusIncident extends Message {
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
     * minor / major / critical
     *
     * @generated from field: string severity = 4;
     */
    severity = "";
    /**
     * @generated from field: google.protobuf.Timestamp started_at = 5;
     */
    startedAt;
    /**
     * @generated from field: google.protobuf.Timestamp ended_at = 6;
     */
    endedAt;
    /**
     * @generated from field: repeated string affected_services = 7;
     */
    affectedServices = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.StatusIncident";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "title", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "description", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "severity", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "started_at", kind: "message", T: Timestamp },
        { no: 6, name: "ended_at", kind: "message", T: Timestamp },
        { no: 7, name: "affected_services", kind: "scalar", T: 9 /* ScalarType.STRING */, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new StatusIncident().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new StatusIncident().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new StatusIncident().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(StatusIncident, a, b);
    }
}
/**
 * @generated from message druz9.v1.StatusPage
 */
export class StatusPage extends Message {
    /**
     * operational / degraded / down
     *
     * @generated from field: string overall_status = 1;
     */
    overallStatus = "";
    /**
     * @generated from field: string uptime_90d = 2;
     */
    uptime90d = "";
    /**
     * @generated from field: repeated druz9.v1.StatusServiceState services = 3;
     */
    services = [];
    /**
     * @generated from field: repeated druz9.v1.StatusIncident incidents = 4;
     */
    incidents = [];
    /**
     * @generated from field: google.protobuf.Timestamp generated_at = 5;
     */
    generatedAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.StatusPage";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "overall_status", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "uptime_90d", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "services", kind: "message", T: StatusServiceState, repeated: true },
        { no: 4, name: "incidents", kind: "message", T: StatusIncident, repeated: true },
        { no: 5, name: "generated_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new StatusPage().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new StatusPage().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new StatusPage().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(StatusPage, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetStatusPageRequest
 */
export class GetStatusPageRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetStatusPageRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetStatusPageRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetStatusPageRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetStatusPageRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetStatusPageRequest, a, b);
    }
}
