/** @type {import('next').NextConfig} */
import withPWA from 'next-pwa'

const isProd = process.env.NODE_ENV === 'production'

const nextConfig = withPWA({
  dest: 'public',
  disable: !isProd,
})({
  reactStrictMode: true,

})

export default nextConfig
