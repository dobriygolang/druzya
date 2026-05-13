-- 00118_ml_theory_questions_seed.sql — Phase K M6 (2026-05-13) ML theory
-- default question pool.
--
-- Backing the new StageMLTheory stage_kind в domain/enum.go. Question-pool
-- path (mirroring HR/behavioral): materialiseQuestionAttempts создаёт по
-- одному pipeline_attempt на каждый default + company-overlay вопрос. Judge
-- использует pass2MLTheorySystemPrompt (DL-fundamentals rubric, см.
-- backend/services/mock_interview/app/judge.go).
--
-- Содержание pool'а: 12 вопросов покрывающих:
--   1. Attention / Transformer math (4)
--   2. Optimization (2)
--   3. Normalization (2)
--   4. Generalization / regularization (2)
--   5. Architecture trade-offs (2)
--
-- Reference_criteria — JSONB {must_mention, nice_to_have, common_pitfalls}.
-- must_mention требует ВЫВОДА формулы или геометрической интуиции, не
-- memorised terminology — это enforce'ed pass2MLTheorySystemPrompt'ом
-- который ставит score < 40 за «знаю термин, не понимаю почему».
--
-- Company overlay для openai/anthropic/deepmind — heavier theory bias —
-- seeded в отдельной миграции если нужно (curators могут добавлять через
-- admin UI).

-- +goose Up
-- +goose StatementBegin

INSERT INTO stage_default_questions (stage_kind, body, expected_answer_md, reference_criteria, active, sort_order) VALUES

-- ── Attention / Transformer math ────────────────────────────────────────

('ml_theory',
 E'Выведи self-attention. Почему делим scores на sqrt(d_k) перед softmax? Что произойдёт без деления при больших d_k?',
 E'**Формула:** attn = softmax(Q K^T / sqrt(d_k)) · V.\n\n**Зачем sqrt(d_k):** при d_k=512 элементы Q K^T становятся в среднем sqrt(d_k) раз больше — variance растёт линейно с d_k если Q, K ~ N(0, 1). Это пушит softmax в saturation zone (один логит сильно больше остальных → almost-one-hot → gradients вымирают). Деление на sqrt(d_k) нормализует variance до O(1) и сохраняет gradient flow.\n\n**Без деления:** при d_k=512 softmax быстро становится near-one-hot → нет смешивания токенов в начале training → optimizer стоит на месте.',
 '{"must_mention": ["формула softmax(QK^T/sqrt(d_k)) V", "variance растёт с d_k", "softmax saturation при больших scores", "связь с gradient vanishing"], "nice_to_have": ["связь с initialization scale Xavier/He", "почему делим на sqrt а не d_k"], "common_pitfalls": ["говорить про \"стабильность\" без объяснения через variance", "путать с layer norm (это разные scaling steps)", "не упомянуть softmax saturation"]}'::jsonb,
 TRUE, 10),

('ml_theory',
 E'Объясни Multi-Head Attention. Зачем разделять на головы вместо одной большой attention с большим d_model? Что это даёт в смысле expressive power?',
 E'**Идея:** проекции Q/K/V в подпространства размерности d_k = d_model / num_heads, parallel attention в каждой подпространстве, concat обратно.\n\n**Зачем разделять:**\n1. Разные головы могут специализироваться на разных типах relations (syntactic / semantic / positional). Single big head — один pooling, не способен выразить «в позиции i смотрю на ближайший noun, а в j на ключевое слово темы» одновременно.\n2. Compute стоит так же (концепт low-rank decomposition): num_heads · d_k^2 = d_model · d_k = same FLOPs как single attention d_model^2 при d_k = d_model / h.\n3. Empirically — h=8...16 даёт лучше, чем single head того же param count.\n\n**Expressive power:** single attention выражает rank-1 update on residual в позиции; multi-head — rank-h. Rank — bottleneck для модельной capacity.',
 '{"must_mention": ["проекции в подпространства d_k = d_model / h", "разные головы → разные типы attention patterns", "связь с rank / expressivity", "FLOPs остаются те же"], "nice_to_have": ["empirical h=8...16 sweet spot", "связь с group convolutions / mixture-of-experts"], "common_pitfalls": ["считать что multi-head увеличивает params", "не объяснить почему single head слабее", "путать h и d_model"]}'::jsonb,
 TRUE, 20),

