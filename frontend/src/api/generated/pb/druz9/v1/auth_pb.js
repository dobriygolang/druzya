// auth.proto — Connect-RPC contract for the `auth` bounded context.
//
// Three of the four RPCs are PUBLIC (yandex/telegram/refresh) — they issue
// tokens. Logout is authenticated. See main.go for the gate wiring: the REST
// public paths remain carved out of the requireAuth middleware; the native
// Connect path is also mounted without requireAuth because the auth service
// never reads user_id from context (it mints tokens instead).
import { Message, proto3, protoInt64 } from "@bufbuild/protobuf";
import { AuthProvider, UserRole } from "./common_pb.js";
/**
 * YandexLoginRequest mirrors the OpenAPI YandexAuthRequest schema.
 *
 * @generated from message druz9.v1.YandexLoginRequest
 */
export class YandexLoginRequest extends Message {
    /**
     * @generated from field: string code = 1;
     */
    code = "";
    /**
     * state is optional in OpenAPI (nullable); proto3 treats "" as unset.
     *
     * @generated from field: string state = 2;
     */
    state = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.YandexLoginRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "code", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "state", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new YandexLoginRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new YandexLoginRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new YandexLoginRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(YandexLoginRequest, a, b);
    }
}
/**
 * TelegramLoginRequest mirrors the OpenAPI TelegramAuthRequest schema.
 *
 * @generated from message druz9.v1.TelegramLoginRequest
 */
export class TelegramLoginRequest extends Message {
    /**
     * @generated from field: int64 id = 1;
     */
    id = protoInt64.zero;
    /**
     * @generated from field: string first_name = 2;
     */
    firstName = "";
    /**
     * @generated from field: string last_name = 3;
     */
    lastName = "";
    /**
     * @generated from field: string username = 4;
     */
    username = "";
    /**
     * @generated from field: string photo_url = 5;
     */
    photoUrl = "";
    /**
     * @generated from field: int64 auth_date = 6;
     */
    authDate = protoInt64.zero;
    /**
     * @generated from field: string hash = 7;
     */
    hash = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.TelegramLoginRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 2, name: "first_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "last_name", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 5, name: "photo_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "auth_date", kind: "scalar", T: 3 /* ScalarType.INT64 */ },
        { no: 7, name: "hash", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new TelegramLoginRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new TelegramLoginRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new TelegramLoginRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(TelegramLoginRequest, a, b);
    }
}
/**
 * RefreshRequest is empty — the refresh token lives in an HttpOnly cookie.
 *
 * @generated from message druz9.v1.RefreshRequest
 */
export class RefreshRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.RefreshRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new RefreshRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new RefreshRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new RefreshRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(RefreshRequest, a, b);
    }
}
/**
 * LogoutRequest is empty — the session id comes from the refresh cookie.
 *
 * @generated from message druz9.v1.LogoutRequest
 */
export class LogoutRequest extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.LogoutRequest";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new LogoutRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new LogoutRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new LogoutRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(LogoutRequest, a, b);
    }
}
/**
 * LogoutResponse is empty — 204 No Content equivalent.
 *
 * @generated from message druz9.v1.LogoutResponse
 */
export class LogoutResponse extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.LogoutResponse";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new LogoutResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new LogoutResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new LogoutResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(LogoutResponse, a, b);
    }
}
/**
 * AuthUser mirrors the OpenAPI AuthUser schema.
 *
 * @generated from message druz9.v1.AuthUser
 */
export class AuthUser extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: string email = 2;
     */
    email = "";
    /**
     * @generated from field: string username = 3;
     */
    username = "";
    /**
     * @generated from field: druz9.v1.UserRole role = 4;
     */
    role = UserRole.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.AuthProvider provider = 5;
     */
    provider = AuthProvider.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AuthUser";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "email", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "role", kind: "enum", T: proto3.getEnumType(UserRole) },
        { no: 5, name: "provider", kind: "enum", T: proto3.getEnumType(AuthProvider) },
    ]);
    static fromBinary(bytes, options) {
        return new AuthUser().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AuthUser().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AuthUser().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AuthUser, a, b);
    }
}
/**
 * AuthResponse is the shared shape returned by the three login RPCs. The
 * refresh token is set on an HttpOnly cookie by the server, NOT included here.
 *
 * @generated from message druz9.v1.AuthResponse
 */
export class AuthResponse extends Message {
    /**
     * @generated from field: string access_token = 1;
     */
    accessToken = "";
    /**
     * @generated from field: int32 expires_in = 2;
     */
    expiresIn = 0;
    /**
     * @generated from field: druz9.v1.AuthUser user = 3;
     */
    user;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.AuthResponse";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "access_token", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "expires_in", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "user", kind: "message", T: AuthUser },
    ]);
    static fromBinary(bytes, options) {
        return new AuthResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new AuthResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new AuthResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(AuthResponse, a, b);
    }
}
