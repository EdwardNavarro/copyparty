/**
 * Cliente desacoplado sobre el HTTP API de copyparty.
 * Ref: docs/devnotes.md#http-api + copyparty/httpcli.py
 *
 * Auth: SOLO cookie HttpOnly (cppwd/cppws).
 *   login  = POST multipart act=login {uname?, cppwd} -> Set-Cookie (navegador la guarda)
 *   logout = POST multipart act=logout -> limpia cookie
 * Todos los fetch llevan `credentials:"include"` para enviar la cookie.
 * Sin Jinja, sin SSR: solo GET ?ls/?tree + jPOST ?srch + handshake up2k.
 */

export type Perms = string[];

export interface LsEntry {
  href: string; // "foo/bar.mp4" o "subdir/"
  sz: number;
  ts: number;
  ext?: string;
  lead?: string;
  tags?: Record<string, string | number>;
  perms?: Perms;
}

export interface LsResponse {
  dirs: LsEntry[];
  files: LsEntry[];
  taglist?: string[];
  tag_order?: string[];
  acct?: string;
  perms?: Perms;
  srvinf?: string;
  fnugg?: string;
  dk?: string;
  cfg?: Record<string, any>;
  logues?: string[];
  readmes?: string[];
}

export interface SearchHit {
  rp: string; // real path / vpath
  sz: number;
  ts: number;
  tags?: Record<string, string | number>;
}

export interface SearchResponse {
  hits: SearchHit[];
  tag_order: string[];
  trunc?: boolean;
}

export interface HandshakeReq {
  name: string;
  size: number;
  lmod?: number;
  hash: string[]; // sha512 chunks b64url
  sprs?: boolean;
}

export interface HandshakeRes {
  wark: string;
  /** hashes (strings b64url) que FALTAN por subir, únicos y en orden;
   *  [] = dedup/resume completo, no subir nada (up2k.py:3465-3504) */
  hash: string[];
  name: string; // nombre FINAL (el servidor puede renombrar: dedup/rand)
  purl: string; // URL dir destino para los chunks (normalmente el mismo dir)
  size: number;
  lmod?: number;
  sprs?: boolean; // false = FS sin sparse -> subir secuencial (PAR=1)
  dwrk?: string;
  fk?: string;
}

export interface ApiOpts {
  base?: string; // default "" (same-origin) o VITE_CPR_BASE en dev
  dirKey?: string; // ?k= file/dir accesskey para shares (fk/dk); no es auth
}

export const IDP_LOGIN: string =
  (import.meta as any).env?.VITE_IDP_LOGIN
    ? String((import.meta as any).env.VITE_IDP_LOGIN)
    : ""; // ej. "https://auth.example.com/login?dst={dst}" (Authentik); {dst}=ruta actual

const BASE = () =>
  (import.meta as any).env?.VITE_CPR_BASE
    ? String((import.meta as any).env.VITE_CPR_BASE).replace(/\/$/, "")
    : "";

function authQuery(o: ApiOpts): string {
  const q: string[] = [];
  if (o.dirKey) q.push(`k=${encodeURIComponent(o.dirKey)}`);
  return q.length ? `&${q.join("&")}` : "";
}

function headers(_o: ApiOpts, extra: Record<string, string> = {}) {
  return { ...extra };
}

/** fetch con cookie de sesión incluida */
function cf(url: string, init: RequestInit = {}) {
  return fetch(url, { credentials: "include", ...init });
}

export function isAuthError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /auth: 40[13]/.test(m);
}

async function chk(r: Response): Promise<Response> {
  if (r.status === 401) throw new Error("auth: 401 login requerido");
  if (r.status === 403) throw new Error("auth: 403 sin permiso");
  if (!r.ok) throw new Error(`http ${r.status} ${r.statusText}`);
  return r;
}

export function joinUrl(base: string, path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  return `${base}${path}`;
}

/** GET /ruta?ls[&dots] -> JSON */
export async function fetchLs(
  vpath: string,
  o: ApiOpts = {},
  dots = false
): Promise<LsResponse> {
  const base = o.base ?? BASE();
  const url = `${joinUrl(base, vpath)}?ls${dots ? "&dots" : ""}${authQuery(o)}`;
  const r = await chk(
    await cf(url, { headers: headers(o, { Fnugg: "x" }) })
  );
  return (await r.json()) as LsResponse;
}

