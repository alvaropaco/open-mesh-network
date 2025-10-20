import nacl from 'tweetnacl'
import { b64ToU8, u8ToB64 } from '@/lib/identity'

const LS_ROOM_KEY = (room: string) => `meshed:room:${room}:key`
const LS_ROOM_KEYID = (room: string) => `meshed:room:${room}:keyid`
const LS_ROOM_MEMBERS = (room: string) => `meshed:room:${room}:members`
const LS_ROOM_PENDING = (room: string) => `meshed:room:${room}:pending`

export type RoomKeyInfo = { keyB64: string; keyId: string }

export function listMembers(room: string): Set<string> {
  try {
    const raw = localStorage.getItem(LS_ROOM_MEMBERS(room))
    const arr: string[] = raw ? JSON.parse(raw) : []
    return new Set(arr)
  } catch { return new Set() }
}

function saveMembers(room: string, set: Set<string>) {
  localStorage.setItem(LS_ROOM_MEMBERS(room), JSON.stringify(Array.from(set)))
}

export function addMember(room: string, fp: string) {
  const s = listMembers(room)
  if (!s.has(fp)) { s.add(fp); saveMembers(room, s) }
}

export function removeMember(room: string, fp: string) {
  const s = listMembers(room)
  if (s.delete(fp)) saveMembers(room, s)
}

export function listPending(room: string): Set<string> {
  try {
    const raw = localStorage.getItem(LS_ROOM_PENDING(room))
    const arr: string[] = raw ? JSON.parse(raw) : []
    return new Set(arr)
  } catch { return new Set() }
}

function savePending(room: string, set: Set<string>) {
  localStorage.setItem(LS_ROOM_PENDING(room), JSON.stringify(Array.from(set)))
}

export function addPending(room: string, fp: string) {
  const s = listPending(room)
  if (!s.has(fp)) { s.add(fp); savePending(room, s) }
}

export function removePending(room: string, fp: string) {
  const s = listPending(room)
  if (s.delete(fp)) savePending(room, s)
}

export function getOwnerFingerprint(room: string, selfFp: string): string {
  const s = listMembers(room)
  s.add(selfFp)
  return Array.from(s).sort()[0]
}

export function getGroupKey(room: string): RoomKeyInfo | null {
  const keyB64 = localStorage.getItem(LS_ROOM_KEY(room))
  const keyId = localStorage.getItem(LS_ROOM_KEYID(room))
  if (!keyB64 || !keyId) return null
  return { keyB64, keyId }
}

export function ensureRoomKey(room: string): RoomKeyInfo | null {
  const cur = getGroupKey(room)
  if (cur) return cur
  const rnd = nacl.randomBytes(32)
  const keyB64 = u8ToB64(rnd)
  const keyId = `${Date.now()}`
  localStorage.setItem(LS_ROOM_KEY(room), keyB64)
  localStorage.setItem(LS_ROOM_KEYID(room), keyId)
  return { keyB64, keyId }
}

export function setGroupKeyFromOwner(room: string, keyB64: string, keyId: string) {
  localStorage.setItem(LS_ROOM_KEY(room), keyB64)
  localStorage.setItem(LS_ROOM_KEYID(room), keyId)
}

export function rotateGroupKey(room: string): RoomKeyInfo {
  const rnd = nacl.randomBytes(32)
  const keyB64 = u8ToB64(rnd)
  const keyId = `${Date.now()}`
  localStorage.setItem(LS_ROOM_KEY(room), keyB64)
  localStorage.setItem(LS_ROOM_KEYID(room), keyId)
  return { keyB64, keyId }
}

export function getCurrentKeyId(room: string): string | null {
  return localStorage.getItem(LS_ROOM_KEYID(room))
}

export function encryptGroup(room: string, text: string): { body: string; keyId: string } | null {
  const info = getGroupKey(room)
  if (!info) return null
  const nonce = nacl.randomBytes(24)
  const key = b64ToU8(info.keyB64)
  const msg = new TextEncoder().encode(text)
  const box = nacl.secretbox(msg, nonce, key)
  return { body: JSON.stringify({ n: u8ToB64(nonce), b: u8ToB64(box) }), keyId: info.keyId }
}

export function decryptGroup(room: string, serialized: string, keyId: string): string {
  const cur = getGroupKey(room)
  if (!cur || cur.keyId !== keyId) throw new Error('Chave de grupo desconhecida ou desatualizada')
  const { n, b } = JSON.parse(serialized)
  const nonce = b64ToU8(n)
  const box = b64ToU8(b)
  const key = b64ToU8(cur.keyB64)
  const out = nacl.secretbox.open(box, nonce, key)
  if (!out) throw new Error('Falha ao decifrar grupo')
  return new TextDecoder().decode(out)
}