('ml_theory',
 E'KV-cache в LLM inference: как работает, почему нужен, что хранится. Что произойдёт если кэшировать только K, не V?',
 E'**Что:** при autoregressive decoding в позиции t мы считаем self-attention с прошлыми токенами 1..t-1. K_i, V_i для i < t уже посчитаны на предыдущих шагах — нет смысла re-compute. Сохраняем в кэш [seq_len, num_heads, d_k] на каждый layer.\n\n**Без кэша:** каждый новый token требует O(t · d_model) FLOPs повторных проекций для всей prefix → O(t^2) total для generation length t.\n\n**С кэшем:** новый token = только Q_t @ cached_K^T + softmax @ cached_V → O(t · d_model) per step → O(t^2) total для generation но без re-projection (3x экономия на attention layer''е).\n\n**Только K (не V):** broken. softmax(Q K^T) даёт веса распределения над прошлыми позициями, но без V мы не можем взять weighted sum значений. V тоже нужно кэшировать. Иногда K и V кэшируют отдельно (multi-query attention делит V across heads — экономит memory).',
 '{"must_mention": ["что кэшируется (K, V matrices для прошлых tokens)", "почему нужно (избегаем re-projection при autoregressive decoding)", "размерность кэша [layers x heads x seq_len x d_k]", "что без V cache получить attention output нельзя"], "nice_to_have": ["multi-query attention shares V across heads", "memory cost растёт с context length"], "common_pitfalls": ["думать что Q тоже кэшируется (нет, Q новый на каждый step)", "не упомянуть что V нужен для weighted sum", "не учесть memory cost при long contexts"]}'::jsonb,
 TRUE, 30),

('ml_theory',
 E'Positional encoding в Transformer''е. Зачем нужен, какие варианты, в чём разница между absolute (sinusoidal/learned) и relative / RoPE?',
 E'**Зачем:** attention permutation-invariant: softmax(QK^T)V не различает порядок токенов. Без PE «cat sat mat» и «mat sat cat» дают одинаковый output. PE injects positional info в embedding.\n\n**Varianты:**\n1. **Sinusoidal absolute** (Attention is All You Need): PE[pos, 2i] = sin(pos / 10000^(2i/d)), [2i+1] = cos(...). Permits extrapolation за training length (somewhat). Hard-coded — no params.\n2. **Learned absolute** (BERT): nn.Embedding(max_len, d_model). Простой, но fixed max_len → не extrapolates.\n3. **Relative (T5/Shaw):** PE = функция от смещения i - j вместо абсолютной позиции. Хорошо для translation / long context.\n4. **RoPE (Su et al, LLaMA):** rotation matrix multiplies Q, K. Position info entangled с самим attention computation. Хорошо extrapolates через ALiBi-like decay.\n\n**Разница absolute vs relative:** absolute привязывает токен к global position (i=5 → fixed embedding); relative привязывает к pairwise offset (i-j=3 → fixed embedding). Для tasks где важна последовательность но не абсолютная позиция (translation, code generation) — relative выигрывает.',
 '{"must_mention": ["attention permutation-invariant без PE", "хотя бы один absolute и один relative вариант", "RoPE multiplies Q,K rotation matrix", "extrapolation за training length"], "nice_to_have": ["ALiBi", "почему sinusoidal позволяет extrapolation"], "common_pitfalls": ["не объяснить почему attention permutation-invariant", "путать learned PE с RoPE", "не сказать что PE добавляется к embedding (sum), не concat"]}'::jsonb,
 TRUE, 40),

-- ── Optimization ─────────────────────────────────────────────────────────

