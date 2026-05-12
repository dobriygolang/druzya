-- 00110_ml_mock_tasks.sql — Phase K M4 (2026-05-12) ML coding task seed.
--
-- Seeds 20 mock_tasks with stage_kind='ml_coding' for the ML engineering
-- track. Spans the five categories from docs/feature/identity.md ML pillar:
--   1. From-scratch implementations (5)   — gradient descent / softmax /
--      attention / k-means / stratified split.
--   2. scikit-learn pipeline (5)          — classifier / regression /
--      clustering / cross-val / preprocessing.
--   3. PyTorch / deep learning (5)        — MNIST / dataloader / fine-tune
--      ResNet / seq2seq toy / LoRA.
--   4. ML system design / hybrid (3)      — batch inference / online learning
--      / A/B framework.
--   5. Data manipulation (2)              — pandas cleaning / time-series.
--
-- Wire details:
--   • stage_kind = 'ml_coding' — see domain/enum.go StageMLCoding.
--   • language = 'python' — only sandbox path; custom Judge0 image
--     (infra/judge0/Dockerfile.ml-python) provides numpy/sklearn/torch.
--   • reference_criteria — JSONB array of {must_mention, nice_to_have,
--     common_pitfalls} fed to the LLM judge (see pass2MLCodeReviewSystemPrompt
--     in app/judge.go).
--   • body_md — task statement shown to the candidate.
--   • sample_io_md — visible test case used as starter-code example;
--     extra cases go into mock_task_test_cases (some hidden).
--   • time_limit_min — per docs/feature/identity.md ML pillar:
--       from-scratch / DL training: 40-60 min;
--       pipeline / hybrid: 25-45 min;
--       data manipulation: 20-30 min.
--
-- Test cases:
--   For from-scratch tasks (gradient descent step, softmax) — Judge0 exact-
--   match unit tests work fine; we seed 3-4 cases per task.
--   For pipeline / training tasks — exact-match is impossible (model
--   variance), so we seed 1 «smoke» case that just verifies the script
--   produces *some* output of the expected shape. The LLM rubric carries
--   the real signal; orchestrator's hybrid blend (60% sandbox + 40% LLM —
--   см. SubmitAnswer in orchestrator.go) keeps both signals alive.
--
-- All inserts are idempotent via the `title` filter — re-running this
-- migration after a partial apply won't double-insert. We use a CTE +
-- INSERT … SELECT pattern instead of plain VALUES because we need to
-- resolve the ai_strictness_profiles.id FK at insert time.

-- +goose Up
-- +goose StatementBegin

WITH std AS (
    SELECT id FROM ai_strictness_profiles WHERE slug = 'standard' LIMIT 1
)
INSERT INTO mock_tasks (
    stage_kind, language, difficulty, title, body_md, sample_io_md,
    reference_criteria, reference_solution_md, time_limit_min,
    ai_strictness_profile_id
)
SELECT
    'ml_coding', 'python', v.difficulty, v.title, v.body_md, v.sample_io_md,
    v.reference_criteria::jsonb, v.reference_solution_md, v.time_limit_min,
    std.id
