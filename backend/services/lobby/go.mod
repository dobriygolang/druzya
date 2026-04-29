module druz9/lobby

go 1.25.0

require (
	connectrpc.com/connect v1.19.2
	druz9/shared v0.0.0
	github.com/google/uuid v1.6.0
	google.golang.org/protobuf v1.36.11
)

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/redis/go-redis/v9 v9.6.1 // indirect
	google.golang.org/genproto/googleapis/api v0.0.0-20260414002931-afd174a4e478 // indirect
)

replace druz9/shared => ../../shared