('ml_theory',
 E'Adam optimizer: формула update, что хранится в state, чем отличается от SGD+momentum. Зачем bias correction в первых шагах?',
 E'**State per param:** m_t (first moment, EMA of gradients), v_t (second moment, EMA of squared gradients).\n\n**Update:**\n1. m_t = β1 · m_{t-1} + (1-β1) · g_t      (β1≈0.9)\n2. v_t = β2 · v_{t-1} + (1-β2) · g_t^2    (β2≈0.999)\n3. m̂_t = m_t / (1 - β1^t)                 ← bias correction\n4. v̂_t = v_t / (1 - β2^t)                 ← bias correction\n5. θ_t = θ_{t-1} - lr · m̂_t / (sqrt(v̂_t) + ε)\n\n**Bias correction:** на шаге t=1 m_1 = (1-β1)·g_1 ≈ 0.1·g_1 — сильно занижено относительно «true mean of gradient» ≈ g_1. Деление на (1-β1^t) восстанавливает unbiased estimate. После t > ~100 разница пренебрежимо мала.\n\n**vs SGD+momentum:** SGD+momentum только m (first moment). Adam добавляет adaptive per-param learning rate через v (large grads → smaller step). Trade-off: Adam быстрее сходится в начале, но иногда хуже generalises (см. paper «Marginal Value of Adaptive Gradient Methods»).',
 '{"must_mention": ["m_t (EMA grad) и v_t (EMA grad^2) — два state", "bias correction делит на (1-β^t)", "почему bias correction нужно — нач EMA = 0", "adaptive per-param lr через v_t"], "nice_to_have": ["AdamW отделяет weight decay от L2", "Adam vs SGD generalization gap"], "common_pitfalls": ["забыть что v_t это squared, не absolute", "не объяснить bias correction concept", "путать с RMSprop (только v, no m)"]}'::jsonb,
 TRUE, 50),

('ml_theory',
 E'Vanishing / exploding gradients: что это, когда возникает, какие механизмы борьбы. Почему ReLU помогает vs sigmoid?',
 E'**Что:** при backprop gradient умножается на jacobian каждого layer''а. Для глубокой сети (L layers) effective gradient ~ product of L jacobians. Если ||J_l|| < 1 → exponential decay (vanishing); > 1 → exponential growth (exploding).\n\n**Когда:**\n- Vanishing: sigmoid (max derivative 0.25) → product of 10 sigmoids ≈ 10^-6.\n- Exploding: RNN с poorly initialized weights / no gradient clipping.\n\n**Механизмы борьбы:**\n1. **ReLU activation:** derivative ∈ {0, 1} вместо ∈ (0, 0.25). Нет вымирания через activation (есть через mean activations → He init).\n2. **Residual connections (ResNet):** skip path даёт identity jacobian — gradient может течь напрямую назад через L layers без attenuation.\n3. **Layer normalization / BatchNorm:** нормализует activations → стабильнее gradient scale.\n4. **Gradient clipping (для exploding):** ||g|| > c → g = c · g / ||g||.\n5. **Careful init:** Xavier для tanh, He для ReLU — preserves variance through layers.\n\n**ReLU vs sigmoid:** sigmoid saturates на больших |x| (derivative → 0); ReLU saturates только в одной стороне (x<0), для x>0 derivative=1 — gradient passes без attenuation.',
 '{"must_mention": ["product of jacobians в backprop", "sigmoid derivative ≤ 0.25 → vanishing", "ReLU derivative ∈ {0,1}", "residual connections как механизм"], "nice_to_have": ["He init для ReLU", "gradient clipping для exploding", "почему вымирание сильнее проявляется в RNN/LSTM"], "common_pitfalls": ["не объяснить через jacobian product", "забыть про exploding case (один vanishing)", "не упомянуть residual / LayerNorm как defense"]}'::jsonb,
 TRUE, 60),

-- ── Normalization ────────────────────────────────────────────────────────

