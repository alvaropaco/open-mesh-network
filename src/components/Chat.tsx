'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { initNode, subscribe, publish, disconnect, type DechatNode } from '@/lib/libp2p'
import {
  getOrCreateIdentity,
  encryptDM,
  decryptDM,
  fingerprint,
  listContacts,
  addOrVerifyContact,
  getPinnedPublicKey,
  u8ToB64,
  b64ToU8,
  makeBackup,
  restoreBackup,
  type Identity,
} from '@/lib/identity'
import {
  ensureRoomKey,
  getOwnerFingerprint,
  addMember,
  removeMember,
  listMembers,
  setGroupKeyFromOwner,
  encryptGroup,
  decryptGroup,
  rotateGroupKey,
  getCurrentKeyId,
  addPending,
  removePending,
  listPending,
} from '@/lib/group'

const DEFAULT_ROOM = process.env.NEXT_PUBLIC_DEFAULT_ROOM || 'dechat-global'

type LogItem = { ts: number; from: string; text: string; kind: 'room' | 'dm' | 'sys' }

type JoinAction = { fp: string, when: number }

export default function Chat() {
  const [room, setRoom] = useState<string>(DEFAULT_ROOM)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState(false)
  const [input, setInput] = useState('')
  const [log, setLog] = useState<LogItem[]>([])
  const [targets, setTargets] = useState<string[]>([])
  const [targetFp, setTargetFp] = useState<string>('') // vazio = sala
  const [ownerFp, setOwnerFp] = useState<string>('')
  const [members, setMembers] = useState<string[]>([])
  const [pending, setPending] = useState<JoinAction[]>([])
  const [keyId, setKeyId] = useState<string>('')

  const nodeRef = useRef<DechatNode | null>(null)
  const [id, setId] = useState<Identity | null>(null)
  useEffect(() => { setId(getOrCreateIdentity()) }, [])
  const myFp = useMemo(() => (id ? fingerprint(id.publicKey) : ''), [id?.publicKey])

  const rebroadcastTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const node = nodeRef.current
    if (!connected || !node || !id) return
    const hasKey = !!getCurrentKeyId(room)
    if (hasKey) {
      if (rebroadcastTimerRef.current) {
        clearInterval(rebroadcastTimerRef.current)
        rebroadcastTimerRef.current = null
      }
      return
    }
    const fn = async () => {
      try {
        const hello = { type: 'hs', fp: myFp, pkB64: u8ToB64(id.publicKey) }
        await publish(node, room, new TextEncoder().encode(JSON.stringify(hello)))
        const joinReq = { type: 'join-req', from: myFp }
        await publish(node, room, new TextEncoder().encode(JSON.stringify(joinReq)))
        console.debug('[chat] Periodic hs & join-req rebroadcast')
      } catch (e) {
        console.warn('[chat] Falha no rebroadcast periódico', e)
      }
    }
    fn()
    rebroadcastTimerRef.current = window.setInterval(fn, 5000)
    return () => {
      if (rebroadcastTimerRef.current) {
        clearInterval(rebroadcastTimerRef.current)
        rebroadcastTimerRef.current = null
      }
    }
  }, [connected, room, keyId, id?.publicKey, myFp])
  useEffect(() => () => { if (nodeRef.current) disconnect(nodeRef.current) }, [])

  function refreshContacts() {
    if (!id) return
    setTargets(listContacts().filter((fp) => fp !== myFp))
  }

  function refreshMembershipUI() {
    setMembers(Array.from(listMembers(room)))
    setOwnerFp(getOwnerFingerprint(room, myFp))
    setKeyId(getCurrentKeyId(room) || '')
    setPending(Array.from(listPending(room)).map(fp => ({ fp, when: Date.now() })))
  }

  async function handleConnect() {
    if (!id) return
    if (connected || connecting) return
    setConnecting(true)
    const node = await initNode()
    nodeRef.current = node

    await subscribe(node, room, async (data) => {
      try {
        const payload = JSON.parse(new TextDecoder().decode(data))
        const type = payload.type as 'hs' | 'hs-ack' | 'join-req' | 'join-rej' | 'room-key' | 'gchat' | 'dm'
        if (!type) return

        if (type === 'hs' || type === 'hs-ack') {
          const { fp, pkB64 } = payload
          const status = addOrVerifyContact(fp, b64ToU8(pkB64))
          if (status === 'mismatch') {
            setLog((l) => [...l, { ts: Date.now(), from: fp, text: '⚠️ chave pública divergente — possível MITM; ignorado.', kind: 'sys' }])
            return
          }
          if (type === 'hs') {
            const ack = { type: 'hs-ack', fp: myFp, pkB64: u8ToB64(id.publicKey) }
            await publish(node, room, new TextEncoder().encode(JSON.stringify(ack)))
          }
          refreshContacts(); refreshMembershipUI()
          return
        }

        if (type === 'join-req') {
          const { from } = payload
          if (getOwnerFingerprint(room, myFp) !== myFp) return
          addPending(room, from)
          refreshMembershipUI()
          setLog((l) => [...l, { ts: Date.now(), from, text: 'Pedido de entrada na sala.', kind: 'sys' }])
          return
        }

        if (type === 'join-rej') {
          const { to } = payload
          if (to !== myFp) return
          setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: 'Seu pedido para entrar na sala foi recusado pelo owner.', kind: 'sys' }])
          return
        }

        if (type === 'room-key') {
          const { to, from, body } = payload
          if (to !== myFp) return
          const senderPk = getPinnedPublicKey(from)
          if (!senderPk) return
          const plain = await decryptDM(id!.secretKey, senderPk, body)
          const { keyB64, keyId } = JSON.parse(plain)
          setGroupKeyFromOwner(room, keyB64, keyId)
          addMember(room, myFp)
          removePending(room, myFp)
          refreshMembershipUI()
          setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: `Você entrou na sala. keyId=${keyId}`, kind: 'sys' }])
          return
        }

        if (type === 'gchat') {
          const { from, body, keyId } = payload
          const text = decryptGroup(room, body, keyId)
          setLog((l) => [...l, { ts: Date.now(), from, text, kind: 'room' }])
          return
        }

        if (type === 'dm') {
          const { to, from, body } = payload
          if (to !== myFp) return
          const senderPk = getPinnedPublicKey(from)
          if (!senderPk) return
          const plain = await decryptDM(id!.secretKey, senderPk, body)
          setLog((l) => [...l, { ts: Date.now(), from, text: plain, kind: 'dm' }])
          return
        }
      } catch (e) {
        console.warn('Mensagem inválida', e)
      }
    })

    // Rebroadcast hs/join quando um novo peer conecta
    node.addEventListener('peer:connect', async () => {
      try {
        const hello = { type: 'hs', fp: myFp, pkB64: u8ToB64(id!.publicKey) }
        await publish(node, room, new TextEncoder().encode(JSON.stringify(hello)))
        const joinReq = { type: 'join-req', from: myFp }
        await publish(node, room, new TextEncoder().encode(JSON.stringify(joinReq)))
        console.debug('[chat] Rebroadcast hs & join-req on peer:connect')
      } catch (e) {
        console.warn('[chat] Falha ao rebroadcast handshake', e)
      }
    })

    addMember(room, myFp)

    const hello = { type: 'hs', fp: myFp, pkB64: u8ToB64(id.publicKey) }
    await publish(node, room, new TextEncoder().encode(JSON.stringify(hello)))

    const joinReq = { type: 'join-req', from: myFp }
    await publish(node, room, new TextEncoder().encode(JSON.stringify(joinReq)))

    const info = ensureRoomKey(room)
    setKeyId(info?.keyId || '')

    refreshContacts(); refreshMembershipUI()
    setConnecting(false)
    setConnected(true)
    setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: `Conectado à sala ${room}. Owner atual: ${getOwnerFingerprint(room, myFp)}`, kind: 'sys' }])
  }

  async function send() {
    if (!id || !nodeRef.current || !input.trim()) return
    const msg = input
    setInput('')

    if (targetFp) {
      const remotePk = getPinnedPublicKey(targetFp)
      if (!remotePk) {
        setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: 'Contato alvo sem chave fixada.', kind: 'sys' }])
        return
      }
      const body = await encryptDM(id.secretKey, remotePk, msg)
      const payload = { type: 'dm', to: targetFp, from: myFp, body }
      await publish(nodeRef.current, room, new TextEncoder().encode(JSON.stringify(payload)))
      setLog((l) => [...l, { ts: Date.now(), from: `eu → ${targetFp}`, text: msg, kind: 'dm' }])
      return
    }

    const payload = encryptGroup(room, msg)
    if (!payload) {
      setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: 'Sem chave de grupo. Aguarde aprovação do owner.', kind: 'sys' }])
      return
    }
    await publish(nodeRef.current, room, new TextEncoder().encode(JSON.stringify({ type: 'gchat', from: myFp, ...payload })))
    setLog((l) => [...l, { ts: Date.now(), from: 'eu', text: msg, kind: 'room' }])
  }

  async function approve(fp: string) {
    if (!id) return
    if (getOwnerFingerprint(room, myFp) !== myFp) return
    addMember(room, fp)
    removePending(room, fp)
    const info = ensureRoomKey(room)!
    const remotePk = getPinnedPublicKey(fp)
    if (remotePk) {
      const body = await encryptDM(id.secretKey, remotePk, JSON.stringify({ keyB64: info.keyB64, keyId: info.keyId }))
      const msg = { type: 'room-key', to: fp, from: myFp, body }
      await publish(nodeRef.current!, room, new TextEncoder().encode(JSON.stringify(msg)))
    }
    refreshMembershipUI()
    setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: `Aprovado ${fp} e enviada chave da sala.`, kind: 'sys' }])
  }

  async function reject(fp: string) {
    if (!id) return
    if (getOwnerFingerprint(room, myFp) !== myFp) return
    removePending(room, fp)
    const msg = { type: 'join-rej', to: fp, from: myFp }
    await publish(nodeRef.current!, room, new TextEncoder().encode(JSON.stringify(msg)))
    refreshMembershipUI()
    setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: `Recusado ${fp}.`, kind: 'sys' }])
  }

  async function kick(fp: string) {
    if (!id) return
    if (getOwnerFingerprint(room, myFp) !== myFp) return
    removeMember(room, fp)
    const info = rotateGroupKey(room)
    setKeyId(info.keyId)

    const node = nodeRef.current!
    for (const m of listMembers(room)) {
      if (m === myFp) continue
      const remotePk = getPinnedPublicKey(m)
      if (!remotePk) continue
      const body = await encryptDM(id.secretKey, remotePk, JSON.stringify({ keyB64: info.keyB64, keyId: info.keyId }))
      const msg = { type: 'room-key', to: m, from: myFp, body }
      await publish(node, room, new TextEncoder().encode(JSON.stringify(msg)))
    }

    refreshMembershipUI()
    setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: `Removido ${fp} e rotacionada chave (keyId=${info.keyId}).`, kind: 'sys' }])
  }

  function onRotateKey() {
    if (!id) return
    if (getOwnerFingerprint(room, myFp) !== myFp) {
      setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: 'Apenas o owner pode rotacionar a chave.', kind: 'sys' }])
      return
    }
    ;(async () => {
      const info = rotateGroupKey(room)
      setKeyId(info.keyId)
      const node = nodeRef.current!
      for (const m of listMembers(room)) {
        if (m === myFp) continue
        const remotePk = getPinnedPublicKey(m)
        if (!remotePk) continue
        const body = await encryptDM(id.secretKey, remotePk, JSON.stringify({ keyB64: info.keyB64, keyId: info.keyId }))
        const msg = { type: 'room-key', to: m, from: myFp, body }
        await publish(node, room, new TextEncoder().encode(JSON.stringify(msg)))
      }
      setLog((l) => [...l, { ts: Date.now(), from: 'sistema', text: 'Rotacionada chave da sala.', kind: 'sys' }])
    })()
  }

  function onBackup() {
    const json = makeBackup()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dechat-backup-${new Date().toISOString().slice(0,19)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function onRestore(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const res = restoreBackup(String(reader.result || ''), 'merge')
      if (res === 'ok') {
        alert('Backup restaurado. Recarregue a página para aplicar identidade/contatos.')
      } else {
        alert('Falha ao restaurar backup.')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          placeholder="sala (tópico)"
          style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: 'white' }}
        />
        <button
          onClick={handleConnect}
          disabled={connecting || connected}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #0ea5e9', background: connected ? '#065f46' : '#0ea5e9', color: 'white' }}
        >
          {connected ? 'Conectado' : (connecting ? 'Conectando…' : 'Entrar')}
        </button>
        <select
          value={targetFp}
          onChange={(e) => setTargetFp(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: 'white' }}
          title="Selecione um contato para enviar DM (E2E). Vazio = sala"
        >
          <option value="">Sala (Group E2E)</option>
          {targets.map((fp) => (
            <option key={fp} value={fp}>{fp}</option>
          ))}
        </select>
        <button onClick={onRotateKey} title="Rotaciona a chave da sala (owner)" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #f59e0b', background: '#f59e0b', color: '#0b0f19' }}>Rotate key</button>
        <button onClick={onBackup} title="Exporta identidade e contatos" style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #334155', background: '#1f2937', color: 'white' }}>Backup</button>
        <label style={{ display: 'inline-block', padding: '10px 14px', borderRadius: 10, border: '1px solid #334155', background: '#1f2937', color: 'white', cursor: 'pointer' }}>
          Restore<input type="file" accept="application/json" onChange={onRestore} style={{ display: 'none' }} />
        </label>
      </div>

      <div style={{ color: '#94a3b8', marginTop: 8, fontSize: 12 }}>
        Owner: <strong>{ownerFp || '—'}</strong> — Membros: <strong>{members.length}</strong> — keyId: <strong>{keyId || '—'}</strong>
      </div>

      {ownerFp === myFp && (
        <div style={{ marginTop: 8, padding: 8, border: '1px dashed #334155', borderRadius: 10 }}>
          <div style={{ color: '#93c5fd', fontSize: 12, marginBottom: 6 }}>Pedidos pendentes</div>
          {pending.length === 0 ? (
            <div style={{ color: '#cbd5e1', fontSize: 12 }}>Nenhum pedido.</div>
          ) : (
            pending.map(p => (
              <div key={p.fp} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ color: 'white' }}>{p.fp}</span>
                <button onClick={() => approve(p.fp)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #16a34a', background: '#16a34a', color: 'white' }}>Aprovar</button>
                <button onClick={() => reject(p.fp)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ef4444', background: '#ef4444', color: 'white' }}>Recusar</button>
              </div>
            ))
          )}

          <div style={{ color: '#93c5fd', fontSize: 12, margin: '8px 0 6px' }}>Membros</div>
          {members.filter(m => m !== myFp).length === 0 ? (
            <div style={{ color: '#cbd5e1', fontSize: 12 }}>Só você na sala.</div>
          ) : (
            members.filter(m => m !== myFp).map(m => (
              <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ color: 'white' }}>{m}</span>
                <button onClick={() => kick(m)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #f59e0b', background: '#f59e0b', color: '#0b0f19' }}>Expulsar</button>
              </div>
            ))
          )}
        </div>
      )}

      <div style={{ marginTop: 16, height: 420, overflowY: 'auto', padding: 12, borderRadius: 10, border: '1px solid #334155', background: '#0b1220' }}>
        {log.map((m, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: m.kind === 'dm' ? '#f59e0b' : m.kind === 'sys' ? '#93c5fd' : '#60a5fa' }}>
              {new Date(m.ts).toLocaleTimeString()} — {m.from} {m.kind === 'dm' ? '(DM)' : m.kind === 'sys' ? '' : ''}
            </div>
            <div style={{ color: 'white' }}>{m.text}</div>
          </div>
        ))}
        {log.length === 0 && (
          <div style={{ color: '#cbd5e1' }}>Sem mensagens. Envie seu pedido de entrada — o owner precisa aprovar para você receber a chave da sala.</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={targetFp ? `DM para ${targetFp}…` : 'Mensagem para a sala (E2E)…'}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: 'white' }}
        />
        <button onClick={send} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #0ea5e9', background: '#0ea5e9', color: 'white' }}>
          Enviar
        </button>
      </div>

      <p style={{ color: '#94a3b8', marginTop: 12, fontSize: 12 }}>
        Minha identidade: <strong>{myFp}</strong>
      </p>
    </div>
  )
}