FROM std, (VALUES

    -- ─── Category 1: From-scratch implementations ───────────────────────

    (2::SMALLINT, 'Gradient descent with momentum',
     E'Реализуй один шаг градиентного спуска с momentum для квадратичной функции f(x) = x^T A x + b^T x. Получи на stdin вектор x, матрицу A (строчно), вектор b, скаляры lr (learning rate) и beta (momentum coefficient), и предыдущий momentum-buffer v. Выведи новые x и v.\n\n**Сигнатура:**\n```python\ndef step(x: np.ndarray, A: np.ndarray, b: np.ndarray, lr: float, beta: float, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:\n    """\n    grad = 2 * A @ x + b\n    v_new = beta * v + grad\n    x_new = x - lr * v_new\n    return x_new, v_new\n    """\n```\n\nВывод: одна строка с x_new (через пробел), затем одна строка с v_new.',
     E'Input:\nx: 1.0 1.0\nA: 2.0 0.0 / 0.0 1.0\nb: 0.0 0.0\nlr: 0.1\nbeta: 0.9\nv: 0.0 0.0\n\nOutput:\nx_new: 0.6 0.8\nv_new: 4.0 2.0',
     '{"must_mention": ["use numpy operations not python loops", "correct gradient formula 2Ax+b", "update v before x", "no in-place mutation of inputs"], "nice_to_have": ["type hints", "dtype=float64"], "common_pitfalls": ["forgetting the factor of 2 in gradient", "updating x before v", "using python for-loop for the matrix multiply"]}',
     E'grad = 2 * A @ x + b\nv_new = beta * v + grad\nx_new = x - lr * v_new',
     35),

    (3::SMALLINT, 'Softmax cross-entropy loss',
     E'Реализуй numerically-stable softmax cross-entropy loss. На stdin: матрица логитов logits shape (N, K) и вектор integer labels y shape (N,). Выведи среднюю cross-entropy loss.\n\n**Numerical stability:** вычитай row-wise max перед exp, иначе на больших логитах получишь inf.\n\n**Сигнатура:**\n```python\ndef softmax_ce(logits: np.ndarray, y: np.ndarray) -> float:\n    """Return scalar mean cross-entropy."""\n```',
     E'Input:\nlogits: [[2.0, 1.0, 0.1], [0.5, 2.5, 0.3]]\ny: [0, 1]\n\nOutput: ~0.4170',
     '{"must_mention": ["subtract row-max before exp for numerical stability", "use np.log-sum-exp or equivalent", "vectorise — no python loop over rows", "return mean not sum"], "nice_to_have": ["assert logits.shape[0] == y.shape[0]"], "common_pitfalls": ["computing log(exp(logits).sum()) directly causes overflow", "indexing logits[y] vs logits[np.arange(N), y]", "returning sum instead of mean"]}',
     E'max_logits = logits.max(axis=1, keepdims=True)\nshifted = logits - max_logits\nlog_sum_exp = np.log(np.exp(shifted).sum(axis=1))\nlog_probs = shifted[np.arange(len(y)), y] - log_sum_exp\nreturn -log_probs.mean()',
     30),

    (4::SMALLINT, 'Scaled dot-product attention',
     E'Реализуй scaled dot-product attention из «Attention Is All You Need» без mask. На stdin: queries Q shape (N, d_k), keys K shape (M, d_k), values V shape (M, d_v). Выведи output shape (N, d_v).\n\n**Формула:**\n```\nattn = softmax(Q K^T / sqrt(d_k))\nout = attn @ V\n```\n\nUse numpy. NO torch.',
     E'Input:\nQ: [[1.0, 0.0], [0.0, 1.0]]\nK: [[1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]\nV: [[1.0], [2.0], [3.0]]\n\nOutput shape: (2, 1) — два числа',
     '{"must_mention": ["divide by sqrt(d_k) BEFORE softmax", "use the numerically-stable softmax (row-max subtraction)", "matrix multiply not element-wise"], "nice_to_have": ["use einsum для понятности", "type hints"], "common_pitfalls": ["sqrt применяется ПОСЛЕ softmax — неверно", "забыли transpose K", "row-wise softmax вместо column-wise"]}',
     E'd_k = Q.shape[-1]\nscores = Q @ K.T / np.sqrt(d_k)\nmax_s = scores.max(axis=-1, keepdims=True)\nexp_s = np.exp(scores - max_s)\nattn = exp_s / exp_s.sum(axis=-1, keepdims=True)\nreturn attn @ V',
     45),

    (3::SMALLINT, 'K-means clustering from scratch',
     E'Реализуй k-means с k-means++ инициализацией. На stdin: матрица данных X shape (N, d), число кластеров k, число итераций max_iter. Выведи: финальные центроиды и массив assignments shape (N,).\n\n**Алгоритм:**\n1. K-means++ init: первый центроид случайно, остальные — пропорционально squared distance.\n2. Repeat max_iter раз: assign каждой точке ближайший центроид; пересчитать центроиды как mean.\n3. Stop early если assignments не меняются.\n\n**NUMPY ONLY** (sklearn нельзя).',
     E'Input:\nX: 6 точек, разделимые на 2 кластера\nk: 2\nmax_iter: 10\n\nOutput: 2 центроида + 6 assignments в {0,1}',
     '{"must_mention": ["k-means++ initialization (not random uniform)", "vectorised distance computation (np.linalg.norm with axis)", "early stop when assignments are stable", "no python loops over N data points"], "nice_to_have": ["set numpy random seed", "handle empty cluster (re-init to far point)"], "common_pitfalls": ["random uniform init causes poor convergence", "computing distances in a python loop (slow)", "no convergence check (always runs max_iter)"]}',
     E'# kpp init\nfirst_idx = rng.integers(N)\ncentroids = [X[first_idx]]\nfor _ in range(k - 1):\n    d2 = np.min([np.sum((X - c)**2, axis=1) for c in centroids], axis=0)\n    p = d2 / d2.sum()\n    centroids.append(X[rng.choice(N, p=p)])\ncentroids = np.array(centroids)\n# Lloyd iterations\nfor _ in range(max_iter):\n    dists = np.linalg.norm(X[:, None] - centroids[None, :], axis=2)\n    new_assign = dists.argmin(axis=1)\n    if prev_assign is not None and np.all(new_assign == prev_assign):\n        break\n    prev_assign = new_assign\n    for j in range(k):\n        if (new_assign == j).any():\n            centroids[j] = X[new_assign == j].mean(axis=0)',
     45),

    (2::SMALLINT, 'Stratified train/test split',
     E'Реализуй train/test split с stratification по class label, без sklearn. На stdin: матрица X shape (N, d), labels y shape (N,), test_size float ∈ (0, 1), random_state int. Выведи индексы train и test (по одному в каждой строке).\n\n**Stratification:** в test попадает ровно floor(class_count * test_size) образцов каждого класса.\n\n**NUMPY ONLY.**',
     E'Input:\nX: 10 образцов\ny: [0]*5 + [1]*5\ntest_size: 0.4\nrandom_state: 42\n\nOutput:\ntrain: 6 индексов (3 нулей + 3 единиц)\ntest: 4 индекса (2 нуля + 2 единицы)',
     '{"must_mention": ["preserve class proportions in test split", "use random_state seed for reproducibility", "shuffle within each class before split"], "nice_to_have": ["handle floats vs ints in test_size", "return sorted indices"], "common_pitfalls": ["uniform random split breaks stratification", "rng без seed → каждый раз разные splits", "забыли shuffle внутри класса (всегда первые N)"]}',
     E'rng = np.random.default_rng(random_state)\ntrain_idx, test_idx = [], []\nfor c in np.unique(y):\n    cls_idx = np.where(y == c)[0]\n    rng.shuffle(cls_idx)\n    cut = int(len(cls_idx) * test_size)\n    test_idx.extend(cls_idx[:cut])\n    train_idx.extend(cls_idx[cut:])\nreturn sorted(train_idx), sorted(test_idx)',
     25),

    -- ─── Category 2: scikit-learn pipeline ──────────────────────────────

    (3::SMALLINT, 'Titanic-style classifier with sklearn',
     E'Дан синтетический Titanic-датасет: numerical features (age, fare), categorical (sex, class) и target survived. Построй sklearn Pipeline: preprocessing → классификатор. Выведи accuracy на test split (test_size=0.2, random_state=42).\n\n**Требования:**\n- Один `Pipeline` объект (не отдельные шаги).\n- `ColumnTransformer` для разных типов фичей.\n- `StandardScaler` для numerical, `OneHotEncoder` для categorical.\n- Logistic Regression классификатор.\n\n**Скрипт получает csv путь как arg, печатает accuracy.**',
     E'Output: accuracy=0.78 (точное число варьируется ±0.02)',
     '{"must_mention": ["sklearn Pipeline (single object, not chained transforms)", "ColumnTransformer split for num/cat features", "fit only on train, transform on test (no leakage)", "random_state=42 for reproducibility"], "nice_to_have": ["handle missing values with SimpleImputer", "cross_val_score for robust accuracy"], "common_pitfalls": ["fit_transform on test data (target leakage via mean/std)", "OneHotEncode handle_unknown=\"error\" — падает на test если категория новая", "manual transforms вместо ColumnTransformer (трудно сериализовать модель)"]}',
     E'num_features = [\"age\", \"fare\"]\ncat_features = [\"sex\", \"class\"]\npre = ColumnTransformer([\n    (\"num\", StandardScaler(), num_features),\n    (\"cat\", OneHotEncoder(handle_unknown=\"ignore\"), cat_features),\n])\npipe = Pipeline([(\"pre\", pre), (\"clf\", LogisticRegression(random_state=42))])\npipe.fit(X_train, y_train)\nacc = pipe.score(X_test, y_test)\nprint(f\"accuracy={acc:.4f}\")',
     35),

    (3::SMALLINT, 'Regression with feature engineering',
     E'Дан синтетический regression dataset: price ~ size + bedrooms + age + neighborhood. Построй Pipeline:\n1. PolynomialFeatures(degree=2) для interactions.\n2. StandardScaler.\n3. Ridge regression (alpha tuned via GridSearchCV: 0.1 / 1.0 / 10.0).\n\nОтчитайся: best alpha, R² на test, RMSE.',
     E'Output:\nbest_alpha=1.0\nR^2=0.87\nRMSE=15243.21',
     '{"must_mention": ["GridSearchCV on Pipeline (not on raw model — tunes preprocessing too)", "use train data only for cross-val", "report metric on held-out test, not cv-best", "include_bias=False on PolynomialFeatures to avoid duplicate with StandardScaler"], "nice_to_have": ["cv=5 or higher", "scoring=\"neg_root_mean_squared_error\""], "common_pitfalls": ["fit GridSearchCV on full data (leakage)", "manually iterating over alpha (no cross-val)", "включили bias и в poly и в Ridge — singular matrix"]}',
     E'pipe = Pipeline([\n    (\"poly\", PolynomialFeatures(degree=2, include_bias=False)),\n    (\"scaler\", StandardScaler()),\n    (\"ridge\", Ridge()),\n])\ngs = GridSearchCV(pipe, {\"ridge__alpha\": [0.1, 1.0, 10.0]}, scoring=\"r2\", cv=5)\ngs.fit(X_train, y_train)\npred = gs.predict(X_test)',
     40),

    (3::SMALLINT, 'Clustering pipeline + silhouette evaluation',
     E'Дан unlabelled dataset shape (N, d). Найди оптимальное k для KMeans, перебрав k ∈ [2..8]. Метрика — silhouette score. Также пробуй DBSCAN (eps=0.5) и сравни.\n\n**Pipeline:** StandardScaler → KMeans / DBSCAN.\n\nВыведи: best k для KMeans, silhouette score, число кластеров DBSCAN (исключая noise), его silhouette.',
     E'Output:\nKMeans best_k=3 silhouette=0.42\nDBSCAN clusters=3 noise=12 silhouette=0.38',
     '{"must_mention": ["scale features BEFORE clustering (kmeans sensitive to scale)", "silhouette_score expects labels — exclude DBSCAN noise=-1", "use n_init>=10 для KMeans иначе local optima"], "nice_to_have": ["plot silhouette per k", "tune DBSCAN eps via k-distance graph"], "common_pitfalls": ["KMeans без StandardScaler — фичи с большим scale доминируют", "silhouette с включенным noise label DBSCAN-а — distorted", "n_init=1 (default starting from sklearn 1.4)"]}',
     E'best = (0, -1)\nfor k in range(2, 9):\n    pipe = Pipeline([(\"s\", StandardScaler()), (\"km\", KMeans(n_clusters=k, n_init=10, random_state=42))])\n    labels = pipe.fit_predict(X)\n    s = silhouette_score(pipe.named_steps[\"s\"].transform(X), labels)\n    if s > best[1]: best = (k, s)',
     35),

    (4::SMALLINT, 'Cross-validation + hyperparameter tuning',
     E'Дан имбалансный classification dataset (90% negative, 10% positive). Натренируй RandomForest с tuning над n_estimators / max_depth / class_weight. Метрика — F1 на minority class (positive).\n\n**Требования:**\n- StratifiedKFold(n_splits=5) — обычный KFold даст плохие folds.\n- GridSearchCV с scoring="f1_macro" не достаточно — нужен f1 именно для positive класса.\n- Final eval на held-out test (random_state=42, stratified).\n\nВыведи: best params, F1 на test.',
     E'Output:\nbest_params={"n_estimators": 200, "max_depth": 10, "class_weight": "balanced"}\nF1_positive=0.71',
     '{"must_mention": ["StratifiedKFold (not KFold) для imbalanced data", "make_scorer(f1_score, pos_label=1) или scoring=\"f1\"", "class_weight=\"balanced\" в grid (или manual)", "use train data only for CV; test holds out"], "nice_to_have": ["GridSearchCV(refit=True) для готовой модели", "n_jobs=-1 для параллелизма"], "common_pitfalls": ["KFold вместо Stratified — minority class может отсутствовать в fold", "scoring=\"accuracy\" — даст 90% даже от dummy", "scoring=\"f1_macro\" не различит positive от negative класса"]}',
     E'from sklearn.metrics import f1_score, make_scorer\nscorer = make_scorer(f1_score, pos_label=1)\ngs = GridSearchCV(\n    RandomForestClassifier(random_state=42),\n    {\"n_estimators\": [100, 200], \"max_depth\": [5, 10, None], \"class_weight\": [None, \"balanced\"]},\n    scoring=scorer, cv=StratifiedKFold(5, shuffle=True, random_state=42),\n    n_jobs=-1)\ngs.fit(X_train, y_train)',
     45),

    (3::SMALLINT, 'Pipeline with custom transformer',
     E'Реализуй custom sklearn Transformer (наследник BaseEstimator + TransformerMixin), который для каждой numerical column вычисляет log1p(x), но только если skewness > 1.0 (иначе оставляет как есть). Заверни в Pipeline вместе с StandardScaler и LinearRegression.\n\n**Требования:**\n- `fit(X)` — вычислить skewness на каждой column.\n- `transform(X)` — применить log1p только к skewed columns.\n- Должно работать через `pipe.fit(X, y)` и `pipe.predict(X)`.\n- НИКАКОГО modify внутри transform (X должен быть copy).',
     E'Output: R² на test ≈ 0.65',
     '{"must_mention": ["BaseEstimator + TransformerMixin inheritance", "fit returns self", "transform returns a copy, not mutate input", "store skewness in fit, apply in transform"], "nice_to_have": ["get_feature_names_out для sklearn 1.0+", "handle non-positive values (log1p safe but mention)"], "common_pitfalls": ["modify X in-place — Pipeline передаёт refs, ломает train/test", "compute skewness в transform → train/test mismatch", "забыли return self в fit"]}',
     E'class SkewLog(BaseEstimator, TransformerMixin):\n    def __init__(self, threshold=1.0):\n        self.threshold = threshold\n    def fit(self, X, y=None):\n        from scipy.stats import skew\n        self.skewed_ = np.abs(skew(X, axis=0)) > self.threshold\n        return self\n    def transform(self, X):\n        Xc = X.copy()\n        Xc[:, self.skewed_] = np.log1p(Xc[:, self.skewed_])\n        return Xc',
     40),

    -- ─── Category 3: PyTorch / deep learning ────────────────────────────

    (3::SMALLINT, 'Train MNIST classifier',
     E'Натренируй простой MLP (3 fully-connected layers с ReLU) на MNIST из torchvision. Цель: test accuracy ≥ 95% за ≤ 3 эпохи.\n\n**Требования:**\n- Adam optimizer, lr=1e-3.\n- CrossEntropyLoss.\n- Batch size 64.\n- Eval после каждой эпохи; print accuracy.\n- torch.manual_seed(42).\n\nВыведи финальную test accuracy.',
     E'Output: epoch=1 acc=0.96 / epoch=2 acc=0.97 / epoch=3 acc=0.98',
     '{"must_mention": ["torch.manual_seed for reproducibility", "model.train()/model.eval() switches", "optimizer.zero_grad() before backward", "with torch.no_grad() in eval loop"], "nice_to_have": ["DataLoader num_workers > 0", "ReLU between FC layers"], "common_pitfalls": ["забыли eval() — dropout/BN активны на test", "забыли zero_grad → грады аккумулируются", "torch.no_grad() в train loop — нет градов вообще", "softmax перед CrossEntropyLoss (двойной)"]}',
     E'class MLP(nn.Module):\n    def __init__(self):\n        super().__init__()\n        self.net = nn.Sequential(\n            nn.Flatten(), nn.Linear(28*28, 256), nn.ReLU(),\n            nn.Linear(256, 64), nn.ReLU(), nn.Linear(64, 10))\n    def forward(self, x): return self.net(x)\nmodel = MLP()\nopt = torch.optim.Adam(model.parameters(), lr=1e-3)\nloss_fn = nn.CrossEntropyLoss()\nfor epoch in range(3):\n    model.train()\n    for x, y in train_loader:\n        opt.zero_grad(); loss = loss_fn(model(x), y); loss.backward(); opt.step()\n    model.eval()\n    with torch.no_grad():\n        correct = sum((model(x).argmax(1) == y).sum().item() for x, y in test_loader)',
     50),

    (3::SMALLINT, 'Custom Dataset + DataLoader',
     E'Напиши custom `torch.utils.data.Dataset` который читает CSV (path как arg), возвращает (features tensor, label tensor) для каждой строки. Затем заверни в DataLoader с batch_size=32, shuffle=True. Сделай один проход и выведи: число батчей, shape первого батча features, shape первого батча labels.\n\n**Требования:**\n- `__len__` и `__getitem__`.\n- Numerical features → float32, label → long (для CE loss).\n- Read CSV один раз в `__init__`, НЕ на каждом `__getitem__`.',
     E'Output:\nnum_batches=32\nfeatures_shape=torch.Size([32, 4])\nlabels_shape=torch.Size([32])',
     '{"must_mention": ["read once in __init__ (not per __getitem__)", "dtype float32 for features, long for labels", "__len__ returns len of the dataset", "store as torch.tensor not pandas DataFrame"], "nice_to_have": ["use pd.read_csv для batch I/O", "handle missing/NaN values"], "common_pitfalls": ["читать CSV в __getitem__ — 1000x slowdown", "float64 для feat → torch warnings + memory", "label как float — RuntimeError из CE loss"]}',
     E'class CSVDataset(Dataset):\n    def __init__(self, path):\n        df = pd.read_csv(path)\n        self.X = torch.tensor(df.iloc[:, :-1].values, dtype=torch.float32)\n        self.y = torch.tensor(df.iloc[:, -1].values, dtype=torch.long)\n    def __len__(self): return len(self.y)\n    def __getitem__(self, i): return self.X[i], self.y[i]',
     30),

    (4::SMALLINT, 'Fine-tune pretrained ResNet',
     E'Загрузи torchvision resnet18 с pretrained=True. Замени final FC layer под 10 классов. Заморозь все веса КРОМЕ final layer и последнего residual block (layer4). Натренируй на toy CIFAR-style датасете (синтетический, 100 образцов).\n\n**Требования:**\n- `requires_grad = False` для backbone, True для head + layer4.\n- SGD lr=1e-3 momentum=0.9.\n- Adjust input normalization (ImageNet mean/std).',
     E'Output: loss декрементирует за 5 эпох',
     '{"must_mention": ["replace fc layer with new nn.Linear matching num_classes", "set requires_grad=False then True selectively", "filter optimizer params to trainable only", "ImageNet normalize (mean=[0.485,0.456,0.406] std=[0.229,0.224,0.225])"], "nice_to_have": ["scheduler.StepLR", "train/val split"], "common_pitfalls": ["передать ВСЕ model.parameters() в optimizer — обновятся frozen веса", "забыли normalize — pretrained ожидает ImageNet range", "не replaced fc — старые 1000 классов, loss NaN"]}',
     E'model = torchvision.models.resnet18(weights=\"DEFAULT\")\nfor p in model.parameters(): p.requires_grad = False\nfor p in model.layer4.parameters(): p.requires_grad = True\nmodel.fc = nn.Linear(model.fc.in_features, 10)\nopt = torch.optim.SGD(filter(lambda p: p.requires_grad, model.parameters()), lr=1e-3, momentum=0.9)',
     50),

    (4::SMALLINT, 'Sequence-to-sequence toy translator',
     E'Реализуй toy seq2seq encoder-decoder для синтетического task: входная последовательность из 5 случайных целых в [0,9], output — та же последовательность reversed. Encoder и decoder — обычные nn.LSTM, hidden_size=32.\n\n**Требования:**\n- Embedding layer для tokens.\n- Encoder возвращает (h, c) hidden state.\n- Decoder использует <SOS> и <EOS> tokens.\n- Teacher forcing с ratio=0.5 во время train.\n- Адекватный output после 200 итераций (loss < 1.0).',
     E'Output: trained model can reverse [1,2,3,4,5] → [5,4,3,2,1]',
     '{"must_mention": ["pad/SOS/EOS special tokens — отдельный vocab id", "teacher forcing only during training, NOT eval", "ignore padding в loss (ignore_index=PAD_ID in CE)", "decoder unrolls one step at a time"], "nice_to_have": ["attention layer", "beam search в eval"], "common_pitfalls": ["teacher forcing 100% — модель не учится autoregressive", "pad влияет на loss → ignore_index", "забыли .detach() hidden state между batches → backprop through everything"]}',
     E'class Encoder(nn.Module):\n    def __init__(self, vocab, emb, hid):\n        super().__init__()\n        self.emb = nn.Embedding(vocab, emb)\n        self.lstm = nn.LSTM(emb, hid, batch_first=True)\n    def forward(self, x): return self.lstm(self.emb(x))[1]\n# Decoder symmetric',
     55),

    (4::SMALLINT, 'LoRA adapter implementation',
     E'Реализуй LoRA (Low-Rank Adaptation) adapter для torch.nn.Linear. Класс `LoRALinear(nn.Module)` обёртывает frozen base Linear и добавляет low-rank update.\n\n**Math:**\n```\noutput = base(x) + alpha/r * (x @ A @ B)\n```\ngde A: (in_features, r), B: (r, out_features), оба trainable. Base — frozen.\n\n**Требования:**\n- A инициализируется Kaiming uniform, B — zeros (так старт identical с base).\n- Constructor принимает base: nn.Linear, r: int, alpha: float.\n- base.requires_grad_(False) внутри.\n- Только A и B регистрируются как parameters.',
     E'Output: forward(x) идентичен base.forward(x) при init (B=0)',
     '{"must_mention": ["init B as zeros so initial output = base output", "freeze base layer parameters", "alpha/r scaling factor", "A initialized non-zero (Kaiming or normal)"], "nice_to_have": ["dropout between A and B", "merge weights at inference"], "common_pitfalls": ["init both A and B non-zero — drastic output shift", "забыли base.requires_grad_(False) — backprop через base", "transpose ошибка — A @ B даёт wrong shape"]}',
     E'class LoRALinear(nn.Module):\n    def __init__(self, base: nn.Linear, r: int, alpha: float):\n        super().__init__()\n        self.base = base\n        self.base.requires_grad_(False)\n        self.A = nn.Parameter(torch.empty(base.in_features, r))\n        self.B = nn.Parameter(torch.zeros(r, base.out_features))\n        nn.init.kaiming_uniform_(self.A, a=5**0.5)\n        self.scale = alpha / r\n    def forward(self, x): return self.base(x) + self.scale * (x @ self.A @ self.B)',
     55),

    -- ─── Category 4: ML system design / hybrid ──────────────────────────

    (4::SMALLINT, 'Batch inference pipeline',
     E'Построй batch inference pipeline: читает CSV с 100k rows → препроцессит → проходит pickled model → пишет predictions в новый CSV. Должен tolerate чем то батчем поломаться без crash всего job.\n\n**Требования:**\n- Read CSV in chunks (pd.read_csv с chunksize=10000).\n- Каждый chunk → preprocessor (loaded from joblib).\n- Каждый chunk → model.predict_proba.\n- Append к output CSV (НЕ load все в memory).\n- Логирование: rows processed / errors.\n- При exception на chunk — log, skip, продолжай.',
     E'Output: 100k predictions in output.csv. Если 1 chunk упал — 90k predictions + 1 error в log.',
     '{"must_mention": ["pd.read_csv с chunksize — не in-memory всё сразу", "try/except per chunk, не на весь файл", "append mode CSV (mode=\"a\", header=False after first chunk)", "joblib.load для preprocessor + model"], "nice_to_have": ["parallel chunks via concurrent.futures", "progress bar (tqdm)"], "common_pitfalls": ["pd.read_csv без chunksize → OOM на 100k rows", "try/except на весь скрипт — один bad row кладёт всё", "header=True на каждом chunk → multiple headers в output"]}',
     E'preproc = joblib.load(\"preproc.pkl\")\nmodel = joblib.load(\"model.pkl\")\nout_path = \"predictions.csv\"\nfirst = True\nfor chunk in pd.read_csv(\"input.csv\", chunksize=10000):\n    try:\n        X = preproc.transform(chunk[features])\n        preds = model.predict_proba(X)\n        df = pd.DataFrame(preds, columns=model.classes_)\n        df.to_csv(out_path, mode=\"a\", index=False, header=first)\n        first = False\n    except Exception as e:\n        logging.exception(\"chunk failed: %s\", e)',
     50),

    (5::SMALLINT, 'Online learning system (toy)',
     E'Реализуй toy online learning loop: SGDClassifier с partial_fit, обновляющийся на каждом mini-batch streamed data. Стрим симулируется через generator который yield-ит (X_batch, y_batch).\n\n**Требования:**\n- partial_fit с явно переданным classes= при первом вызове.\n- Каждый batch — measure accuracy ДО fit (т.е. на новой data, prequential evaluation).\n- Window mean accuracy за последние 10 батчей (показатель concept drift).\n- Stop когда rolling accuracy упадёт ниже 0.5 (drift detected).',
     E'Output: batches=15 rolling_acc=0.67 (no drift detected) OR drift detected at batch 8',
     '{"must_mention": ["partial_fit с classes= для первого вызова", "predict ПЕРЕД fit (prequential)", "rolling window — collections.deque(maxlen=10)", "early stop на drift signal"], "nice_to_have": ["save model state to disk периодически", "log per-class precision/recall"], "common_pitfalls": ["fit() вместо partial_fit() — забыл predicted prior data", "predict ПОСЛЕ fit — train на той же data, accuracy переоценена", "classes= не передан → AttributeError при первом partial_fit"]}',
     E'clf = SGDClassifier(loss=\"log_loss\")\nwindow = collections.deque(maxlen=10)\nfirst = True\nfor X_batch, y_batch in stream:\n    if not first:\n        acc = (clf.predict(X_batch) == y_batch).mean()\n        window.append(acc)\n    if first:\n        clf.partial_fit(X_batch, y_batch, classes=np.unique(y_batch)); first = False\n    else:\n        clf.partial_fit(X_batch, y_batch)\n    if len(window) == 10 and np.mean(window) < 0.5: break',
     50),

    (5::SMALLINT, 'A/B test framework for ML models',
     E'Реализуй простой A/B framework: дано два модели (model_a, model_b), incoming requests (X). Каждый request раутится detеrministically через hash(user_id) % 100 < split_pct → A, else → B. Записывай decision (model, prediction, latency_ms) в jsonl. После 1000 requests — compute mean latency per model, Welch-t test на predictions distribution.\n\n**Требования:**\n- Deterministic routing (одинаковый user_id → одна и та же model).\n- Per-request latency measurement (time.perf_counter).\n- scipy.stats.ttest_ind для prediction distributions.\n- Output: split actual %, mean latency A/B, p-value.',
     E'Output:\nA: 503 requests, latency=12.4ms\nB: 497 requests, latency=18.1ms\nt-test p-value=0.034 (significant difference)',
     '{"must_mention": ["hash(user_id) for deterministic routing — НЕ random.random()", "time.perf_counter() not time.time() для latency", "scipy.stats.ttest_ind с equal_var=False (Welch — не assumes equal variance)", "jsonl per-line logging not single-blob"], "nice_to_have": ["Bonferroni correction если multiple comparisons", "log model version + timestamp"], "common_pitfalls": ["random.random() для routing — same user в разные модели", "time.time() resolution = ms — недостаточно для precise latency", "scipy.stats.ttest_ind по умолчанию equal_var=True"]}',
     E'def route(user_id, split):\n    return \"A\" if hash(user_id) % 100 < split else \"B\"\nfor req in requests:\n    bucket = route(req.user_id, 50)\n    model = model_a if bucket == \"A\" else model_b\n    t0 = time.perf_counter()\n    pred = model.predict(req.X)\n    dt = (time.perf_counter() - t0) * 1000\n    log.write(json.dumps({\"bucket\": bucket, \"pred\": pred, \"latency_ms\": dt}) + \"\\n\")',
     55),

    -- ─── Category 5: Data manipulation ──────────────────────────────────

    (2::SMALLINT, 'Clean messy CSV with pandas',
     E'Дан CSV с проблемами: leading/trailing whitespace в строках, mixed-case categorical column (\"Male\"/\"male\"/\" MALE\"), NaN как разные literal strings (\"N/A\", \"-\", \"\"), date column как разные форматы. Нормализуй и выведи clean dataset с .info().\n\n**Требования:**\n- Strip whitespace, lowercase string columns.\n- Unify NaN literals to actual NaN.\n- Parse dates (mixed formats — pd.to_datetime errors=\"coerce\").\n- Drop rows где date или target = NaN.\n- Преобразуй numeric column из object → float (бывают строки с \",\" instead of \".\").',
     E'Input: 100 rows messy CSV\nOutput: 87 clean rows, 5 columns: 1 date, 2 string, 2 float',
     '{"must_mention": ["str.strip() and str.lower() chained", "pd.to_datetime(errors=\"coerce\") для mixed формата", "replace na_values list of literals (or pd.read_csv na_values=)", "drop only on critical columns, не drop everything"], "nice_to_have": ["pd.read_csv(parse_dates=, na_values=) сразу при загрузке", "category dtype для repeating strings"], "common_pitfalls": [".lower() на float column → AttributeError", "dropna() без subset — теряем 80% rows из-за non-critical NaN", "to_numeric без errors=\"coerce\" → ValueError на bad row"]}',
     E'df = pd.read_csv(\"messy.csv\", na_values=[\"N/A\", \"-\", \"\"])\nstr_cols = df.select_dtypes(include=\"object\").columns\nfor c in str_cols:\n    df[c] = df[c].str.strip().str.lower()\ndf[\"date\"] = pd.to_datetime(df[\"date\"], errors=\"coerce\")\ndf[\"amount\"] = pd.to_numeric(df[\"amount\"].astype(str).str.replace(\",\", \".\"), errors=\"coerce\")\ndf = df.dropna(subset=[\"date\", \"target\"])',
     25),

    (3::SMALLINT, 'Time-series rolling stats',
     E'Дан DataFrame с timestamp + sensor_value (1Hz, ~10000 rows). Compute:\n1. 30-second rolling mean / std (rolling window time-based).\n2. Detect anomalies: |value - mean| > 3 * std → flag.\n3. Resample down to 1-minute, agg max value per minute.\n4. Forward-fill gaps до 5 seconds, drop longer.\n\nВыведи число anomalies + первые 5 rows resampled.',
     E'Output:\nanomalies=42\nresampled head:\n  timestamp  sensor_value_max\n  ...',
     '{"must_mention": ["set timestamp as index (df.set_index)", "rolling с time-based window: rolling(\"30s\")", "resample(\"1min\").max() not just groupby", "ffill с limit= для bounded fill"], "nice_to_have": ["pd.date_range для check gaps", "vectorised anomaly detection (no loop)"], "common_pitfalls": ["rolling(30) — это 30 строк, not 30 секунд", "забыли sort_index() перед rolling — broken results", "ffill() без limit — fills огромные gaps"]}',
     E'df = df.set_index(\"timestamp\").sort_index()\nroll = df[\"sensor_value\"].rolling(\"30s\")\nmean, std = roll.mean(), roll.std()\ndf[\"is_anomaly\"] = (df[\"sensor_value\"] - mean).abs() > 3 * std\nresampled = df[\"sensor_value\"].resample(\"1min\").max()\nfilled = df[\"sensor_value\"].ffill(limit=5)',
     30)

) AS v(difficulty, title, body_md, sample_io_md, reference_criteria, reference_solution_md, time_limit_min)
WHERE NOT EXISTS (SELECT 1 FROM mock_tasks WHERE title = v.title AND stage_kind = 'ml_coding');

