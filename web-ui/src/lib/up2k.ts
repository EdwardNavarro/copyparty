/**
 * up2k resumable uploader — port pragmático de copyparty/web/up2k.js + scripts/u2c.py
 * Ref chunksizes: docs/devnotes.md#list-of-chunk-sizes
 */
import { abortUpload, handshake, putChunks, type ApiOpts, type HandshakeRes } from "./api";
import { createSHA512 } from "hash-wasm";

// [maxFilesize, chunksize] — mayor filesize que usa ese chunksize
const TABLE: Array<[number, number]> = [
  [268435456, 1048576],
  [402653184, 1572864],
  [536870912, 2097152],
  [805306368, 3145728],
  [1073741824, 4194304],
  [1610612736, 6291456],
  [2147483648, 8388608],
  [3221225472, 12582912],
  [4294967296, 16777216],
  [6442450944, 25165824],
  [137438953472, 33554432],
  [206158430208, 50331648],
  [274877906944, 67108864],
  [412316860416, 100663296],
  [549755813888, 134217728],
  [824633720832, 201326592],
  [1099511627776, 268435456],
  [1649267441664, 402653184],
  [2199023255552, 536870912],
  [3298534883328, 805306368],
  [4398046511104, 1073741824],
  [6597069766656, 1610612736],
  [8796093022208, 2147483648],
  [13194139533312, 3221225472],
  [17592186044416, 4294967296],
  [26388279066624, 6442450944],
  [35184372088832, 8589934592],
];

export function chunksizeFor(size: number): number {
  for (const [max, cs] of TABLE) if (size <= max) return cs;
  return 8589934592;
}

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function hashChunk(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  // up2k spec: sha512 del chunk, PRIMEROS 33 bytes en b64url sin padding
  // (== 44 chars, ver r_hash ^[0-9a-zA-Z_-]{44}$ en up2k.py:162 y u2c.py digest()[:33])
  const h = await createSHA512();
  h.init();
  h.update(buf);
  const hex = h.digest("hex") as string;
  const raw = new Uint8Array(hex.match(/../g)!.map((x) => parseInt(x, 16))).slice(0, 33);
  return b64url(raw);
}

export async function hashFile(
  file: File,
  onTick?: (done: number, total: number) => void
): Promise<{ hashes: string[]; csize: number }> {
  const csize = chunksizeFor(file.size || 1);
  const n = Math.max(1, Math.ceil(file.size / csize));
  const hashes: string[] = [];
  // hash en paralelo limitado (4 workers lógicos)
  const PAR = 4;
  for (let base = 0; base < n; base += PAR) {
    const batch = [];
    for (let i = base; i < Math.min(base + PAR, n); i++)
      batch.push(
        hashChunk(file.slice(i * csize, Math.min(file.size, (i + 1) * csize)))
      );
    const out = await Promise.all(batch);
    hashes.push(...out);
    onTick?.(hashes.length, n);
  }
  return { hashes, csize };
}

export type UpPhase = "hash" | "up" | "done" | "err" | "cancelled";

export interface UpTask {
  id: number;
  file: File;
  phase: UpPhase;
  /** hashing */
  hashDone: number;
  hashTotal: number;
  /** subida en bytes (tiempo real, suma de chunks en vuelo) */
  bytesDone: number;
  bytesTotal: number;
  /** chunks */
  doneChunks: number;
  totalChunks: number;
  skipped: number; // chunks deduplicados/resumidos por el servidor (need[])
  /** rendimiento */
  speedBps: number;
  etaSec: number | null;
  startedAt: number;
  wark?: string;
  /** nombre final asignado por el servidor (dedup/rand pueden renombrar) */
  finalName?: string;
  err?: string;
}

/** token de cancelación compartido entre UI y uploadFile */
export interface UpCtl {
  cancelled: boolean;
  xhrs: Set<XMLHttpRequest>;
  cancel(): void;
}

export function newUpCtl(): UpCtl {
  const ctl: UpCtl = {
    cancelled: false,
    xhrs: new Set(),
    cancel() {
      ctl.cancelled = true;
      for (const x of ctl.xhrs) try { x.abort(); } catch { /* noop */ }
    },
  };
  return ctl;
}

let nextId = 1;
export function newUpTask(file: File): UpTask {
  return {
    id: nextId++,
    file,
    phase: "hash",
    hashDone: 0,
    hashTotal: 1,
    bytesDone: 0,
    bytesTotal: file.size,
    doneChunks: 0,
    totalChunks: 1,
    skipped: 0,
    speedBps: 0,
    etaSec: null,
    startedAt: Date.now(),
  };
}

function checkCancel(ctl?: UpCtl) {
  if (ctl?.cancelled) throw new Error("upload cancelado");
}

/** upload completo: hash -> handshake -> chunks paralelos (2) -> handshake final.
 *  onTick se llama en cada avance (hash, bytes en vuelo, chunks). Soporta cancel. */
