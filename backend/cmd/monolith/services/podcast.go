package services

import (
	"os"

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
func NewPodcast(d Deps) *Module {
	pg := podcastInfra.NewPostgres(d.Pool)
	signer := podcastInfra.NewFakeSigner("/stream")
	list := podcastApp.NewListCatalog(pg, signer)
	upd := podcastApp.NewUpdateProgress(pg, d.Bus, d.Log)
	server := podcastPorts.NewPodcastServer(list, upd, d.Log)

	connectPath, connectHandler := druz9v1connect.NewPodcastServiceHandler(server)
	transcoder := mustTranscode("podcast", connectPath, connectHandler)

	// ── CMS surface ────────────────────────────────────────────────────
	//
	// The MinIO store is real iff the operator wired credentials in;
	// otherwise we use the explicit unconfigured fallback so the admin
	// endpoints can answer 503 with a clear "missing MINIO_*" message
	// instead of a silent 500.
	var rawStore podcastDomain.PodcastObjectStore
	if d.Cfg.MinIO.AccessKey != "" && d.Cfg.MinIO.SecretKey != "" && d.Cfg.MinIO.Endpoint != "" {
		rawStore = podcastInfra.NewMinIOPodcastStore(
			d.Cfg.MinIO.Endpoint,
			d.Cfg.MinIO.AccessKey,
			d.Cfg.MinIO.SecretKey,
			minioBucketPodcasts(),
			d.Cfg.MinIO.UseSSL,
		)
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
	cmsHandler := podcastPorts.NewCMSHandler(cmsSvc, d.Log, d.Now)

	return &Module{
		ConnectPath:        connectPath,
		ConnectHandler:     transcoder,
		RequireConnectAuth: true,
		MountREST: func(r chi.Router) {
			// CMS public routes — must be mounted BEFORE the legacy
			// /podcast Connect transcoder route so chi's pattern matcher
			// picks the new handler.
			r.Get("/podcast", cmsHandler.HandleListCMS)
			r.Get("/podcast/categories", cmsHandler.HandleListCategories)
			r.Get("/podcast/{id}", cmsHandler.HandleGetCMS)

			// Legacy progress endpoint — kept Connect-routed.
			r.Put("/podcast/{podcastId}/progress", transcoder.ServeHTTP)

			// Admin CMS routes — role gate enforced inside the handler.
			r.Post("/admin/podcast", cmsHandler.HandleCreate)
			r.Patch("/admin/podcast/{id}", cmsHandler.HandleUpdate)
			r.Delete("/admin/podcast/{id}", cmsHandler.HandleDelete)
			r.Post("/admin/podcast/categories", cmsHandler.HandleCreateCategory)
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
