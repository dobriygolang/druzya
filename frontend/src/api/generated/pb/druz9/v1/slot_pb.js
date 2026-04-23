// slot.proto — Connect-RPC contract for the `slot` (Human Mock Interview)
// bounded context.
//
// Covers the four slot endpoints: list, create, book, cancel. Only
// interviewers/admins may create slots — the role check lives in the port
// layer (same pattern as Phase A/B).
import { Message, proto3, Timestamp } from "@bufbuild/protobuf";
import { Difficulty, Section, SlotStatus } from "./common_pb.js";
/**
 * SlotInterviewer is the inline `interviewer` object of OpenAPI Slot.
 *
 * @generated from message druz9.v1.SlotInterviewer
 */
export class SlotInterviewer extends Message {
    /**
     * @generated from field: string user_id = 1;
     */
    userId = "";
    /**
     * @generated from field: string username = 2;
     */
    username = "";
    /**
     * avg_rating / reviews_count are optional — absent until at least one
     * review exists for the interviewer.
     *
     * @generated from field: float avg_rating = 3;
     */
    avgRating = 0;
    /**
     * @generated from field: int32 reviews_count = 4;
     */
    reviewsCount = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SlotInterviewer";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "user_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "username", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 3, name: "avg_rating", kind: "scalar", T: 2 /* ScalarType.FLOAT */ },
        { no: 4, name: "reviews_count", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new SlotInterviewer().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SlotInterviewer().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SlotInterviewer().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SlotInterviewer, a, b);
    }
}
/**
 * Slot mirrors OpenAPI Slot.
 *
 * @generated from message druz9.v1.Slot
 */
export class Slot extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: druz9.v1.SlotInterviewer interviewer = 2;
     */
    interviewer;
    /**
     * @generated from field: google.protobuf.Timestamp starts_at = 3;
     */
    startsAt;
    /**
     * @generated from field: int32 duration_min = 4;
     */
    durationMin = 0;
    /**
     * @generated from field: druz9.v1.Section section = 5;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 6;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * language mirrors OpenAPI Slot.language ("ru" | "en"). Kept as string —
     * not the Language enum (that one is code languages: go/python/…).
     *
     * @generated from field: string language = 7;
     */
    language = "";
    /**
     * @generated from field: int32 price_rub = 8;
     */
    priceRub = 0;
    /**
     * @generated from field: druz9.v1.SlotStatus status = 9;
     */
    status = SlotStatus.UNSPECIFIED;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Slot";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "interviewer", kind: "message", T: SlotInterviewer },
        { no: 3, name: "starts_at", kind: "message", T: Timestamp },
        { no: 4, name: "duration_min", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 5, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 6, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 7, name: "language", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 8, name: "price_rub", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 9, name: "status", kind: "enum", T: proto3.getEnumType(SlotStatus) },
    ]);
    static fromBinary(bytes, options) {
        return new Slot().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Slot().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Slot().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Slot, a, b);
    }
}
/**
 * SlotList is the vanguard-friendly wrapper — OpenAPI returns a JSON array
 * at the top level, and vanguard flattens repeated-only wrappers on the
 * REST wire.
 *
 * @generated from message druz9.v1.SlotList
 */
export class SlotList extends Message {
    /**
     * @generated from field: repeated druz9.v1.Slot items = 1;
     */
    items = [];
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.SlotList";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "items", kind: "message", T: Slot, repeated: true },
    ]);
    static fromBinary(bytes, options) {
        return new SlotList().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new SlotList().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new SlotList().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(SlotList, a, b);
    }
}
/**
 * Booking mirrors OpenAPI Booking.
 *
 * @generated from message druz9.v1.Booking
 */
export class Booking extends Message {
    /**
     * @generated from field: string id = 1;
     */
    id = "";
    /**
     * @generated from field: druz9.v1.Slot slot = 2;
     */
    slot;
    /**
     * @generated from field: string meet_url = 3;
     */
    meetUrl = "";
    /**
     * @generated from field: google.protobuf.Timestamp created_at = 4;
     */
    createdAt;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.Booking";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 2, name: "slot", kind: "message", T: Slot },
        { no: 3, name: "meet_url", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 4, name: "created_at", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new Booking().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new Booking().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new Booking().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(Booking, a, b);
    }
}
/**
 * ListSlotsRequest mirrors the OpenAPI query filters on GET /slot.
 *
 * @generated from message druz9.v1.ListSlotsRequest
 */
