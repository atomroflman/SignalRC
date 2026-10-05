# Janus Custom Configs

The default `canyan/janus-gateway` image binds its HTTP/WebSocket
listeners on **IPv6 only**, which makes the Server (running in another
container in the same podman/docker network) unable to reach Janus at
`janus:8088` over IPv4.

These overrides force the transport plugins to bind to `eth0` (the
container's primary network interface) so the listeners are reachable
on IPv4 from peers inside the network.

- `janus.transport.http.jcfg` – HTTP API on port 8088
- `janus.transport.websockets.jcfg` – WebSocket API on port 8188

Both files are mounted into the Janus container in `docker-compose.yml`.

## Notes

- `interface = "eth0"` is the default interface inside the `canyan/janus-gateway`
  image. The `ip` field is intentionally left unset so Janus binds on
  all addresses of `eth0` (the container's network IP).
- The `8088` and `8188` ports must be published in `docker-compose.yml`
  for the Server (and browser via nginx) to reach Janus.
- For WebRTC to work over the public internet, the container must be
  started with `--nat-1-1=<public-hostname-or-ip>` so Janus tells the
  browser the correct address to send media to. The compose file does
  this via the `JANUS_NAT_1_1` env var.
