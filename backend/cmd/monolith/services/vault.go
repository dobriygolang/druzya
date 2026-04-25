// Package services — Phase C-7 Private Vault E2E.
//
// Server's role в E2E: zero-knowledge salt store. Server держит per-user
// random salt (16 bytes), отдаёт его client'у на запрос; client делает
// PBKDF2(password, salt) → AES-256-GCM key и шифрует body_md ИМ.
//
// Server НЕ видит ни password, ни derived key, ни plaintext body для
// encrypted=true заметок. Только ciphertext (в существующем body_md
// поле) + flag encrypted=true.
//
// Endpoints:
//
//	POST /api/v1/vault/init
//	  Создаёт salt если у юзера ещё нет. Idempotent: при повторном вызове
//	  возвращает existing salt без error (это позволяет client'у получить
//	  salt одним и тем же call'ом и при первом setup, и при повторном
//	  login на новом устройстве).
//	  reply: {saltB64: "...", initialized: bool}
//	          initialized=true если salt существовал до этого call'а
//
//	GET /api/v1/vault/salt
//	  reply: {saltB64: "..."} | 404 если vault ещё не initialised
//
// Note: salt не secret в smyslе криптографическом — он лежит в нашей БД
// и в любом дампе. Его роль — защита от rainbow table attacks (без
// salt пароли можно бы атаковать pre-computed hash'ами). Утечка salt'а
// =/= compromise; компрометация требует ещё пароль юзера.
//
// Endpoints НЕ trigger backend'у никаких state changes для existing
// заметок. Encryption mark отдельных notes делается через UpdateNote
// + установку encrypted=true (это отдельный endpoint в Phase C-7.1).
package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	sharedMw "druz9/shared/pkg/middleware"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// vaultSaltBytes — 16 random bytes. Это рекомендуемый минимум для
// PBKDF2 salt (NIST SP 800-132).
const vaultSaltBytes = 16

// NewVault wires the vault module.
func NewVault(d Deps) *Module {
	h := &vaultHandler{pool: d.Pool, log: d.Log}
	return &Module{
		MountREST: func(r chi.Router) {
			r.Post("/vault/init", h.initVault)
			r.Get("/vault/salt", h.getSalt)
			r.Post("/vault/notes/{id}/encrypt", h.encryptNote)
			r.Post("/vault/notes/{id}/decrypt", h.decryptNote)
		},
	}
}

type vaultHandler struct {
	pool *pgxpool.Pool
	log  *slog.Logger
}

type vaultSaltResponse struct {
	SaltB64     string `json:"saltB64"`
	Initialized bool   `json:"initialized"`
}

// initVault — idempotent. Если salt уже set — возвращаем existing.
// Иначе генерим crypto/rand 16 bytes и вставляем под conditional UPDATE
// (race-safe: два параллельных init'а от одного юзера не оба пройдут
// generate-новые-byte; второй upsert просто прочитает existing).
func (h *vaultHandler) initVault(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}

	// Race-safe: WHERE … vault_kdf_salt IS NULL guard. Если уже set,
	// UPDATE rows-affected будет 0, мы тогда reread текущее значение.
	salt, gerr := generateVaultSalt()
	if gerr != nil {
		h.serverError(w, r, "init.gen", gerr, uid)
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		h.serverError(w, r, "init.begin", err, uid)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	cmd, err := tx.Exec(r.Context(),
		`UPDATE users SET vault_kdf_salt = $1
		  WHERE id = $2 AND vault_kdf_salt IS NULL`,
		salt, uid,
	)
	if err != nil {
		h.serverError(w, r, "init.update", err, uid)
		return
	}

	var existing []byte
	wasInitialized := cmd.RowsAffected() == 0
	if wasInitialized {
		// Salt уже был — возвращаем тот.
		if qErr := tx.QueryRow(r.Context(),
			`SELECT vault_kdf_salt FROM users WHERE id = $1`, uid,
		).Scan(&existing); qErr != nil {
			h.serverError(w, r, "init.reread", qErr, uid)
			return
		}
	} else {
		existing = salt
	}

	if err := tx.Commit(r.Context()); err != nil {
		h.serverError(w, r, "init.commit", err, uid)
		return
	}

	writePubJSON(w, http.StatusOK, vaultSaltResponse{
		SaltB64:     base64.StdEncoding.EncodeToString(existing),
		Initialized: wasInitialized,
	})
}

// getSalt отдаёт уже existing salt. 404 если vault не initialised.
func (h *vaultHandler) getSalt(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	var salt []byte
	err := h.pool.QueryRow(r.Context(),
		`SELECT vault_kdf_salt FROM users WHERE id = $1`, uid,
	).Scan(&salt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writePubJSONError(w, http.StatusNotFound, "user_not_found", "")
			return
		}
		h.serverError(w, r, "salt.query", err, uid)
		return
	}
	if salt == nil {
		writePubJSONError(w, http.StatusNotFound, "vault_not_initialized", "")
		return
	}
	writePubJSON(w, http.StatusOK, vaultSaltResponse{
		SaltB64:     base64.StdEncoding.EncodeToString(salt),
		Initialized: true,
	})
}