export class ListSlotsRequest extends Message {
    /**
     * @generated from field: druz9.v1.Section section = 1;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 2;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * @generated from field: google.protobuf.Timestamp from = 3;
     */
    from;
    /**
     * @generated from field: google.protobuf.Timestamp to = 4;
     */
    to;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.ListSlotsRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 2, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 3, name: "from", kind: "message", T: Timestamp },
        { no: 4, name: "to", kind: "message", T: Timestamp },
    ]);
    static fromBinary(bytes, options) {
        return new ListSlotsRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new ListSlotsRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new ListSlotsRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(ListSlotsRequest, a, b);
    }
}
/**
 * CreateSlotRequest mirrors OpenAPI CreateSlotRequest.
 *
 * @generated from message druz9.v1.CreateSlotRequest
 */
export class CreateSlotRequest extends Message {
    /**
     * @generated from field: google.protobuf.Timestamp starts_at = 1;
     */
    startsAt;
    /**
     * @generated from field: int32 duration_min = 2;
     */
    durationMin = 0;
    /**
     * @generated from field: druz9.v1.Section section = 3;
     */
    section = Section.UNSPECIFIED;
    /**
     * @generated from field: druz9.v1.Difficulty difficulty = 4;
     */
    difficulty = Difficulty.UNSPECIFIED;
    /**
     * language is "ru" | "en" per OpenAPI enum. Preserved as string.
     *
     * @generated from field: string language = 5;
     */
    language = "";
    /**
     * @generated from field: int32 price_rub = 6;
     */
    priceRub = 0;
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CreateSlotRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "starts_at", kind: "message", T: Timestamp },
        { no: 2, name: "duration_min", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
        { no: 3, name: "section", kind: "enum", T: proto3.getEnumType(Section) },
        { no: 4, name: "difficulty", kind: "enum", T: proto3.getEnumType(Difficulty) },
        { no: 5, name: "language", kind: "scalar", T: 9 /* ScalarType.STRING */ },
        { no: 6, name: "price_rub", kind: "scalar", T: 5 /* ScalarType.INT32 */ },
    ]);
    static fromBinary(bytes, options) {
        return new CreateSlotRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CreateSlotRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CreateSlotRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CreateSlotRequest, a, b);
    }
}
/**
 * BookSlotRequest wraps the path param.
 *
 * @generated from message druz9.v1.BookSlotRequest
 */
export class BookSlotRequest extends Message {
    /**
     * @generated from field: string slot_id = 1;
     */
    slotId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.BookSlotRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "slot_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new BookSlotRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new BookSlotRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new BookSlotRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(BookSlotRequest, a, b);
    }
}
/**
 * CancelSlotRequest wraps the path param.
 *
 * @generated from message druz9.v1.CancelSlotRequest
 */
export class CancelSlotRequest extends Message {
    /**
     * @generated from field: string slot_id = 1;
     */
    slotId = "";
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CancelSlotRequest";
    static fields = proto3.util.newFieldList(() => [
        { no: 1, name: "slot_id", kind: "scalar", T: 9 /* ScalarType.STRING */ },
    ]);
    static fromBinary(bytes, options) {
        return new CancelSlotRequest().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CancelSlotRequest().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CancelSlotRequest().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CancelSlotRequest, a, b);
    }
}
/**
 * CancelSlotResponse is empty — REST returns 204 No Content.
 *
 * @generated from message druz9.v1.CancelSlotResponse
 */
export class CancelSlotResponse extends Message {
    constructor(data) {
        super();
        proto3.util.initPartial(data, this);
    }
    static runtime = proto3;
    static typeName = "druz9.v1.CancelSlotResponse";
    static fields = proto3.util.newFieldList(() => []);
    static fromBinary(bytes, options) {
        return new CancelSlotResponse().fromBinary(bytes, options);
    }
    static fromJson(jsonValue, options) {
        return new CancelSlotResponse().fromJson(jsonValue, options);
    }
    static fromJsonString(jsonString, options) {
        return new CancelSlotResponse().fromJsonString(jsonString, options);
    }
    static equals(a, b) {
        return proto3.util.equals(CancelSlotResponse, a, b);
    }
}
