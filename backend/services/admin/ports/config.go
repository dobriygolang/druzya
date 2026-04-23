package ports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"druz9/admin/app"
	"druz9/admin/domain"
	pb "druz9/shared/generated/pb/druz9/v1"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ─────────────────────────────────────────────────────────────────────────
// Dynamic config
// ─────────────────────────────────────────────────────────────────────────

func (s *AdminServer) ListConfig(
	ctx context.Context,
	_ *connect.Request[pb.ListConfigRequest],
) (*connect.Response[pb.ConfigEntryList], error) {
	if _, err := s.requireAdmin(ctx); err != nil {
		return nil, err
	}
	list, err := s.ListConfigUC.Do(ctx)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	out := &pb.ConfigEntryList{Items: make([]*pb.ConfigEntry, 0, len(list))}
	for _, c := range list {
		out.Items = append(out.Items, toConfigEntryProto(c))
	}
	return connect.NewResponse(out), nil
}

func (s *AdminServer) UpdateConfig(
	ctx context.Context,
	req *connect.Request[pb.UpdateConfigRequest],
) (*connect.Response[pb.ConfigEntry], error) {
	uid, err := s.requireAdmin(ctx)
	if err != nil {
		return nil, err
	}
	m := req.Msg
	if m.GetKey() == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("key required"))
	}
	// Re-serialise the opaque Value into JSON bytes so the app layer can
	// round-trip it against the stored type discriminator (same flow as the
	// apigen-era ConfigEntry_Value union).
	raw, err := valueToJSON(m.GetValue())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("value: %w", err))
	}
	in := app.UpdateConfigInput{
		Key:       m.GetKey(),
		Value:     raw,
		UpdatedBy: &uid,
	}
	out, err := s.UpdateConfigUC.Do(ctx, in)
	if err != nil {
		return nil, s.toConnectErr(err)
	}
	return connect.NewResponse(toConfigEntryProto(out)), nil
}

func toConfigEntryProto(e domain.ConfigEntry) *pb.ConfigEntry {
	out := &pb.ConfigEntry{
		Key:         e.Key,
		Type:        configTypeToProto(e.Type),
		Description: e.Description,
	}
	if !e.UpdatedAt.IsZero() {
		out.UpdatedAt = timestamppb.New(e.UpdatedAt.UTC())
	}
	if e.UpdatedBy != nil {
		out.UpdatedBy = e.UpdatedBy.String()
	}
	// Populate Value from the raw bytes per the type discriminator — same
	// logic as the apigen fillConfigValue helper, but flowing into a
	// structpb.Value instead of the oneOf union.
	if v, err := valueFromConfig(e); err == nil {
		out.Value = v
	}
	return out
}

// ─────────────────────────────────────────────────────────────────────────
// structpb.Value helpers
// ─────────────────────────────────────────────────────────────────────────

// valueToJSON serialises a structpb.Value into the raw JSON bytes the app
// layer expects. nil Value maps to the JSON literal `null`.
func valueToJSON(v *structpb.Value) ([]byte, error) {
	if v == nil {
		return []byte("null"), nil
	}
	b, err := protojson.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshal structpb value: %w", err)
	}
	return b, nil
}

// valueFromConfig builds a structpb.Value from the raw JSON stored on a
// ConfigEntry. The OpenAPI oneOf constraint (number|string|bool|object) is
// preserved by switching on the stored type.
func valueFromConfig(e domain.ConfigEntry) (*structpb.Value, error) {
	if len(e.Value) == 0 {
		return structpb.NewNullValue(), nil
	}
	switch e.Type {
	case domain.ConfigTypeInt:
		n, err := strconv.ParseInt(string(e.Value), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("parse int config value: %w", err)
		}
		return structpb.NewNumberValue(float64(n)), nil
	case domain.ConfigTypeFloat:
		var f float64
		if err := json.Unmarshal(e.Value, &f); err != nil {
			return nil, fmt.Errorf("unmarshal float config value: %w", err)
		}
		return structpb.NewNumberValue(f), nil
	case domain.ConfigTypeString:
		var s string
		if err := json.Unmarshal(e.Value, &s); err != nil {
			return nil, fmt.Errorf("unmarshal string config value: %w", err)
		}
		return structpb.NewStringValue(s), nil
	case domain.ConfigTypeBool:
		var b bool
		if err := json.Unmarshal(e.Value, &b); err != nil {
			return nil, fmt.Errorf("unmarshal bool config value: %w", err)
		}
		return structpb.NewBoolValue(b), nil
	case domain.ConfigTypeJSON:
		var any any
		if err := json.Unmarshal(e.Value, &any); err != nil {
			return nil, fmt.Errorf("unmarshal json config value: %w", err)
		}
		v, err := structpb.NewValue(any)
		if err != nil {
			return nil, fmt.Errorf("build structpb value: %w", err)
		}
		return v, nil
	default:
		// Unknown type — surface the raw bytes via NewValue as a best
		// effort.
		var any any
		if err := json.Unmarshal(e.Value, &any); err == nil {
			v, vErr := structpb.NewValue(any)
			if vErr != nil {
				return nil, fmt.Errorf("build structpb value: %w", vErr)
			}
			return v, nil
		}
		return structpb.NewNullValue(), nil
	}
}