-- ── mock_task_test_cases for the deterministic from-scratch tasks ──
--
-- Only the from-scratch ML tasks (category 1) have exact-match test cases —
-- pipeline / training / data-manipulation tasks have non-deterministic
-- output (model accuracy varies, plot rendering, etc.) and rely on the
-- LLM rubric + (optional) "smoke" cases. Tests below check that the math
-- is correct on a tiny input that's reproducible across numpy versions.
--
-- Input shape per case: the candidate's script reads stdin (numbers
-- space-separated, one section per line). We don't pin format — Judge0
-- just compares stripped stdout to `expected_output`.

WITH gd AS (SELECT id FROM mock_tasks WHERE title = 'Gradient descent with momentum' AND stage_kind = 'ml_coding' LIMIT 1)
INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT gd.id, v.input, v.expected_output, v.is_hidden, v.ordinal
FROM gd, (VALUES
    (E'1.0 1.0\n2.0 0.0\n0.0 1.0\n0.0 0.0\n0.1\n0.9\n0.0 0.0',
     E'0.6 0.8\n4.0 2.0', FALSE, 1),
    (E'0.0 0.0\n1.0 0.0\n0.0 1.0\n2.0 3.0\n0.05\n0.9\n0.0 0.0',
     E'-0.1 -0.15\n2.0 3.0', FALSE, 2),
    (E'1.0 1.0\n2.0 0.0\n0.0 1.0\n0.0 0.0\n0.1\n0.9\n1.0 1.0',
     E'0.51 0.71\n4.9 2.9', TRUE, 3)
) AS v(input, expected_output, is_hidden, ordinal)
WHERE NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases tc WHERE tc.task_id = gd.id AND tc.ordinal = v.ordinal
);

