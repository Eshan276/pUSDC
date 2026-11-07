// Encrypted key storage. A random data key encrypts the seed phrase; that data key is wrapped separately under the
// password and (optionally) under a duress PIN, so either secret opens the vault but they lead to different behaviour.
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER = 600_000;

type Sealed = { iv: string; ct: string };
type Wrap = Sealed & { salt: string };
export type VaultRecord = { v: 1; pw: Wrap; duress?: Wrap; body: Sealed };

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function kek(pin: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function seal(key: CryptoKey, data: Uint8Array): Promise<Sealed> {
  const iv = rand(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource));
  return { iv: b64(iv), ct: b64(ct) };
}
const open = async (key: CryptoKey, s: Sealed) =>
  new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(s.iv) as BufferSource }, key, unb64(s.ct) as BufferSource));

async function wrapKey(pin: string, raw: Uint8Array): Promise<Wrap> {
  const salt = rand(16);
  return { salt: b64(salt), ...(await seal(await kek(pin, salt), raw)) };
}
const unwrapKey = async (pin: string, w: Wrap) => open(await kek(pin, unb64(w.salt)), w);
const dataKeyFrom = (raw: Uint8Array) => crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);

export async function createVault(mnemonic: string, password: string): Promise<VaultRecord> {
  const raw = rand(32);
  return { v: 1, pw: await wrapKey(password, raw), body: await seal(await dataKeyFrom(raw), enc.encode(mnemonic)) };
}

export async function addDuress(rec: VaultRecord, password: string, duressPin: string): Promise<VaultRecord> {
  if (duressPin === password) throw new Error("The emergency PIN must be different from your password.");
  const raw = await unwrapKey(password, rec.pw).catch(() => {
    throw new Error("Wrong password.");
  });
  return { ...rec, duress: await wrapKey(duressPin, raw) };
}

export async function unlockVault(rec: VaultRecord, pin: string): Promise<{ mode: "normal" | "duress"; mnemonic: string } | null> {
  for (const [mode, w] of [["normal", rec.pw], ["duress", rec.duress]] as const) {
    if (!w) continue;
    try {
      const raw = await unwrapKey(pin, w);
      return { mode, mnemonic: dec.decode(await open(await dataKeyFrom(raw), rec.body)) };
    } catch {
      /* wrong secret for this slot */
    }
  }
  return null;
}

export async function changePassword(rec: VaultRecord, oldPassword: string, newPassword: string): Promise<VaultRecord> {
  if (rec.duress && (await unwrapKey(newPassword, rec.duress).then(() => true, () => false)))
    throw new Error("Your new password can't be the same as your emergency PIN.");
  const raw = await unwrapKey(oldPassword, rec.pw).catch(() => {
    throw new Error("Your current password isn't right.");
  });
  return { ...rec, pw: await wrapKey(newPassword, raw) };
}