/** GET /ruta?tree=top */
export async function fetchTree(
  vpath: string,
  o: ApiOpts = {}
): Promise<Record<string, any>> {
  const base = o.base ?? BASE();
  const top = vpath.split("/").filter(Boolean)[0] ?? "";
  const url = `${joinUrl(base, vpath)}?tree=${encodeURIComponent(
    top
  )}${authQuery(o)}`;
  const r = await chk(await cf(url, { headers: headers(o) }));
  return (await r.json()) as Record<string, any>;
}

/** jPOST /?srch {"q","n"} */
export async function search(
  q: string,
  n = 200,
  o: ApiOpts = {}
): Promise<SearchResponse> {
  const base = o.base ?? BASE();
  const r = await chk(
    await cf(`${base}/?srch${authQuery(o)}`, {
      method: "POST",
      headers: headers(o, { "Content-Type": "text/plain" }),
      body: JSON.stringify({ q, n }),
    })
  );
  return (await r.json()) as SearchResponse;
}

/** handshake up2k: POST /ruta JSON {name,size,hash[]} */
export async function handshake(
  vpath: string,
  req: HandshakeReq,
  o: ApiOpts = {}
): Promise<HandshakeRes> {
  const base = o.base ?? BASE();
  const url = joinUrl(base, vpath) + authQuery(o).replace(/^&/, "?");
  const r = await chk(
    await cf(url, {
      method: "POST",
      headers: headers(o, { "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    })
  );
  return (await r.json()) as HandshakeRes;
}

/** upload 1+ chunks contiguos a la `purl` del handshake:
 *  POST octet-stream + X-Up2k-Hash/X-Up2k-Wark (nombres exactos de u2c.py).
 *  Devuelve función abort() para cancelar el XHR en vuelo. */
export function putChunks(
  purl: string,
  wark: string,
  hashes: string[],
  blob: Blob,
  o: ApiOpts = {},
  onProgress?: (loaded: number, total: number) => void,
  onXhr?: (x: XMLHttpRequest) => void
): Promise<void> {
  const base = o.base ?? BASE();
  const url = joinUrl(base, purl) + authQuery(o).replace(/^&/, "?");
  // fetch no da upload-progress; XHR sí — usamos XHR para progress real
  return new Promise<void>((res, rej) => {
    const x = new XMLHttpRequest();
    x.open("POST", url);
    x.withCredentials = true; // envía cppwd/cppws
    const h = headers(o);
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.setRequestHeader("X-Up2k-Wark", wark);
    x.setRequestHeader("X-Up2k-Hash", hashes.join(","));
    for (const [k, v] of Object.entries(h)) x.setRequestHeader(k, v);
    onXhr?.(x);
    x.upload.onprogress = (e) =>
      onProgress?.(e.loaded, e.total || blob.size);
    x.onload = () =>
      x.status >= 200 && x.status < 300
        ? res()
        :rej(new Error(
          x.status === 401 ? "auth: 401 login requerido"
          : x.status === 403 ? "auth: 403 sin permiso"
          : `chunk http ${x.status}`));
    x.onabort = () => rej(new Error("upload cancelado"));
    x.onerror = () => rej(new Error("chunk network error"));
    x.send(blob);
  });
}

/** aborta un upload incompleto en servidor: POST ?fs_abrt=<wark> (httpcli.py:2513) */
export async function abortUpload(vpath: string, wark: string, o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  try {
    await cf(`${joinUrl(base, vpath)}?fs_abrt=${encodeURIComponent(wark)}${authQuery(o)}`, {
      method: "POST",
    });
  } catch { /* best-effort */ }
}

/** URLs de thumbs/transcode: GET /f?th=j/w/p/opus */
export function thumbUrl(
  fileUrl: string,
  kind: "j" | "w" | "p" | "opus" | "caf" | "ico" = "j",
  o: ApiOpts = {}
): string {
  const base = o.base ?? BASE();
  return `${base}${fileUrl}?th=${kind}${authQuery(o)}`;
}

export const dlUrl = (fileUrl: string, o: ApiOpts = {}) =>
  `${o.base ?? BASE()}${fileUrl}?dl${authQuery(o)}`;

export const rawUrl = (fileUrl: string, o: ApiOpts = {}) =>
  `${o.base ?? BASE()}${fileUrl}${authQuery(o).replace(/^&/, "?")}`;

/** mutaciones */
export async function mkdir(vpath: string, name: string, o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  const fd = new FormData();
  fd.append("act", "mkdir");
  fd.append("name", name);
  const r = await chk(
    await cf(joinUrl(base, vpath), {
      method: "POST",
      headers: headers(o),
      body: fd,
    })
  );
  return r;
}

export async function rm(paths: string[], o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  // el ?ls devuelve hrefs URL-codificados (%28...), pero el body JSON de
  // ?delete lleva vpaths CRUDOS: el servidor no decodifica (handle_rm pasa
  // req tal cual al broker -> 400 "file not found" si va codificado)
  const raw = paths.map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const r = await chk(
    await cf(`${base}/?delete${authQuery(o)}`, {
      method: "POST",
      headers: headers(o, { "Content-Type": "application/json" }),
      body: JSON.stringify(raw),
    })
  );
  return r.json().catch(() => ({}));
}

export async function mv(src: string, dst: string, o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  const r = await chk(
    await cf(`${base}${src}?move=${encodeURIComponent(dst)}${authQuery(o)}`, {
      method: "POST",
      headers: headers(o),
    })
  );
  return r;
}

export async function cp(src: string, dst: string, o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  const r = await chk(
    await cf(`${base}${src}?copy=${encodeURIComponent(dst)}${authQuery(o)}`, {
      method: "POST",
      headers: headers(o),
    })
  );
  return r;
}

/** admin: ?scan / ?reload=cfg / ?stack (requiere perm `a`) */
export async function admin(action: "scan" | "reload" | "stack", o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  const q =
    action === "reload" ? "?reload=cfg" : action === "scan" ? "?scan" : "?stack";
  const r = await chk(
    await cf(`${base}/${q}${authQuery(o)}`, { headers: headers(o) })
  );
  return r.text();
}

/* ---------- sesión cookie HttpOnly ---------- */

/** probe de identidad: ?ls mínimo; acct=="*" = anónimo */
export async function me(o: ApiOpts = {}): Promise<{ acct: string; perms: Perms }> {
  const ls = await fetchLs("/", o);
  return { acct: ls.acct ?? "*", perms: ls.perms ?? [] };
}

/**
 * login: POST multipart act=login {uname?, cppwd} (httpcli.py:3641).
 * El servidor responde HTML (msg) con "hi <user>" o "naw dude" + Set-Cookie
 * HttpOnly SameSite=Lax; el navegador la guarda SOLO si es mismo-origen
 * (proxy de vite). Verificamos con ?ls.
 */
export async function login(
  vpath: string,
  password: string,
  uname = "",
  o: ApiOpts = {}
): Promise<{ acct: string; perms: Perms }> {
  if (!password) throw new Error("password vacío");
  const base = o.base ?? BASE();
  if (base) {
    // cross-origin + cookie SameSite=Lax: el fetch nunca reenvía la cookie,
    // el login no puede funcionar; fallar rápido con mensaje accionable
    throw new Error(
      "auth: modo cross-origin (VITE_CPR_BASE) incompatible con login cookie — " +
      "quita VITE_CPR_BASE y usa el proxy mismo-origen (`npm run dev`)"
    );
  }
  const fd = new FormData();
  fd.append("act", "login");
  if (uname) fd.append("uname", uname);
  fd.append("cppwd", password);
  const r = await cf(joinUrl(base, vpath || "/"), { method: "POST", body: fd });
  const txt = await r.text();
  if (/naw dude/i.test(txt))
    throw new Error("auth: login incorrecto (password o usuario mal)");
  // la cookie ya quedó guardada (o no, si el navegador la bloqueó); el probe lo confirma
  const s = await me(o);
  if (s.acct === "*")
    throw new Error(
      "auth: el servidor aceptó el login pero la cookie no volvió — " +
      "¿modo cross-origin? usa el proxy mismo-origen (`npm run dev` sin VITE_CPR_BASE)"
    );
  return s;
}

/** logout: POST multipart act=logout (httpcli.py:3682) — limpia cookie */
export async function logout(vpath: string, o: ApiOpts = {}) {
  const base = o.base ?? BASE();
  const fd = new FormData();
  fd.append("act", "logout");
  try {
    await cf(joinUrl(base, vpath || "/"), { method: "POST", body: fd });
  } catch { /* best-effort */ }
}
