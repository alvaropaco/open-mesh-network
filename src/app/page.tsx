'use client'

import Chat from '@/components/Chat'

export default function Page() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      background: 'linear-gradient(180deg, #0b0f19, #101827)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 880,
        padding: 16,
        borderRadius: 16,
        background: 'rgba(255,255,255,0.04)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.08)'
      }}>
        <h1 style={{ color: 'white', margin: 0 }}>DeChat P2P</h1>
        <p style={{ color: '#93c5fd', marginTop: 8 }}>
          Troque mensagens diretamente entre navegadores, sem servidor central.
        </p>
        <Chat />
      </div>
    </main>
  )
}