('ml_theory',
 E'BatchNorm vs LayerNorm: формула, на чём нормализуют, зачем разные. Что произойдёт с BatchNorm при batch_size=1? А с LayerNorm?',
 E'**BatchNorm:** μ, σ по batch dimension для каждого канала feature.\n  x_normed[b, c, h, w] = (x[b, c, h, w] - μ[c]) / sqrt(σ[c]^2 + ε)\n  Stats per channel: μ[c] = mean over (b, h, w).\n\n**LayerNorm:** μ, σ по feature dimension для каждого sample.\n  x_normed[b, h] = (x[b, h] - μ[b]) / sqrt(σ[b]^2 + ε)\n  Stats per sample: μ[b] = mean over h (or last few dims).\n\n**Зачем:**\n- BN: image / convnet. Stabilises distributions across training; works на mid-size batches (32+). Inference uses running mean/var (computed during train), не online stats.\n- LN: sequence / transformer. Per-token normalization — не нужен batch dimension. Train и inference identical (никаких running stats).\n\n**Batch=1:**\n- **BN:** μ = sample value, σ = 0 (один sample, variance=0). Division by sqrt(ε) — outputs become near-zero. Train mode сломан. Inference mode (running stats) — OK.\n- **LN:** работает identical как при batch=1000 — нормализация per-sample не зависит от batch. **Это причина почему transformer использует LN.**',
 '{"must_mention": ["BN normalizes over batch dim (per channel), LN over feature dim (per sample)", "running stats в BN inference", "почему LN устойчив к batch=1", "почему transformer использует LN, не BN"], "nice_to_have": ["GroupNorm как middle ground", "instance norm для style transfer"], "common_pitfalls": ["путать какая ось нормализуется", "забыть что BN inference использует running stats", "не объяснить почему transformer не использует BN"]}'::jsonb,
 TRUE, 70),

('ml_theory',
 E'Dropout: формула, зачем работает (теоретическое объяснение, не «predicts regulariser»). Что делать с dropout в inference и почему?',
 E'**Train:** для каждого активации y_i умножаем на маску m_i ~ Bernoulli(p), где p = keep_prob. Затем scale на 1/p: y_normed_i = y_i · m_i / p. Это инверсивный dropout — keeps expected value E[y_normed] = y.\n\n**Inference:** dropout off, used as-is (full network).\n\n**Почему scale на 1/p в train:** в inference используется полная сеть → ожидаемая activation = y. В train с dropout каждая activation на average ≈ p · y. Чтобы train и inference имели одинаковую activation scale, scale-up на train либо scale-down на inference. Обычно scale-up на train (inversion) — inference остаётся cheap.\n\n**Зачем работает (3 уровня):**\n1. **Ensemble interpretation:** каждый dropout pattern — sub-network. Train = train 2^n sub-networks с shared weights. Inference = approximate ensemble average (geometric mean of predictions).\n2. **Preventing co-adaptation:** нейроны не могут полагаться на specific другие нейроны (которые могут быть dropped) → forces robust features.\n3. **Regularization equivalent:** для linear models dropout ≈ L2 regularization с adaptive penalty.\n\n**Implication:** model.eval() в pytorch отключает dropout (как и BN running stats). Забыть .eval() в inference — output становится stochastic.',
 '{"must_mention": ["Bernoulli mask + scale на 1/p в train", "inference uses full network (no mask)", "хотя бы одно теоретическое объяснение (ensemble / co-adaptation)", "model.eval() в pytorch"], "nice_to_have": ["DropConnect (drops weights, не activations)", "Variational dropout для RNN"], "common_pitfalls": ["думать что dropout применяется и в inference", "забыть про scale-up в train", "сказать «random noise» без объяснения почему это помогает"]}'::jsonb,
 TRUE, 80),

-- ── Generalization / regularization ──────────────────────────────────────

