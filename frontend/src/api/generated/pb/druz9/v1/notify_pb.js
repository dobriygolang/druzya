// notify.proto — Connect-RPC contract for the `notify` bounded context.
//
// Covers the two user-facing preference endpoints. The Telegram bot webhook
// at /api/v1/notify/telegram/webhook is NOT modelled here — it's a raw
// chi-registered handler that verifies its own X-Telegram-Bot-Api-Secret-Token
// header and stays outside Connect.
import { Message, proto3 } from "@bufbuild/protobuf";
import { NotificationChannel } from "./common_pb.js";
/**
 * QuietHours mirrors the optional OpenAPI `quiet_hours` object — both fields
 * are "HH:MM" strings. When both are empty the server treats quiet hours as
 * disabled. (proto3 lacks nullable wrappers; clients that need tri-state can
 * check for an empty message via presence on the parent.)
 *
 * @generated from message druz9.v1.QuietHours
 */
export class QuietHours extends Message {
    /**
     * "HH:MM"
     *
     * @generated from field: string from = 1;
     */
    from = "";
    /**
     * "HH:MM"
     *
     * @generated from field: string to = 2;
     */
    to = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.QuietHours";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "from", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "to", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new QuietHours().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new QuietHours().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new QuietHours().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(QuietHours, a, b);
    }
}
/**
 * NotificationPreferences mirrors the OpenAPI NotificationPreferences schema.
 *
 * @generated from message druz9.v1.NotificationPreferences
 */
export class NotificationPreferences extends Message {
    /**
     * @generated from field: repeated druz9.v1.NotificationChannel channels = 1;
     */
    channels = [];
    /**
     * @generated from field: string telegram_chat_id = 2;
     */
    telegramChatId = "";
    /**
     * quiet_hours is optional in OpenAPI; proto3 message presence distinguishes
     * "set but empty" from "unset" at the wire level for typed Connect clients.
     *
     * @generated from field: druz9.v1.QuietHours quiet_hours = 3;
     */
    quietHours;
    /**
     * @generated from field: bool weekly_report_enabled = 4;
     */
    weeklyReportEnabled = false;
    /**
     * @generated from field: bool skill_decay_warnings_enabled = 5;
     */
    skillDecayWarningsEnabled = false;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.NotificationPreferences";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "channels", kind: "enum", T: proto3.getEnumType(NotificationChannel), repeated: true },
        { no: 2, name: "telegram_chat_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "quiet_hours", kind: "message", T: QuietHours },
        { no: 4, name: "weekly_report_enabled", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
        { no: 5, name: "skill_decay_warnings_enabled", kind: "scalar", T: 8 /* ScalarType.BOOL */ },
    ]);
    static fromBinary(bytes, options) {
        return new NotificationPreferences().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new NotificationPreferences().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new NotificationPreferences().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(NotificationPreferences, a, b);
    }
}
/**
 * @generated from message druz9.v1.GetNotifyPreferencesRequest
 */
export class GetNotifyPreferencesRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.GetNotifyPreferencesRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new GetNotifyPreferencesRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new GetNotifyPreferencesRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new GetNotifyPreferencesRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(GetNotifyPreferencesRequest, a, b);
    }
}
/**
 * @generated from message druz9.v1.UpdateNotifyPreferencesRequest
 */
export class UpdateNotifyPreferencesRequest extends Message {
    /**
     * @generated from field: druz9.v1.NotificationPreferences preferences = 1;
     */
    preferences;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.UpdateNotifyPreferencesRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "preferences", kind: "message", T: NotificationPreferences },
    ]);
    static fromBinary(bytes, options) {
        return new UpdateNotifyPreferencesRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new UpdateNotifyPreferencesRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new UpdateNotifyPreferencesRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(UpdateNotifyPreferencesRequest, a, b);
    }
}
