export const metadata = {
  title: 'meshed P2P',
  description: 'Mensagens P2P com libp2p + WebRTC',
}

import '@/styles/globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <head>
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0ea5e9" />
      </head>
      <body>{children}</body>
    </html>
  )
}