('ml_theory',
 E'Bias-variance trade-off: формула decomposition, что значит каждый член, как model capacity влияет на каждый. Где double descent ломает классическое представление?',
 E'**Decomposition:** для squared loss\n  E[(y - f̂(x))^2] = Var(noise) + Bias(f̂)^2 + Var(f̂)\n\nГде:\n- **Var(noise)** — irreducible (data noise; не зависит от модели).\n- **Bias(f̂)^2 = (E[f̂(x)] - f*(x))^2** — насколько expected prediction отличается от истинного f*. Low-capacity модели (linear для нелинейных data) — high bias.\n- **Var(f̂) = E[(f̂(x) - E[f̂(x)])^2]** — насколько prediction варьируется между training runs (с разными samples). High-capacity модели (deep nets, polynomials) — high variance.\n\n**Classical U-shape:** small capacity → bias dominates → test error high; large capacity → variance dominates → test error high; optimum в середине.\n\n**Double descent (Belkin 2019):** для very over-parameterised моделей test error снова падает после interpolation threshold (когда модель может exactly fit training data). Implicit regularization gradient descent''а (для small init / late-stopping) выбирает minimum-norm solution среди infinite-many fits → bias не растёт sufficiently fast чтобы compensate variance fall.\n\n**Implication:** «нельзя overparameterise» — обманчиво. Modern deep learning живёт по другую сторону interpolation threshold.',
 '{"must_mention": ["формула decomposition (variance + bias^2 + irreducible)", "что каждый член", "U-shape classical view", "double descent breaks U-shape"], "nice_to_have": ["minimum-norm interpolation", "implicit regularization SGD", "связь с lottery ticket hypothesis"], "common_pitfalls": ["путать bias и variance роли", "забыть про noise term", "не упомянуть double descent (отметит interviewer как «old textbook»)"]}'::jsonb,
 TRUE, 90),

('ml_theory',
 E'L2 vs L1 regularization: формула, что происходит с весами при обучении, какой когда выбирать. Почему L1 даёт sparse solutions, а L2 нет?',
 E'**L2 (Ridge):** loss += λ · sum(w^2). Gradient term: -2λw — pushes ВСЕ веса к нулю пропорционально их величине. Веса становятся small but non-zero.\n\n**L1 (Lasso):** loss += λ · sum(|w|). Gradient term: -λ · sign(w) — constant magnitude push regardless of weight size. Веса становятся exactly zero (sparse).\n\n**Почему L1 sparse:** geometric intuition. Optimization constraint surface для L1 — diamond (|w_1| + |w_2| ≤ C); для L2 — circle (w_1^2 + w_2^2 ≤ C). Когда unconstrained optimum пересекается с constraint surface, для L1 это часто угол diamond''а (где один из w = 0); для L2 — точка на circle (оба w ≠ 0).\n\nАлгебраически: subdifferential L1 в w=0 это [-λ, λ]. Если |gradient| ≤ λ — стабильная solution = 0.\n\n**Когда что:**\n- L1: feature selection (many features, suspect many are noise) → sparse model interpretable.\n- L2: dense feature problems (image pixels, embeddings) → small uniform shrinkage.\n- Elastic Net (L1 + L2 mix) — best of both для correlated features.',
 '{"must_mention": ["формулы L1 и L2", "L1 даёт sparse, L2 не даёт", "хотя бы одно объяснение почему (geometric или subdifferential)", "когда выбирать что"], "nice_to_have": ["Elastic Net", "связь L2 с weight decay (matches только без momentum/Adam!)"], "common_pitfalls": ["сказать что L2 даёт sparse (нет — пропорциональный shrinkage)", "не объяснить почему именно L1 sparse", "не упомянуть что L1 не differentiable в нуле (subgradient methods)"]}'::jsonb,
 TRUE, 100),

-- ── Architecture trade-offs ──────────────────────────────────────────────