WITH sm AS (SELECT id FROM mock_tasks WHERE title = 'Softmax cross-entropy loss' AND stage_kind = 'ml_coding' LIMIT 1)
INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT sm.id, v.input, v.expected_output, v.is_hidden, v.ordinal
FROM sm, (VALUES
    (E'2.0 1.0 0.1\n0.5 2.5 0.3\n0 1', E'0.4170', FALSE, 1),
    (E'10.0 0.0\n0.0 10.0\n0 1',       E'0.0000', FALSE, 2),
    (E'0.0 0.0\n0.0 0.0\n0 1',         E'0.6931', TRUE, 3)
) AS v(input, expected_output, is_hidden, ordinal)
WHERE NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases tc WHERE tc.task_id = sm.id AND tc.ordinal = v.ordinal
);

WITH at AS (SELECT id FROM mock_tasks WHERE title = 'Scaled dot-product attention' AND stage_kind = 'ml_coding' LIMIT 1)
INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT at.id, v.input, v.expected_output, v.is_hidden, v.ordinal
FROM at, (VALUES
    (E'1.0 0.0\n0.0 1.0\n1.0 0.0\n0.0 1.0\n1.0 1.0\n1.0\n2.0\n3.0', E'1.9223\n2.3415', FALSE, 1),
    (E'0.0 0.0\n0.0 0.0\n0.0 0.0\n5.0\n3.0',                       E'4.0',           TRUE, 2)
) AS v(input, expected_output, is_hidden, ordinal)
WHERE NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases tc WHERE tc.task_id = at.id AND tc.ordinal = v.ordinal
);

