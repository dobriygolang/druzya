# Build from the repo root so go.work + all service modules come along.
FROM golang:1.25-alpine AS build
WORKDIR /src

RUN apk add --no-cache git ca-certificates

# Copy the entire workspace. For the MVP we accept the context cost; later we
# can switch to a staged copy + go mod download for better layer caching.
COPY go.work ./
COPY backend ./backend

WORKDIR /src
RUN go work sync
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/monolith ./backend/cmd/monolith

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/monolith /app/monolith
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/monolith"]
