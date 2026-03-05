package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	pb "github.com/mehdiakiki/raft-core/gen/raft"
	"github.com/mehdiakiki/raft-demo/internal/gateway"
	"google.golang.org/grpc"
)

func main() {
	httpAddr := flag.String("http-addr", ":8080", "HTTP/WebSocket listen address")
	grpcAddr := flag.String("grpc-addr", ":50051", "gRPC listen address (nodes push here)")
	logLevel := flag.String("log-level", "info", "log level: debug, info, warn, error")
	flag.Parse()

	level, err := parseLogLevel(*logLevel)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: level,
	})))

	hub := gateway.NewHub()

	grpcSrv := grpc.NewServer()
	pb.RegisterRaftGatewayServer(grpcSrv, &gateway.StateReceiver{Hub: hub})

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", hub.ServeWS)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	httpSrv := &http.Server{Addr: *httpAddr, Handler: corsMiddleware(mux)}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		lis, err := net.Listen("tcp", *grpcAddr)
		if err != nil {
			slog.Error("gRPC listen failed", "err", err)
			return
		}
		slog.Info("gRPC server listening", "addr", *grpcAddr, "service", "RaftGateway")
		if err := grpcSrv.Serve(lis); err != nil {
			slog.Error("gRPC server error", "err", err)
		}
	}()

	go func() {
		slog.Info("HTTP server listening", "addr", *httpAddr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "err", err)
		}
	}()

	<-ctx.Done()
	slog.Info("shutting down gateway")

	grpcSrv.GracefulStop()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	httpSrv.Shutdown(shutdownCtx)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func parseLogLevel(raw string) (slog.Level, error) {
	switch raw {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("invalid --log-level %q (allowed: debug, info, warn, error)", raw)
	}
}
