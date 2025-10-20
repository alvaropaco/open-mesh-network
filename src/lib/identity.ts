import nacl from 'tweetnacl'

const LS_KEY = 'meshed:id'
const LS_CONTACTS = 'meshed:contacts'

export type Identity = { publicKey: Uint8Array; secretKey: Uint8Array }
export type Contacts = Record<string, string> // fp -> pkB64

export function b64ToU8(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}
export function u8ToB64(buf: Uint8Array) {
  return btoa(Array.from(buf).map((b) => String.fromCharCode(b)).join(''))
}

export function getOrCreateIdentity(): Identity {
  if (typeof window === 'undefined') throw new Error('identity only in browser')
  const saved = localStorage.getItem(LS_KEY)
  if (saved) {
    const obj = JSON.parse(saved)
    return { publicKey: b64ToU8(obj.publicKey), secretKey: b64ToU8(obj.secretKey) }
  }
  const kp = nacl.box.keyPair()
  const ident = { publicKey: kp.publicKey, secretKey: kp.secretKey }
  localStorage.setItem(LS_KEY, JSON.stringify({ publicKey: u8ToB64(kp.publicKey), secretKey: u8ToB64(kp.secretKey) }))
  return ident
}

export function fingerprint(pk: Uint8Array): string {
  return `pk_${u8ToB64(pk).slice(0, 10)}`
}

function loadContacts(): Contacts {
  try {
    const raw = localStorage.getItem(LS_CONTACTS)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
function saveContacts(c: Contacts) {
  localStorage.setItem(LS_CONTACTS, JSON.stringify(c))
}

export function listContacts(): string[] {
  const c = loadContacts()
  return Object.keys(c)
}

export function getPinnedPublicKey(fp: string): Uint8Array | null {
  const c = loadContacts()
  const b64 = c[fp]
  return b64 ? b64ToU8(b64) : null
}

export function addOrVerifyContact(fp: string, pk: Uint8Array): 'added' | 'exists' | 'mismatch' {
  const c = loadContacts()
  const calc = fingerprint(pk)
  if (calc !== fp) return 'mismatch'
  if (!c[fp]) {
    c[fp] = u8ToB64(pk)
    saveContacts(c)
    return 'added'
  }
  if (c[fp] !== u8ToB64(pk)) {
    return 'mismatch'
  }
  return 'exists'
}

export function deriveSharedKey(mySecretKey: Uint8Array, remotePublicKey: Uint8Array): Uint8Array {
  return nacl.box.before(remotePublicKey, mySecretKey)
}

export async function encryptDM(mySecretKey: Uint8Array, remotePublicKey: Uint8Array, text: string): Promise<string> {
  const nonce = nacl.randomBytes(24)
  const shared = deriveSharedKey(mySecretKey, remotePublicKey)
  const msg = new TextEncoder().encode(text)
  const box = nacl.secretbox(msg, nonce, shared)
  return JSON.stringify({ n: u8ToB64(nonce), b: u8ToB64(box) })
}

export async function decryptDM(mySecretKey: Uint8Array, senderPublicKey: Uint8Array, serialized: string): Promise<string> {
  const { n, b } = JSON.parse(serialized)
  const nonce = b64ToU8(n)
  const box = b64ToU8(b)
  const shared = deriveSharedKey(mySecretKey, senderPublicKey)
  const out = nacl.secretbox.open(box, nonce, shared)
  if (!out) throw new Error('Falha ao decifrar DM')
  return new TextDecoder().decode(out)
}

// Backup/Restore
export type BackupFile = {
  version: 1
  identity: { publicKey: string; secretKey: string }
  contacts: Contacts
}

export function makeBackup(): string {
  const idRaw = localStorage.getItem(LS_KEY)
  const contactsRaw = localStorage.getItem(LS_CONTACTS) || '{}'
  const payload: BackupFile = {
    version: 1,
    identity: idRaw ? JSON.parse(idRaw) : { publicKey: '', secretKey: '' },
    contacts: JSON.parse(contactsRaw),
  }
  return JSON.stringify(payload, null, 2)
}

export function restoreBackup(json: string, mode: 'merge' | 'replace' = 'merge'): 'ok' | 'error' {
  try {
    const data = JSON.parse(json) as BackupFile
    if (data.version !== 1) throw new Error('versão inválida')
    if (mode === 'replace') {
      localStorage.clear()
    }
    if (data.identity?.publicKey && data.identity?.secretKey) {
      localStorage.setItem(LS_KEY, JSON.stringify(data.identity))
    }
    const current = loadContacts()
    const merged: Contacts = mode === 'merge' ? { ...current, ...data.contacts } : data.contacts
    saveContacts(merged)
    return 'ok'
  } catch (e) {
    console.error('restoreBackup', e)
    return 'error'
  }
}
