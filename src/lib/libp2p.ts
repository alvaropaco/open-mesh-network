import { createLibp2p, Libp2p } from 'libp2p'
import { webRTCStar } from '@libp2p/webrtc-star'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { identify } from '@libp2p/identify'
import { multiaddr } from '@multiformats/multiaddr'

export type meshedNode = Libp2p<{ pubsub: any }>

const SIGNAL_MULTIADDR =
  process.env.NEXT_PUBLIC_SIGNAL_MULTIADDR || '/dns4/localhost/tcp/9091/ws/p2p-webrtc-star'

let ICE_SERVERS: RTCIceServer[] | undefined
try {
  ICE_SERVERS = process.env.NEXT_PUBLIC_ICE_SERVERS
    ? JSON.parse(process.env.NEXT_PUBLIC_ICE_SERVERS)
    : undefined
} catch (e) {
  console.warn('ICE servers inválidos; usando defaults do browser', e)
}

export async function initNode(): Promise<meshedNode> {
  const wrtcStar = webRTCStar()

  // Compat: libp2p v3 espera `listenFilter`; webrtc-star v7 expõe `filter`.
  const wrtcStarCompat = {
    ...wrtcStar,
    transport: (components: any) => {
      const t = wrtcStar.transport(components) as any
      if (typeof t.listenFilter !== 'function') {
        t.listenFilter = (addrs: any) => {
          try {
            const arr = (() => {
              if (addrs == null) return []
              if (Array.isArray(addrs)) return addrs
              if (typeof (addrs as any)[Symbol.iterator] === 'function') return Array.from(addrs as any)
              if (typeof (addrs as any).toArray === 'function') return (addrs as any).toArray()
              return [addrs]
            })()

            const maArr = arr.map((a: any) => {
              try {
                if (typeof a?.protoCodes === 'function') return a
                if (typeof a === 'string') return multiaddr(a)
                if (typeof a?.toString === 'function') return multiaddr(a.toString())
                return a
              } catch {
                return a
              }
            })

            const onlyMa = maArr.filter((a: any) => typeof a?.protoCodes === 'function')
            // A implementação do filtro do webrtc-star v7 parece rejeitar endereços /wss.
            // Para contornar isso, retornamos a lista de endereços diretamente,
            // confiando que o endereço do sinalizador fornecido é válido.
            console.debug('[libp2p] listenFilter bypass. Input:', onlyMa.map((a: any) => a?.toString?.() ?? a))
            return onlyMa
          } catch (e) {
            console.warn('[libp2p] listenFilter compat fallback error', e)
            return []
          }
        }
      }
      return t
    }
  }

  const node = await createLibp2p({
    addresses: { listen: [multiaddr(SIGNAL_MULTIADDR) as any] },
    transportManager: { faultTolerance: 'NO_FATAL' } as any,
    connectionManager: { autoDial: true } as any,
    transports: [wrtcStarCompat as any],
    peerDiscovery: [wrtcStar.discovery() as any],
    connectionEncrypters: [noise() as any],
    streamMuxers: [mplex() as any],
    services: {
      identify: identify() as any,
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, fallbackToFloodsub: true }) as any,
    },
  })

  await node.start()

  node.addEventListener('peer:discovery', (evt) => {
    const d: any = (evt as any).detail
    const idStr = d?.id?.toString?.() ?? d?.toString?.() ?? d
    console.log('[libp2p] peer:discovery', idStr)
  })
  node.addEventListener('peer:connect', (evt) => {
    console.log('[libp2p] peer:connect', (evt as any).detail?.toString?.())
  })
  node.addEventListener('peer:disconnect', (evt) => {
    console.log('[libp2p] peer:disconnect', (evt as any).detail?.toString?.())
  })

  return node as meshedNode
}

export async function subscribe(node: meshedNode, topic: string, onMessage: (data: Uint8Array) => void) {
  node.services.pubsub.subscribe(topic)
  node.services.pubsub.addEventListener('message', (evt: any) => {
    const detail = evt.detail || {}
    const topics = Array.isArray(detail.topics)
      ? detail.topics
      : (typeof detail.topic === 'string' ? [detail.topic] : [])
    if (!(topics.includes(topic))) return
    onMessage(detail.data)
  })
}

export async function publish(node: meshedNode, topic: string, data: Uint8Array) {
  await node.services.pubsub.publish(topic, data)
}

export async function disconnect(node: meshedNode) {
  await node.stop()
}
