# meshed P2P — Next.js PWA + libp2p WebRTC + Docker

Mensageria **descentralizada P2P** (browser-to-browser) com **libp2p** + **WebRTC**, suporte a:
- **DMs E2E** (ECDH X25519 + secretbox)
- **Sala com Group E2E** (chave de grupo, *rekeying*, controle de membros)
- **Pinning de chaves públicas** (anti-MITM no MVP)
- **Backup/Restore** de identidade e contatos
- **Docker Compose** com **sinalização (webrtc-star)** + **coturn** (STUN/TURN)

## Rodando local
```bash
docker-compose up --build
# abra http://localhost:3000 em duas abas
# entre na mesma sala; o primeiro vira owner e aprova os demais
```

## Produção (wss://)
- Exponha o sinalizador atrás de TLS (veja `docker-compose.prod.yml` + `Caddyfile`)
- Ajuste `NEXT_PUBLIC_SIGNAL_MULTIADDR` para `/dns4/<seu-dominio>/tcp/443/wss/p2p-webrtc-star`
- Configure seus STUN/TURN públicos em `NEXT_PUBLIC_ICE_SERVERS`
