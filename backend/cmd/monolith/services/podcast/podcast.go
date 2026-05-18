package podcast

import (
	"context"
	"log/slog"
	"os"
	"time"

	monolithServices "druz9/cmd/monolith/services"
	authServices "druz9/cmd/monolith/services/auth"
	podcastApp "druz9/podcast/app"
	podcastDomain "druz9/podcast/domain"
	podcastInfra "druz9/podcast/infra"
	podcastPorts "druz9/podcast/ports"
	"druz9/shared/generated/pb/druz9/v1/druz9v1connect"
	"druz9/shared/pkg/eventbus"

	"github.com/go-chi/chi/v5"
)

// NewPodcast wires the podcast catalog (bible §3.9) plus the runtime CMS
// surface that replaces the original hard-coded /podcast list with a
// MinIO-backed admin uploader.
//
// Two surfaces, one wirer:
//
//   - Legacy Connect handler (PodcastService.ListCatalog,
//     UpdateProgress) — kept for the streaming-progress flow.
//   - REST CMS surface (cms_handler.go) — public list/single + admin
//     upload, mounted at /api/v1/podcast and /api/v1/admin/podcast.
//
// The CMS REST routes win over the Connect transcoder for
// GET /podcast (the chi.Router pattern matches first), so the public
// list response uses the new CMS shape with `audio_url` populated by a
// MinIO presigned GET.
func NewPodcast(d monolithServices.Deps) *monolithServices.Module {
	pg := podcastInfra.NewPostgres(d.Pool)

	// ── MinIO store ────────────────────────────────────────────────────
	//
	// The MinIO store is real iff the operator wired credentials in;
	// otherwise we use the explicit unconfigured fallback so every
	// PresignGet / Sign call returns ErrObjectStoreUnavailable rather
	// than a placeholder URL.
	var rawStore podcastDomain.PodcastObjectStore
	if d.Cfg.MinIO.AccessKey != "" && d.Cfg.MinIO.SecretKey != "" && d.Cfg.MinIO.Endpoint != "" {
		minioStore := podcastInfra.NewMinIOPodcastStore(
			d.Cfg.MinIO.Endpoint,
			d.Cfg.MinIO.PublicEndpoint,
			d.Cfg.MinIO.AccessKey,
			d.Cfg.MinIO.SecretKey,
			minioBucketPodcasts(),
			d.Cfg.MinIO.UseSSL,
		)
		// Auto-create the bucket on boot if it doesn't exist. Removes the
		// historical "operator must `mc mb minio/podcasts` manually" foot-gun.
		// Failure is logged but non-fatal — minio may be eventually available;
		// PUT will surface the real error if the bucket is still missing.
		bootCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		if err := minioStore.EnsureBucket(bootCtx); err != nil {
			d.Log.Warn("podcast: minio EnsureBucket failed; manual `mc mb` may be required",
				slog.String("bucket", minioBucketPodcasts()),
				slog.Any("err", err))
		}
		cancel()
		rawStore = minioStore
	} else {
		rawStore = podcastInfra.NewUnconfiguredObjectStore()
	}
	var store podcastDomain.PodcastObjectStore = rawStore
	if d.Redis != nil && rawStore.Available() {
		store = podcastInfra.NewPresignCache(
			rawStore,
			podcastInfra.NewCMSRedisKV(d.Redis),
			podcastInfra.DefaultCMSPresignTTL,
			d.Log,
		)
	}

	// Legacy ListCatalog / UpdateProgress — Connect surface, plus the CMS
	// methods (ListCMSPodcasts / GetCMSPodcast / etc.) declared in
	// podcast.proto. CMSService is attached via AttachCMS once constructed.
	signer := podcastInfra.NewMinioAudioSigner(store, podcastInfra.DefaultAudioSignTTL)
	list := podcastApp.NewListCatalog(pg, signer)
	upd := podcastApp.NewUpdateProgress(pg, d.Bus, d.Log)
	server := podcastPorts.NewPodcastServer(list, upd, d.Log)

	rawCMSRepo := podcastInfra.NewPostgresCMS(d.Pool)
	var cmsRepo podcastDomain.PodcastCMSRepo = rawCMSRepo
	if d.Redis != nil {
		cmsRepo = podcastInfra.NewCachedCMSRepo(
			rawCMSRepo,
			podcastInfra.NewCMSRedisKV(d.Redis),
			podcastInfra.DefaultCMSListTTL,
			d.Log,
		)
	}
	cmsSvc := podcastApp.NewCMSService(cmsRepo, store, d.Log, d.Now)
	server.AttachCMS(cmsSvc)
	// HandleCreate stays chi — it accepts multipart/form-data audio uploads
	// (up to 200 MB), a legit binary edge case per Golden Path.
	cmsHandler := podcastPorts.NewCMSHandler(cmsSvc, d.Log, d.Now)

	connectPath, connectHandler := druz9v1connect.NewPodcastServiceHandler(server)
	transcoder := monolithServices.MustTranscode("podcast", connectPath, connectHandler)

	adminGate := authServices.AdminGateHandler(transcoder)

	return &monolithServices.Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// Public reads via vanguard transcoder (CMS shape).
			r.Get("/podcast", transcoder.ServeHTTP)
			r.Get("/podcast/categories", transcoder.ServeHTTP)
			r.Get("/podcast/{id}", transcoder.ServeHTTP)
			// Listening progress (per-user).
			r.Put("/podcast/{podcastId}/progress", transcoder.ServeHTTP)
			// Admin writes — admin gate above transcoder, except multipart
			// upload which keeps its chi handler.
			r.Post("/admin/podcast", cmsHandler.HandleCreate)
			r.Patch("/admin/podcast/{id}", adminGate)
			r.Delete("/admin/podcast/{id}", adminGate)
			r.Post("/admin/podcast/categories", adminGate)
		},
		Subscribers: []func(*eventbus.InProcess){
			func(b *eventbus.InProcess) { podcastApp.SubscribeHandlers(b) },
		},
	}
}

// minioBucketPodcasts reads the MINIO_BUCKET_PODCASTS env var with a
// stable default. We do NOT promote this to shared/pkg/config because
// the bucket is a podcast-domain concern; widening config.Config every
// time a domain wants its own bucket would balloon the surface.
func minioBucketPodcasts() string {
	if v := os.Getenv("MINIO_BUCKET_PODCASTS"); v != "" {
		return v
	}
	return "podcasts"
}
