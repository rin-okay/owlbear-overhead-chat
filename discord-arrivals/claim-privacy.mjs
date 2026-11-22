export const PRIVATE_CLAIM = "chat.overhead.discord-arrivals/private-claim.v1";
export const CLAIM_KEY_REQUEST = PRIVATE_CLAIM + "/key-request";
export const CLAIM_KEY = PRIVATE_CLAIM + "/key";

const rsa = {name:"RSA-OAEP", hash:"SHA-256"};
const encode = (value) => btoa(String.fromCharCode(...new Uint8Array(value)));
function decode(value, max) {
  if (typeof value !== "string" || value.length > max) throw Error("Invalid sign-in envelope.");
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function makeClaimKey() {
  const pair = await crypto.subtle.generateKey({
    ...rsa, modulusLength:2048, publicExponent:new Uint8Array([1,0,1]),
  }, false, ["encrypt","decrypt"]);
  const jwk = await crypto.subtle.exportKey("jwk",pair.publicKey);
  return { privateKey:pair.privateKey, publicKey:{kty:jwk.kty, n:jwk.n, e:jwk.e} };
}

export async function encryptClaim(ticket, publicKey) {
  if (publicKey?.kty !== "RSA" || !/^[\w-]{342}$/.test(publicKey.n) || publicKey.e !== "AQAB") {
    throw Error("Invalid GM key.");
  }
  const recipient = await crypto.subtle.importKey("jwk",publicKey,rsa,false,["encrypt"]);
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw",seed,"AES-GCM",false,["encrypt"]);
  const [wrapped, ciphertext] = await Promise.all([
    crypto.subtle.encrypt(rsa,recipient,seed),
    crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(ticket)),
  ]);
  return { wrapped:encode(wrapped), iv:encode(iv), ciphertext:encode(ciphertext) };
}

export async function decryptClaim(envelope, privateKey) {
  const wrapped = decode(envelope?.wrapped,344);
  const iv = decode(envelope?.iv,16);
  const ciphertext = decode(envelope?.ciphertext,5500);
  if (wrapped.length !== 256 || iv.length !== 12) throw Error("Invalid sign-in envelope.");
  const seed = await crypto.subtle.decrypt(rsa,privateKey,wrapped);
  const key = await crypto.subtle.importKey("raw",seed,"AES-GCM",false,["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ciphertext));
}
