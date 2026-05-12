# Judge0 with Python ML libraries

Custom Judge0 1.13.1 image with `numpy / pandas / scikit-learn / torch /
transformers` preinstalled — used by the ML coding stage of AI-mock
(`stage_kind = ml_coding`, см. backend/services/mock_interview/domain/enum.go).

## Why a custom image

Stock `judge0/judge0:1.13.1` only ships CPython runtimes without any third-
party packages. `import numpy` raises `ModuleNotFoundError`, so the ML
mock tasks can't run. Three options were considered:

1. **Per-task `pip install`** — submit `pip install numpy && python user.py`
   as the source. Slow (~30s cold start), and isolate's sandboxing blocks
   network access in production configs. Rejected.
2. **Judge0 Extra Languages** — Judge0's "Extra CE" image. Adds JS/PHP/etc.,
   но не Python ML stack. Rejected.
3. **Custom Docker image (chosen)** — extend the stock image with `pip
   install`. Pre-baked, cold-start identical to stock, drop-in replacement.

The image is **~2.5GB** (torch CPU wheel + transformers + sklearn).
Acceptable for self-hosted Judge0; if you target Judge0 cloud (no extension
point) you'll need to vendor the ML libs into each task's source — out of
scope for this build.

## Build

From the repo root:

```bash
docker build \
  -f infra/judge0/Dockerfile.ml-python \
  -t druz9/judge0-ml:1.13.1 \
  .
```

The build smoke-tests every critical import before publishing the image —
a broken `pip install` fails the build, not the runtime.

## Push (optional, for prod registry)

```bash
docker tag druz9/judge0-ml:1.13.1 ghcr.io/<org>/druz9-judge0-ml:1.13.1
docker push ghcr.io/<org>/druz9-judge0-ml:1.13.1
```

On the production VM (`deploy.sh` already auths to the registry via the
existing CI flow), set `JUDGE0_IMAGE=ghcr.io/<org>/druz9-judge0-ml:1.13.1`
in `.env` and `docker compose up -d judge0-server judge0-workers` —
docker pulls the new image and recreates the containers in-place.

## Local activation

```bash
# 1. Build the image (one-time, ~10-15 min cold)
docker build -f infra/judge0/Dockerfile.ml-python -t druz9/judge0-ml:1.13.1 .

# 2. Restart Judge0 with the ML image + bumped memory limit
JUDGE0_IMAGE=druz9/judge0-ml:1.13.1 \
JUDGE0_MEMORY_LIMIT=3G \
  docker compose up -d judge0-server judge0-workers

# 3. Smoke test from the host
curl -sS http://localhost:2358/submissions?base64_encoded=false&wait=true \
  -H "Content-Type: application/json" \
  -d '{"language_id":71,"source_code":"import numpy as np; print(np.array([1,2,3]).sum())"}'
# Expect: {"stdout":"6\n", ...}
```

## Image size budget

Approx breakdown of the 2.5GB image:

| Layer                            | Size  |
|----------------------------------|-------|
| Base `judge0/judge0:1.13.1`      | 800MB |
| build-essential + lapack         | 250MB |
| numpy/scipy/pandas/sklearn       | 350MB |
| xgboost + lightgbm + matplotlib  | 150MB |
| torch (CPU) + torchvision        | 900MB |
| transformers + tokenizers + ST   | 200MB |
| Stripped build deps              | (-250MB) |
| **Total**                        | ~2.5GB |

If 2.5GB is unacceptable (e.g. budget VM with slow registry pulls), drop
`torch + torchvision + transformers + sentence-transformers + datasets` —
the image collapses back to ~1.3GB but you lose 5 of the 20 ML tasks
(everything tagged `deep_learning` / `pytorch`).

## Verification of seeded tasks

After applying migration `00110_ml_mock_tasks.sql` (which inserts the
20+ ML tasks into `mock_tasks` with `stage_kind='ml_coding'`), open the
admin Company Manager and add a stage of kind `ml_coding` to any
company's pipeline. Start a mock — the orchestrator picks one of the
seeded tasks; the editor mounts with Python; submitting triggers the
custom Judge0 image which imports `numpy` / `sklearn` / etc.

If the sandbox is the STOCK image (no ML libs), the user's `import`
fails. The orchestrator detects this (`ErrSandboxUnavailable` or non-
zero exit), and the hybrid grader falls back to the LLM rubric alone
(см. orchestrator.go SubmitAnswer hybrid blend). Users see «Sandbox
недоступен — оценка по rubric'у».

## TODO

- `docker build` not run as part of this commit — image must be built
  manually on the operator's machine (or via a one-off CI job). The
  Dockerfile is otherwise self-contained.
- No image-rebuild trigger in `Makefile` yet — when the seeded tasks
  evolve to need a new lib, edit the Dockerfile + rebuild manually.
