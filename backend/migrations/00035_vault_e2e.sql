-- +goose Up
-- +goose StatementBegin
--
-- Phase C-7: Private Vault — opt-in E2E encryption для notes.
--
-- Threat model:
--   - Цель: server (или его БД-дамп) не может прочитать encrypted note
--     body. Server видит только ciphertext + IV. Без user password
--     ciphertext не decryptable.
--   - Не цель: hide metadata. title, sizes, timestamps, public_slug
--     остаются plaintext (нужны для list/search/quota; их шифровать =
--     ломать UX без proportional security gain).
--
-- Crypto choice (см. docs/sync-architecture.md §4):
--   - Key derivation: PBKDF2-SHA256, 200000 iterations, 32-byte key.
--     Argon2id был бы предпочтительнее (memory-hard), но в браузере
--     стандартного API нет — пришлось бы тащить argon2-browser (~200KB
--     wasm). PBKDF2 в browser SubtleCrypto работает out-of-the-box.
--   - Cipher: AES-256-GCM с 12-byte IV (NIST recommended). GCM даёт
--     authenticated encryption — server не может tamper'ить ciphertext.
--
-- Лoss-of-data risk: если юзер забыл vault password, encrypted notes
-- безвозвратно потеряны. Мы об этом честно предупреждаем в Settings UI
-- ("there is no recovery"). Не храним пароль server-side в любой
-- форме — это compromise threat model.
--
-- Migration существующих заметок: НЕТ batch'а. Юзер сам помечает
-- индивидуальные заметки как encrypted через UI; в момент пометки
-- client encrypt'ит body_md и server заменяет plaintext на ciphertext
-- через UpdateNote (server не знает о шифровании, видит просто новый
-- bytes-blob в поле body_md, но дополнительный flag encrypted=true
-- говорит embedding worker'у / RAG / publish их пропускать).

ALTER TABLE users
    -- Salt для PBKDF2. Random 16 bytes. NULL = vault не initialised
    -- для этого юзера. Set'нется при первом вызове POST /vault/init.
    -- НЕ rotated после init: смена salt = все existing encrypted notes
    -- становятся unrecoverable. Если юзер сменит password, мы всё
    -- равно derive'аем тот же key через тот же salt + new password —
    -- но decrypt с old password не сработает; user должен сам
    -- decrypt-and-reencrypt каждую заметку при смене password (это
    -- известное UX свойство любой E2E системы).
    ADD COLUMN IF NOT EXISTS vault_kdf_salt BYTEA;

ALTER TABLE hone_notes
    -- encrypted=true → body_md содержит base64(IV || ciphertext) вместо
    -- plaintext markdown. Server-side LLM features (embedding, RAG,
    -- publish-to-web) ДОЛЖНЫ check'ать этот flag и пропускать encrypted
    -- заметки — иначе мы перенесём plaintext в embeddings БД (которая
    -- не encrypted), что ломает E2E guarantee.
    ADD COLUMN IF NOT EXISTS encrypted BOOLEAN NOT NULL DEFAULT FALSE;

-- Wipe embeddings для заметок которые юзер уже помечает encrypted.
-- Phase trigger вместо bulk UPDATE: когда client вызывает UpdateNote с
-- новым encrypted=true, app-layer запишет дополнительно
-- SetEmbedding(NULL) для этой строки. Этой колонкой мы только
-- помечаем feature flag. Existing notes не трогаем.

-- Partial index для быстрого filter'а в worker'ах: «which notes are
-- still embeddable». Worker'ы читают `WHERE embedded_at IS NULL AND
-- NOT encrypted`. Без partial index'а — seq-scan на всём корпусе.
CREATE INDEX IF NOT EXISTS idx_hone_notes_pending_embedding_active
    ON hone_notes (created_at)
    WHERE embedded_at IS NULL AND NOT encrypted;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_hone_notes_pending_embedding_active;
ALTER TABLE hone_notes DROP COLUMN IF EXISTS encrypted;
ALTER TABLE users DROP COLUMN IF EXISTS vault_kdf_salt;
-- +goose StatementEnd
