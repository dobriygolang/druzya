// Package services — Phase C-7 Private Vault E2E.
package hone

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	monolithServices "druz9/cmd/monolith/services"
	honeApp "druz9/hone/app"
	honeDomain "druz9/hone/domain"
	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type vaultSaltResponse struct {
	SaltB64     string `json:"saltB64"`
	Initialized bool   `json:"initialized"`
}

type encryptNoteRequest struct {
	// CiphertextB64 — base64(IV || ciphertext). Client сам формирует.
	CiphertextB64 string `json:"ciphertextB64"`
}

type decryptNoteRequest struct {
	BodyMD string `json:"bodyMd"`
}

// VaultDeps — что нужно handler'у. Заполняется в bootstrap'е.
type VaultDeps struct {
	Init    *honeApp.VaultInit
	GetSalt *honeApp.VaultGetSalt
	Encrypt *honeApp.VaultEncryptNote
	Decrypt *honeApp.VaultDecryptNote
	Log     *slog.Logger
}

// NewVault wires the vault module.
func NewVault(deps VaultDeps) *monolithServices.Module {
	h := &vaultHandler{
		init:    deps.Init,
		getSalt: deps.GetSalt,
		encrypt: deps.Encrypt,
		decrypt: deps.Decrypt,
		log:     deps.Log,
	}
	return &monolithServices.Module{
		MountREST: func(r chi.Router) {
			r.Post("/vault/init", h.initVaultHTTP)
			r.Get("/vault/salt", h.getSaltHTTP)
			r.Post("/vault/notes/{id}/encrypt", h.encryptNoteHTTP)
			r.Post("/vault/notes/{id}/decrypt", h.decryptNoteHTTP)
		},
	}
}

type vaultHandler struct {
	init    *honeApp.VaultInit
	getSalt *honeApp.VaultGetSalt
	encrypt *honeApp.VaultEncryptNote
	decrypt *honeApp.VaultDecryptNote
	log     *slog.Logger
}

// initVault — idempotent. Если salt уже set — возвращаем existing. Иначе
// генерим crypto/rand 16 bytes (через use-case, race-safe upsert).
func (h *vaultHandler) initVaultHTTP(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	out, err := h.init.Do(r.Context(), honeApp.VaultInitInput{UserID: uid})
	if err != nil {
		h.serverError(w, r, "init", err, uid)
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, vaultSaltResponse{
		SaltB64:     out.SaltB64,
		Initialized: out.Initialized,
	})
}

// getSalt отдаёт уже existing salt. 404 если vault не initialised.
func (h *vaultHandler) getSaltHTTP(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	out, err := h.getSalt.Do(r.Context(), honeApp.VaultGetSaltInput{UserID: uid})
	if err != nil {
		switch {
		case errors.Is(err, honeDomain.ErrNotFound):
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "user_not_found", "")
		case errors.Is(err, honeApp.ErrVaultNotInitialized):
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "vault_not_initialized", "")
		default:
			h.serverError(w, r, "salt.query", err, uid)
		}
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, vaultSaltResponse{
		SaltB64:     out.SaltB64,
		Initialized: true,
	})
}

// ─── Encrypt/decrypt note flag ────────────────────────────────────────────

func (h *vaultHandler) encryptNoteHTTP(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}

	var body encryptNoteRequest
	if derr := readJSON(r, &body); derr != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_body", derr.Error())
		return
	}

	err = h.encrypt.Do(r.Context(), honeApp.VaultEncryptNoteInput{
		UserID:         uid,
		NoteID:         noteID,
		CiphertextB64:  body.CiphertextB64,
		OriginDeviceID: sharedMw.DeviceIDFromContext(r.Context()),
	})
	if err != nil {
		switch {
		case errors.Is(err, honeApp.ErrVaultEmptyCiphertext):
			monolithServices.WritePubJSONError(w, http.StatusBadRequest, "empty_ciphertext", "")
		case errors.Is(err, honeApp.ErrVaultBadCiphertext):
			monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_ciphertext_b64", "")
		case errors.Is(err, honeDomain.ErrNotFound):
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
		default:
			h.serverError(w, r, "encrypt", err, uid)
		}
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *vaultHandler) decryptNoteHTTP(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		monolithServices.WritePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	var body decryptNoteRequest
	if derr := readJSON(r, &body); derr != nil {
		monolithServices.WritePubJSONError(w, http.StatusBadRequest, "bad_body", derr.Error())
		return
	}
	err = h.decrypt.Do(r.Context(), honeApp.VaultDecryptNoteInput{
		UserID:         uid,
		NoteID:         noteID,
		BodyMD:         body.BodyMD,
		OriginDeviceID: sharedMw.DeviceIDFromContext(r.Context()),
	})
	if err != nil {
		if errors.Is(err, honeDomain.ErrNotFound) {
			monolithServices.WritePubJSONError(w, http.StatusNotFound, "not_found", "")
			return
		}
		h.serverError(w, r, "decrypt", err, uid)
		return
	}
	monolithServices.WritePubJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// readJSON — minimal helper, чтобы не дублировать json.NewDecoder в каждом
// handler'е.
func readJSON(r *http.Request, dst any) error {
	if r.Body == nil {
		return errors.New("empty body")
	}
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
}

func (h *vaultHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "vault",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	monolithServices.WritePubJSONError(w, http.StatusInternalServerError, "internal", "")
}
