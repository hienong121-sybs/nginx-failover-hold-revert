# Nginx failover: primary 3000 + backup 4000 (hold+revert proxy)

## What this does
- Nginx proxies to `demo-app:3000` (primary).
- If `3000` is not accepting connections, Nginx fails over to `hold-server:4000` (backup).
- `hold-server` will **hold** the request until `3000` becomes available, then **replay/proxy** the same request to `3000` and return the response to the client.
- When `3000` is stable for a while, `hold-server` auto-exits to save resources.

## Local quick test
```bash
docker compose up -d --build
curl -s http://localhost:8080/test

docker stop demo-app
# this will block until you start demo-app again (or until MAX_WAIT_MS)
curl -v http://localhost:8080/wait &

sleep 2
docker start demo-app
wait
```