// ─── Encrypt/decrypt note flag ────────────────────────────────────────────
//
// Encrypt: client уже зашифровал body локально (AES-256-GCM, IV+ciphertext
// в base64) — server атомарно заменяет body_md на ciphertext, поднимает
// encrypted=true, обнуляет embeddings и tombstone'ит публикацию (если
// была — encrypted note не может быть public).
//
// Decrypt: client уже расшифровал и отдаёт plaintext body_md — server
// заменяет, ставит encrypted=false. Embed worker re-queue'ится через
// existing UpdateNote path (decrypt — это просто UpdateNote с одной
// дополнительной флагой; чтобы не плодить два write-path'а, делаем
// encrypt/decrypt отдельным вызовом который только обновляет метаданные
// поверх body, не trigger'я Connect-RPC).

type encryptNoteRequest struct {
	// CiphertextB64 — base64(IV || ciphertext). Client сам формирует.
	CiphertextB64 string `json:"ciphertextB64"`
}

type decryptNoteRequest struct {
	BodyMD string `json:"bodyMd"`
}

func (h *vaultHandler) encryptNote(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}

	var body encryptNoteRequest
	if derr := readJSON(r, &body); derr != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_body", derr.Error())
		return
	}
	if body.CiphertextB64 == "" {
		writePubJSONError(w, http.StatusBadRequest, "empty_ciphertext", "")
		return
	}
	if _, derr := base64.StdEncoding.DecodeString(body.CiphertextB64); derr != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_ciphertext_b64", "")
		return
	}

	// Atomic: replace body, mark encrypted, wipe embedding, force-unpublish.
	// Все 4 stages в одной TX: если encrypted=true но publication остаётся
	// → public страница утечёт plaintext (старый body_md). Опасно.
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		h.serverError(w, r, "encrypt.begin", err, uid)
		return
	}
	defer func() { _ = tx.Rollback(r.Context()) }()

	cmd, err := tx.Exec(r.Context(),
		`UPDATE hone_notes
		    SET body_md       = $3,
		        size_bytes    = LENGTH($3),
		        encrypted     = TRUE,
		        embedding     = NULL,
		        embedding_model = NULL,
		        embedded_at   = NULL,
		        public_slug   = NULL,
		        published_at  = NULL,
		        updated_at    = now()
		  WHERE id = $1 AND user_id = $2`,
		noteID, uid, body.CiphertextB64,
	)
	if err != nil {
		h.serverError(w, r, "encrypt.update", err, uid)
		return
	}
	if cmd.RowsAffected() == 0 {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		h.serverError(w, r, "encrypt.commit", err, uid)
		return
	}
	writePubJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *vaultHandler) decryptNote(w http.ResponseWriter, r *http.Request) {
	uid, ok := sharedMw.UserIDFromContext(r.Context())
	if !ok {
		writePubJSONError(w, http.StatusUnauthorized, "unauthenticated", "")
		return
	}
	noteID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_id", "")
		return
	}
	var body decryptNoteRequest
	if derr := readJSON(r, &body); derr != nil {
		writePubJSONError(w, http.StatusBadRequest, "bad_body", derr.Error())
		return
	}
	cmd, err := h.pool.Exec(r.Context(),
		`UPDATE hone_notes
		    SET body_md   = $3,
		        size_bytes = LENGTH($3),
		        encrypted = FALSE,
		        updated_at = now()
		  WHERE id = $1 AND user_id = $2`,
		noteID, uid, body.BodyMD,
	)
	if err != nil {
		h.serverError(w, r, "decrypt.update", err, uid)
		return
	}
	if cmd.RowsAffected() == 0 {
		writePubJSONError(w, http.StatusNotFound, "not_found", "")
		return
	}
	// Embedding re-queue: client может дёрнуть UpdateNote вторым вызовом
	// чтобы trigger'нуть EmbedFn — этот endpoint только flips флаг, не
	// поддерживает Connect-RPC contract / EmbedFn injection. Side-effect
	// правильнее держать в одном пайплайне.
	writePubJSON(w, http.StatusOK, map[string]bool{"ok": true})
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

func generateVaultSalt() ([]byte, error) {
	b := make([]byte, vaultSaltBytes)
	if _, err := rand.Read(b); err != nil {
		return nil, fmt.Errorf("vault.generateSalt: %w", err)
	}
	return b, nil
}

func (h *vaultHandler) serverError(w http.ResponseWriter, r *http.Request, where string, err error, uid uuid.UUID) {
	if errors.Is(err, context.Canceled) {
		return
	}
	h.log.ErrorContext(r.Context(), "vault",
		slog.String("where", where),
		slog.String("user_id", uid.String()),
		slog.Any("err", err))
	writePubJSONError(w, http.StatusInternalServerError, "internal", "")
}