('ml_theory',
 E'CNN vs Transformer для vision: какие inductive biases у каждого, чем ViT сильнее/слабее ResNet''а. Когда чё выбирать?',
 E'**CNN inductive biases:**\n1. **Locality:** конволюции работают с локальными patches (k x k) — assumes spatial structure.\n2. **Translation equivariance:** один и тот же filter slides по картинке → cat в верхнем левом углу даёт same features что и в правом нижнем.\n3. **Hierarchical features:** early layers — edges, deeper — parts → objects. Encoded in архитектуре через pooling / stride.\n\n**ViT (Transformer):**\n1. **Patches as tokens:** картинка → 16x16 patches → tokens → self-attention. NO built-in locality (любой patch может attend на любой).\n2. **Learned positional encoding:** spatial inductive bias не hardcoded.\n3. **Global receptive field с layer 1:** каждый patch видит весь image сразу. CNN — только в deeper layers через stacked convolutions.\n\n**Trade-offs:**\n- **Data efficiency:** CNN > ViT на small data (ImageNet-1k или меньше) — inductive biases CNN useful prior. ViT нужно 14M+ images (JFT-300M).\n- **Scaling:** ViT scales лучше с data + compute. ResNet быстро plateau''ит, ViT keeps improving.\n- **Robustness to distribution shift:** ViT часто лучше (less reliance on texture, more on shape).\n- **Inference cost:** comparable per FLOPs, но ViT requires более sophisticated infrastructure (attention с context-dependent compute).\n\n**Когда что:**\n- Small dataset (< 10k samples), limited compute → CNN (transfer learning от ImageNet ResNet).\n- Large dataset / scaling regime → ViT или hybrid (Swin, ConvNeXt).\n- Multimodal (text + image) → ViT (одинаковая архитектура с language Transformer).',
 '{"must_mention": ["хотя бы 2 CNN inductive biases (locality, translation equivariance, hierarchy)", "ViT: patches as tokens, no built-in locality", "data efficiency tradeoff CNN > ViT на small data", "scaling tradeoff ViT > CNN на big data"], "nice_to_have": ["Swin / ConvNeXt как hybrid", "robustness to shift", "почему ViT начало работать только с JFT"], "common_pitfalls": ["сказать «ViT всегда лучше» (нет, on ImageNet-1k ResNet competitive)", "путать ViT и MLP-Mixer", "не упомянуть что ViT нужны huge datasets"]}'::jsonb,
 TRUE, 110),

('ml_theory',
 E'LoRA fine-tuning: формула, почему работает (математическое обоснование low-rank assumption), trade-offs vs full fine-tuning. Что инициализируется как ноль и почему?',
 E'**Формула:** для весов W ∈ R^(d×k) frozen, добавляем low-rank update:\n  W'' = W + ΔW = W + (alpha/r) · A · B\nгде A ∈ R^(d×r), B ∈ R^(r×k), r << min(d, k). Только A, B trainable.\n\n**Init:**\n- A ~ Kaiming (non-zero).\n- B = 0.\n\n**Почему B=0:** изначально A · B = 0 → W'' = W + 0 = W. Модель starts identical to pretrained checkpoint — no degradation на step 0. Если оба A, B random — пред-tuned поведение моментально ломается → необходимо много steps чтобы recover.\n\n**Почему работает (low-rank assumption):** Aghajanyan et al (2020) показали что intrinsic dimension fine-tuning task''а намного меньше d_model. Empirically: даже r=4-16 enough для тонкой adaptation (LoRA paper: GPT-3 175B, r=4, на par с full fine-tuning).\n\n**Trade-offs LoRA vs full FT:**\n+ Memory: trainable params O(r·(d+k)) vs O(d·k) — экономия 1000x для r=4, d=k=4096.\n+ Storage: один pretrained checkpoint + small LoRA adapter per task (десятки MB).\n+ No catastrophic forgetting: original W frozen.\n+ Switchable adapters: serve multiple tasks с одной base model.\n- Чуть ниже peak quality на complex tasks (3-5% gap).\n- Hyperparam tuning r важен (too low → underfit; too high → overhead без gain).\n\n**Merging:** в inference можно вычислить W_merged = W + (alpha/r) · A · B и serve как обычный layer (no LoRA overhead).',
 '{"must_mention": ["формула W + (alpha/r) · A · B", "B = 0 init, A — non-zero", "почему B=0 (start identical to pretrained)", "intrinsic dimension assumption"], "nice_to_have": ["LoRA можно merge в inference", "QLoRA (LoRA + 4-bit quantization)", "почему alpha/r — scaling factor"], "common_pitfalls": ["сказать что оба A,B нулевые (gradient не флоит)", "не объяснить почему именно low rank работает", "забыть про merge в inference"]}'::jsonb,
 TRUE, 120);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DELETE FROM stage_default_questions WHERE stage_kind = 'ml_theory';

-- +goose StatementEnd