WITH ts AS (SELECT id FROM mock_tasks WHERE title = 'Stratified train/test split' AND stage_kind = 'ml_coding' LIMIT 1)
INSERT INTO mock_task_test_cases (task_id, input, expected_output, is_hidden, ordinal)
SELECT ts.id, v.input, v.expected_output, v.is_hidden, v.ordinal
FROM ts, (VALUES
    -- 10 samples: y=[0,0,0,0,0,1,1,1,1,1], test_size=0.4 → 2 of each class in test
    (E'0 0 0 0 0 1 1 1 1 1\n0.4\n42', E'train_size=6\ntest_size=4\nclass_balance_test=2,2', FALSE, 1)
) AS v(input, expected_output, is_hidden, ordinal)
WHERE NOT EXISTS (
    SELECT 1 FROM mock_task_test_cases tc WHERE tc.task_id = ts.id AND tc.ordinal = v.ordinal
);

-- LoRA + custom Dataset / pipeline tasks intentionally have NO test cases —
-- their output is non-deterministic (random init, dataloader shuffle order)
-- or model-shape verification belongs in the LLM rubric, not stdout matching.
-- orchestrator.SubmitAnswer detects empty test_cases → ErrSandboxUnavailable
-- → falls back to LLM-rubric grading (см. hybrid blend для ml_coding).

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Cascade: mock_task_test_cases have FK to mock_tasks(id) ON DELETE CASCADE,
-- so the DELETE on mock_tasks reaps test cases automatically.
DELETE FROM mock_tasks
WHERE stage_kind = 'ml_coding'
  AND title IN (
    'Gradient descent with momentum',
    'Softmax cross-entropy loss',
    'Scaled dot-product attention',
    'K-means clustering from scratch',
    'Stratified train/test split',
    'Titanic-style classifier with sklearn',
    'Regression with feature engineering',
    'Clustering pipeline + silhouette evaluation',
    'Cross-validation + hyperparameter tuning',
    'Pipeline with custom transformer',
    'Train MNIST classifier',
    'Custom Dataset + DataLoader',
    'Fine-tune pretrained ResNet',
    'Sequence-to-sequence toy translator',
    'LoRA adapter implementation',
    'Batch inference pipeline',
    'Online learning system (toy)',
    'A/B test framework for ML models',
    'Clean messy CSV with pandas',
    'Time-series rolling stats'
  );

-- +goose StatementEnd
