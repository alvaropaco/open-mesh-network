"use client"

import { useEffect, useRef, useState } from 'react'
import { initNode, subscribe, publish, disconnect, type DechatNode } from '@/lib/libp2p'

export default function SelfTest() {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const nodeARef = useRef<DechatNode | null>(null)
  const nodeBRef = useRef<DechatNode | null>(null)
  const topic = 'dechat-selftest'

  useEffect(() => () => {
    if (nodeARef.current) disconnect(nodeARef.current)
    if (nodeBRef.current) disconnect(nodeBRef.current)
  }, [])

  async function runTest() {
    setRunning(true)
    setResult('')
    setStatus('Starting nodes…')

    const nodeA = await initNode()
    const nodeB = await initNode()
    nodeARef.current = nodeA
    nodeBRef.current = nodeB

    let recvA = 0
    let recvB = 0
    let connectsA = 0
    let connectsB = 0

    nodeA.addEventListener('peer:connect', () => { connectsA++; setStatus(`A connects=${connectsA} B connects=${connectsB}`) })
    nodeB.addEventListener('peer:connect', () => { connectsB++; setStatus(`A connects=${connectsA} B connects=${connectsB}`) })

    await subscribe(nodeA, topic, (data) => {
      const msg = new TextDecoder().decode(data)
      console.debug('[selftest] A received:', msg)
      recvA++
    })
    await subscribe(nodeB, topic, (data) => {
      const msg = new TextDecoder().decode(data)
      console.debug('[selftest] B received:', msg)
      recvB++
    })

    setStatus('Waiting for mesh to form…')
    // Wait up to 10s for both nodes to get at least one connection
    const start = Date.now()
    while (Date.now() - start < 10000 && (connectsA === 0 || connectsB === 0)) {
      await new Promise(r => setTimeout(r, 250))
    }

    if (connectsA === 0 || connectsB === 0) {
      setResult(`❌ No peer connections formed (A=${connectsA} B=${connectsB}).`)
      setRunning(false)
      return
    }

    setStatus('Publishing messages…')
    await publish(nodeA, topic, new TextEncoder().encode('hello-from-A'))
    await publish(nodeB, topic, new TextEncoder().encode('hello-from-B'))

    // Wait for delivery
    await new Promise(r => setTimeout(r, 2500))

    if (recvA > 0 && recvB > 0) {
      setResult('✅ PubSub delivered messages to both nodes.')
    } else {
      setResult(`❌ Delivery failed: recvA=${recvA} recvB=${recvB}`)
    }

    setRunning(false)
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Self Test: PubSub over WebRTC-Star</h2>
      <p>Creates two libp2p nodes, subscribes both to a topic, waits for connections, and publishes messages from each.</p>
      <button onClick={runTest} disabled={running} style={{ padding: '8px 12px', borderRadius: 8 }}>
        {running ? 'Running…' : 'Run Self-Test'}
      </button>
      {status && <p style={{ marginTop: 8, color: '#64748b' }}>{status}</p>}
      {result && <p style={{ marginTop: 12 }}>{result}</p>}
    </div>
  )
}