export async function uploadFile(
  vpath: string,
  file: File,
  o: ApiOpts,
  onTick?: (t: UpTask) => void,
  ctl?: UpCtl,
  seed?: UpTask
): Promise<HandshakeRes> {
  const t: UpTask = seed ?? newUpTask(file);
  const emit = () => onTick?.({ ...t });
  emit();

  const { hashes, csize } = await hashFile(file, (d, n) => {
    checkCancel(ctl);
    t.hashDone = d;
    t.hashTotal = n;
    t.totalChunks = n;
    emit();
  });
  checkCancel(ctl);

  t.phase = "up";
  emit();

  let hs = await handshake(
    vpath,
    { name: file.name, size: file.size, lmod: Math.floor(file.lastModified / 1000), hash: hashes },
    o
  );
  checkCancel(ctl);
  t.wark = hs.wark;
  t.finalName = hs.name;
  // `hash` = hashes FALTANTES (strings únicos); [] = dedup, no subir nada.
  // Mapea a índices (primera ocurrencia; los duplicados los rellena el servidor)
  const missSet = new Set<string>(hs.hash ?? hashes);
  const seen = new Set<string>();
  const queue: number[] = [];
  hashes.forEach((h, i) => {
    if (missSet.has(h) && !seen.has(h)) {
      seen.add(h);
      queue.push(i);
    }
  });
  t.skipped = hashes.length - queue.length;
  t.doneChunks = 0;
  // los chunks van a la purl del handshake (URL del dir destino, up2k.py:3495)
  const purl = hs.purl || `${vpath.replace(/\/?$/, "/")}`;
  // FS sin sparse: el servidor rechaza subidas paralelas -> secuencial
  const PAR = hs.sprs === false ? 1 : 2;
  emit();

  const pending = new Set<number>(queue);
  const doneSet = new Set<number>(
    hashes.map((_, i) => i).filter((i) => !pending.has(i))
  );
  const chunkBytes = (idx: number) =>
    Math.min(file.size, (idx + 1) * csize) - idx * csize;
  // progreso por chunk en vuelo -> bytesDone global en tiempo real
  const inflight = new Map<number, number>();
  const recalc = () => {
    let done = 0;
    for (const i of doneSet) done += chunkBytes(i);
    for (const v of inflight.values()) done += v;
    t.bytesDone = Math.min(done, t.bytesTotal);
    const el = Math.max(0.001, (Date.now() - t.startedAt) / 1000);
    t.speedBps = t.bytesDone / el;
    const left = t.bytesTotal - t.bytesDone;
    t.etaSec = t.speedBps > 0 ? left / t.speedBps : null;
  };

  const retry = async (idx: number, tries = 4): Promise<void> => {
    const blob = file.slice(idx * csize, Math.min(file.size, (idx + 1) * csize));
    for (let a = 0; a < tries; a++) {
      checkCancel(ctl);
      try {
        await putChunks(
          purl, hs.wark, [hashes[idx]], blob, o,
          (loaded) => { inflight.set(idx, loaded); recalc(); emit(); },
          (x) => { ctl?.xhrs.add(x); }
        );
        inflight.delete(idx);
        pending.delete(idx);
        doneSet.add(idx);
        t.doneChunks++;
        recalc();
        emit();
        return;
      } catch (e) {
        inflight.delete(idx);
        if (ctl?.cancelled) throw new Error("upload cancelado");
        if (a === tries - 1) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** a));
      }
    }
  };
  // cola inmutable: iterar `pending` mientras retry() lo mutaba saltaba chunks
  // con 3+ chunks -> el servidor nunca hacía commit (quedaba .PARTIAL + 0B)
  // NOTA: no usar .map(retry) — map pasa (valor, índice) y el índice
  // caería en el parámetro `tries`, saltando chunks en silencio (el chunk
  // en posición 0 recibía tries=0 y nunca se subía -> .PARTIAL eterno)
  try {
    for (let i = 0; i < queue.length; i += PAR)
      await Promise.all(queue.slice(i, i + PAR).map((idx) => retry(idx)));
  } catch (e) {
    // best-effort: avisa al servidor para limpiar el .PARTIAL
    if (t.wark) void abortUpload(vpath, t.wark, o);
    throw e;
  }

  const hsBody = {
    name: file.name,
    size: file.size,
    lmod: Math.floor(file.lastModified / 1000),
    hash: hashes,
  };
  const mapMissing = (h: HandshakeRes): number[] => {
    const ms = new Set<string>(h.hash ?? []);
    const sn = new Set<string>();
    const q: number[] = [];
    hashes.forEach((hh, i) => {
      if (ms.has(hh) && !sn.has(hh)) {
        sn.add(hh);
        q.push(i);
      }
    });
    return q;
  };
  // handshake final: el servidor confirma commit (hash vacío) o pide reintentos
  hs = await handshake(vpath, hsBody, o);
  t.finalName = hs.name;
  if (hs.hash && hs.hash.length) {
    // recheck: sube lo que falte y confirma una vez más (como u2c.py)
    for (const idx of mapMissing(hs)) {
      pending.delete(idx);
      doneSet.delete(idx);
    }
    t.doneChunks = doneSet.size;
    recalc();
    emit();
    const missing = mapMissing(hs);
    for (let i = 0; i < missing.length; i += PAR)
      await Promise.all(missing.slice(i, i + PAR).map((idx) => retry(idx)));
    hs = await handshake(vpath, hsBody, o);
    t.finalName = hs.name;
  }
  if (hs.hash && hs.hash.length)
    throw new Error(
      `el servidor no confirmó la subida (faltan ${hs.hash.length} chunks)`
    );
  t.phase = "done";
  t.bytesDone = t.bytesTotal;
  t.doneChunks = t.totalChunks;
  t.speedBps = t.bytesTotal / Math.max(0.001, (Date.now() - t.startedAt) / 1000);
  t.etaSec = 0;
  emit();
  return hs;
}
