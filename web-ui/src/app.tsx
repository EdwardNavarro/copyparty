import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  IDP_LOGIN,
  cp,
  dlUrl,
  fetchLs,
  isAuthError,
  login,
  logout,
  me,
  mkdir,
  mv,
  rawUrl,
  rm,
  search,
  thumbUrl,
  type LsEntry,
  type LsResponse,
  type SearchResponse,
} from "./lib/api";
import { newUpCtl, newUpTask, uploadFile, type UpTask } from "./lib/up2k";
import { useUi, useUps } from "./store";
import "./app.css";

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} K` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} M` : `${(n / 1073741824).toFixed(2)} G`;
const fmtSpeed = (bps: number) =>
  !bps ? "—" : bps < 1048576 ? `${(bps / 1024).toFixed(0)} KiB/s` : `${(bps / 1048576).toFixed(1)} MiB/s`;
const fmtEta = (s: number | null) =>
  s === null || !isFinite(s) ? "—" : s < 1 ? "finishing…" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const isImg = (h: string) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(h);
const isVid = (h: string) => /\.(mp4|webm|ogv|mov|mkv)$/i.test(h);
const isAud = (h: string) => /\.(mp3|opus|ogg|flac|wav|m4a)$/i.test(h);

/** el backend mete HTML en srvinf ("srv</span> // <span>66 GiB free")
 *  pensado para su UI vieja: lo reducimos a texto [nombre, espacio] */
function cleanSrvInf(srvinf?: string): [string, string] {
  if (!srvinf) return ["", ""];
  const txt = srvinf.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  const [name = "", free = ""] = txt.split("//").map((s) => s.trim());
  return [name, free];
}

/** perms del ?ls (read/write/...) -> letra corta estilo volflags (rwmda.) */
const PERM_SHORT: Record<string, string> = {
  read: "r", write: "w", move: "m", delete: "d", get: "g",
  upget: "G", html: "h", dots: ".", admin: "a",
};

function PermChips({ perms }: { perms: string[] }) {
  if (!perms.length) return <span class="mut">sin permisos</span>;
  return (
    <span class="perms" title={perms.join(", ")}>
      {perms.map((p) => (
        <b key={p} class="perm" title={p}>{PERM_SHORT[p] ?? p.slice(0, 1)}</b>
      ))}
    </span>
  );
}

function StatusBar({ data }: { data: LsResponse }) {
  const { vpath } = useUi();
  const [srvName, srvFree] = cleanSrvInf(data.srvinf);
  return (
    <footer class="status">
      <span class="st-path" title={vpath}>📁 {decodeURIComponent(vpath)}</span>
      <span class="mut">{data.dirs.length} dirs · {data.files.length} files</span>
      {srvName && <span class="mut">{srvName}</span>}
      {srvFree && <span class="mut">{srvFree}</span>}
      <PermChips perms={data.perms ?? []} />
    </footer>
  );
}

function useLs() {
  const { vpath, auth, dots, setSession } = useUi();
  const [data, setData] = useState<LsResponse | null>(null);
  const [err, setErr] = useState("");
  const [authErr, setAuthErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    setAuthErr(false);
    try {
      const ls = await fetchLs(vpath, auth, dots);
      setData(ls);
      setSession(ls.acct ?? "*", ls.perms ?? []);
    } catch (e: any) {
      const msg = e.message || String(e);
      setErr(msg);
      // 401/403 -> lo muestra LoginPage (no abrir el modal encima)
      if (isAuthError(e)) setAuthErr(true);
    } finally {
      setLoading(false);
    }
  }, [vpath, auth, dots, setSession]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, err, authErr, loading, reload: load };
}

function Crumbs() {
  const { vpath, setVpath } = useUi();
  const parts = useMemo(() => vpath.split("/").filter(Boolean), [vpath]);
  return (
    <nav class="crumbs">
      <button onClick={() => setVpath("/")}>/</button>
      {parts.map((p, i) => {
        const to = "/" + parts.slice(0, i + 1).join("/") + "/";
        return (
          <span key={to}>
            <span class="sep">/</span>
            <button onClick={() => setVpath(to)}>{decodeURIComponent(p)}</button>
          </span>
        );
      })}
    </nav>
  );
}

/** form login cookie HttpOnly: POST multipart act=login (ver splash.html) */
function LoginForm({ onDone }: { onDone: () => void }) {
  const { vpath } = useUi();
  const [uname, setUname] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e?: Event) => {
    e?.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const s = await login(vpath, pw, uname, useUi.getState().auth);
      useUi.getState().setSession(s.acct, s.perms);
      useUi.getState().setLoginOpen(false);
      setPw("");
      onDone();
    } catch (ex: any) {
      setErr(ex.message || String(ex));
    } finally {
      setBusy(false);
    }
  };
  const idpHref = IDP_LOGIN
    ? IDP_LOGIN.replace("{dst}", encodeURIComponent(location.pathname + location.hash))
    : "";
  return (
    <>
      <p class="mut">La sesión se guarda en cookie HttpOnly del navegador (no accesible desde JS).</p>
      <p class="mut small">modo: {useUi.getState().auth.base ? `⚠️ directo cross-origin (${useUi.getState().auth.base}) — el login no funcionará` : "✅ proxy mismo-origen"}</p>
      <form onSubmit={submit}>
        <input placeholder="usuario (vacío si solo hay password)" value={uname}
          onInput={(e) => setUname((e.target as HTMLInputElement).value)} autocomplete="username" />
        <input type="password" placeholder="password" value={pw}
          onInput={(e) => setPw((e.target as HTMLInputElement).value)} autocomplete="current-password" />
        {err && <p class="err">{err}</p>}
        <div class="row-btns">
          <button type="submit" disabled={busy || !pw}>{busy ? "…" : "entrar"}</button>
          {idpHref && <a class="btn" href={idpHref}>entrar con SSO (IdP)</a>}
        </div>
      </form>
      {!IDP_LOGIN && <p class="mut small">SSO/Authentik: define VITE_IDP_LOGIN="https://auth…?dst={'{dst}'}" para activar el botón.</p>}
    </>
  );
}

function LoginModal({ onDone }: { onDone: () => void }) {
  return (
    <div class="modal" onClick={() => useUi.getState().setLoginOpen(false)}>
      <div class="card login" onClick={(e) => e.stopPropagation()}>
        <header><b>🔐 login</b><button onClick={() => useUi.getState().setLoginOpen(false)}>✕</button></header>
        <LoginForm onDone={onDone} />
      </div>
    </div>
  );
}

/** página completa cuando el servidor exige auth (401/403 en ?ls) */
function LoginPage({ onDone }: { onDone: () => void }) {
  const { vpath } = useUi();
  return (
    <div class="login-page">
      <div class="card login big">
        <b class="logo">copyparty <span>next</span></b>
        <p class="mut">🔐 <b>{decodeURIComponent(vpath)}</b> requiere autenticación.</p>
        <LoginForm onDone={onDone} />
      </div>
    </div>
  );
}

function SessionBadge({ onLogout }: { onLogout: () => void }) {
  const { acct, perms, setLoginOpen } = useUi();
  const anon = acct === "*";
  return (
    <span class={`acct${anon ? " anon" : ""}`} title={`perms: ${perms.join(",") || "—"}`}>
      {anon ? "👤 *" : `👤 ${acct}`}
      {anon
        ? <button onClick={() => setLoginOpen(true)}>login</button>
        : <button onClick={onLogout} title="POST act=logout">logout</button>}
    </span>
  );
}

/** panel flotante con estado de subida en tiempo real por archivo + agregado */
function UploadsPanel() {
  const tasks = useUps((s) => s.tasks);
  const cancel = useUps((s) => s.cancel);
  const clearFinished = useUps((s) => s.clearFinished);
  if (!tasks.length) return null;
  const totDone = tasks.reduce((a, t) => a + t.bytesDone, 0);
  const totSize = tasks.reduce((a, t) => a + t.bytesTotal, 0) || 1;
  const totSpeed = tasks.reduce((a, t) => a + (t.phase === "up" ? t.speedBps : 0), 0);
  const active = tasks.filter((t) => t.phase === "hash" || t.phase === "up").length;
  const pct = (t: UpTask) =>
    t.phase === "hash"
      ? (t.hashDone / Math.max(1, t.hashTotal)) * 100
      : (t.bytesDone / Math.max(1, t.bytesTotal)) * 100;
  const phaseLabel = (t: UpTask) =>
    t.phase === "hash" ? `🔐 hash ${t.hashDone}/${t.hashTotal}`
    : t.phase === "up" ? `⬆ subiendo ${t.doneChunks}/${t.totalChunks} chunks${t.skipped ? ` (+${t.skipped} resumidos)` : ""}`
    : t.phase === "done" ? "✅ completo"
    : t.phase === "cancelled" ? "🚫 cancelado"
    : `❌ ${t.err || "error"}`;
  return (
    <aside class="ups-panel">
      <header>
        <b>⬆ subidas {active > 0 ? `(${active} activas)` : "(terminadas)"}</b>
        <span class="mut">{fmtSize(totDone)}/{fmtSize(totSize)} · {fmtSpeed(totSpeed)}</span>
        <button onClick={clearFinished} title="limpiar terminadas">limpiar</button>
      </header>
      <div class="ups-total"><i style={{ width: `${(totDone / totSize) * 100}%` }} /></div>
      {tasks.slice(-6).map((t) => (
        <div key={t.id} class={`up ${t.phase}`}>
          <div class="up-top">
            <span class="up-name" title={t.file.name}>{t.file.name}{t.finalName && t.finalName !== t.file.name ? ` → ${t.finalName}` : ""}</span>
            {(t.phase === "hash" || t.phase === "up") && (
              <button onClick={() => cancel(t.id)} title="cancela XHR + ?fs_abrt">cancelar</button>
            )}
          </div>
          <div class="bar"><i style={{ width: `${pct(t)}%` }} /></div>
          <div class="up-stats">
            <span>{phaseLabel(t)}</span>
            <span>{fmtSize(t.bytesDone)}/{fmtSize(t.bytesTotal)} · {fmtSpeed(t.speedBps)} · ETA {fmtEta(t.etaSec)}</span>
          </div>
        </div>
      ))}
    </aside>
  );
}

/** lista con paginación por ventanas: evita el atasco de browser.js con 5000+ ficheros */
function FileList({ dirs, files, onOpen }: { dirs: LsEntry[]; files: LsEntry[]; onOpen: (e: LsEntry) => void }) {
  const { vpath, setVpath, grid, sel, toggleSel } = useUi();
  const all = useMemo(() => [...dirs, ...files], [dirs, files]);
  const [limit, setLimit] = useState(500);
  useEffect(() => setLimit(500), [vpath, all.length]);
  const vis = all.slice(0, limit);
  return (
    <div>
      <div class={grid ? "grid" : "rows"}>
        {vis.map((e) => {
          const isDir = e.href.endsWith("/");
          const full = (vpath.endsWith("/") ? vpath : vpath + "/") + e.href;
          return (
            <div key={full} class={`row${sel.has(full) ? " sel" : ""}`}>
              <input type="checkbox" checked={sel.has(full)} onChange={() => toggleSel(full)} title="seleccionar" />
              {grid && isImg(e.href) ? (
                <img loading="lazy" src={thumbUrl(full, "j", useUi.getState().auth)} alt="" width={96} height={96} onClick={() => (isDir ? setVpath(full) : onOpen(e))} />
              ) : null}
              <button
                class="name"
                onClick={() => {
                  if (isDir) setVpath(full);
                  else onOpen(e);
                }}
                title={full}
              >
                {isDir ? "📁 " : isImg(e.href) ? "🖼 " : isVid(e.href) ? "🎬 " : isAud(e.href) ? "🎵 " : "📄 "}
                {decodeURIComponent(e.href.replace(/\/$/, ""))}
              </button>
              <span class="sz">{fmtSize(e.sz)}</span>
              <span class="ts">{e.ts ? new Date(e.ts * 1000).toLocaleString() : "—"}</span>
            </div>
          );
        })}
      </div>
      {all.length > limit && (
        <button class="more" onClick={() => setLimit((l) => l + 500)}>
          mostrar más ({all.length - limit} restantes de {all.length})
        </button>
      )}
    </div>
  );
}

function Viewer({ entry, onClose }: { entry: LsEntry | null; onClose: () => void }) {
  const { vpath, auth } = useUi();
  const [txt, setTxt] = useState<string | null>(null);
  useEffect(() => {
    setTxt(null);
    if (!entry || entry.href.endsWith("/")) return;
    const full = (vpath.endsWith("/") ? vpath : vpath + "/") + entry.href;
    if (entry.sz < 512 * 1024 && /\.(txt|md|log|json|xml|css|js|ts|py|sh|conf)$/i.test(entry.href))
      fetch(`${rawUrl(full, auth)}?txt`, { credentials: "include" }).then((r) => (r.ok ? r.text() : Promise.reject())).then(setTxt).catch(() => setTxt("(binario o muy grande)"));
  }, [entry, vpath, auth]);
  if (!entry) return null;
  const full = (vpath.endsWith("/") ? vpath : vpath + "/") + entry.href;
  return (
    <div class="modal" onClick={onClose}>
      <div class="card" onClick={(e) => e.stopPropagation()}>
        <header>
          <b>{decodeURIComponent(entry.href)}</b>
          <span>
            <a href={dlUrl(full, auth)}>⬇ descargar</a> <button onClick={onClose}>✕</button>
          </span>
        </header>
        {isImg(entry.href) && <img src={rawUrl(full, auth)} alt="" />}
        {isVid(entry.href) && <video src={rawUrl(full, auth)} controls autoPlay />}
        {isAud(entry.href) && <audio src={rawUrl(full, auth)} controls autoPlay />}
        {txt !== null && <pre>{txt.slice(0, 20000)}</pre>}
      </div>
    </div>
  );
}

export function App() {
  const { vpath, auth, acct, grid, toggleGrid, dots, toggleDots, query, setQuery, sel, clearSel, loginOpen, setSession } = useUi();
  const { data, err, authErr, loading, reload } = useLs();
  const [view, setView] = useState<LsEntry | null>(null);
  const [sr, setSr] = useState<SearchResponse | null>(null);
  const upsert = useUps((s) => s.upsert);
  const attachCtl = useUps((s) => s.attachCtl);
  const fileRef = useRef<HTMLInputElement>(null);

  // probe de sesión al arrancar (la cookie puede ya existir)
  useEffect(() => {
    me(auth).then((s) => setSession(s.acct, s.perms)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return setSr(null);
    try {
      setSr(await search(query, 200, auth));
    } catch (e: any) {
      if (isAuthError(e)) useUi.getState().setLoginOpen(true);
      else alert(e.message);
    }
  }, [query, auth]);

  const onFiles = useCallback(async (fl: FileList | null) => {
    if (!fl) return;
    for (const f of Array.from(fl)) {
      const task = newUpTask(f);
      const ctl = newUpCtl();
      upsert(task);
      attachCtl(task.id, ctl);
      try {
        await uploadFile(vpath, f, auth, (t) => upsert(t), ctl, task);
      } catch (e: any) {
        const cancelled = /cancelado/i.test(e.message || "");
        upsert({ ...useUps.getState().tasks.find((x) => x.id === task.id)!, phase: cancelled ? "cancelled" : "err", err: cancelled ? undefined : (e.message || String(e)) });
        if (isAuthError(e)) useUi.getState().setLoginOpen(true);
      }
    }
    reload();
  }, [vpath, auth, reload, upsert, attachCtl]);

  const onLogout = useCallback(async () => {
    await logout(vpath, auth);
    setSession("*", []);
    reload();
  }, [vpath, auth, setSession, reload]);

  const selAct = useCallback(async (kind: "del" | "move" | "copy") => {
    if (!sel.size) return;
    try {
      if (kind === "del") {
        if (!confirm(`borrar ${sel.size} item(s)?`)) return;
        await rm([...sel], auth);
      } else {
        const dst = prompt(`destino para ${kind} (${sel.size} items):`);
        if (!dst) return;
        for (const s of sel) await (kind === "move" ? mv(s, dst, auth) : cp(s, dst, auth));
      }
    } catch (e: any) {
      if (isAuthError(e)) return useUi.getState().setLoginOpen(true);
      alert(e.message);
      return;
    }
    clearSel();
    reload();
  }, [sel, auth, reload, clearSel]);

  // página de login dedicada cuando no hay sesión útil:
  //  - ?ls 401/403 (authErr), o
  //  - anónimo sin read/get (volúmenes privados devuelven 200-vacío, no 401)
  // los volúmenes públicos (anon con read) siguen entrando al browser
  const perms = data?.perms ?? [];
  const needLogin =
    !loading && (authErr || (acct === "*" && data !== null && !perms.includes("read") && !perms.includes("get")));
  if (needLogin) {
    return (
      <div class="app">
        <LoginPage onDone={reload} />
      </div>
    );
  }

  return (
    <div class="app">
      <header class="top">
        <b class="logo">copyparty <span>next</span></b>
        <Crumbs />
        <input class="q" placeholder="🔎 buscar (raw: ext:mp3 artist:foo) + Enter" value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === "Enter" && doSearch()} />
        <button onClick={doSearch} title="POST /?srch">buscar</button>
        <button onClick={toggleGrid} title="?grid">{grid ? "☰ lista" : "▦ grid"}</button>
        <button onClick={toggleDots} title="?dots">{dots ? "•dots on" : "•dots"}</button>
        <button onClick={() => fileRef.current?.click()} title="up2k resumable">⬆ subir</button>
        <button onClick={async () => { const n = prompt("nuevo directorio:"); if (n) { try { await mkdir(vpath, n, auth); reload(); } catch (e: any) { if (isAuthError(e)) useUi.getState().setLoginOpen(true); else alert(e.message); } } }}>+dir</button>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { onFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ""; }} />
        <SessionBadge onLogout={onLogout} />
      </header>

      <UploadsPanel />

      {sel.size > 0 && (
        <div class="bar">
          <span>{sel.size} seleccionados</span>
          <button onClick={() => selAct("move")}>mover (?move=)</button>
          <button onClick={() => selAct("copy")}>copiar (?copy=)</button>
          <button onClick={() => selAct("del")}>borrar (?delete)</button>
          <button onClick={clearSel}>limpiar</button>
        </div>
      )}

      <main onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer?.files || null); }}>
        {loading && <p class="mut">cargando ?ls…</p>}
        {err && !authErr && <p class="err">{err} <button onClick={reload}>reintentar</button></p>}
        {sr && (
          <section class="sr">
            <header>{sr.hits.length} hits {sr.trunc ? "(truncado)" : ""} <button onClick={() => setSr(null)}>✕</button></header>
            {sr.hits.map((h) => <div key={h.rp} class="row"><span class="name">{h.rp}</span><span class="sz">{fmtSize(h.sz)}</span></div>)}
          </section>
        )}
        {data && <FileList dirs={data.dirs} files={data.files} onOpen={setView} />}
        {data && <StatusBar data={data} />}
      </main>

      <Viewer entry={view} onClose={() => setView(null)} />
      {loginOpen && <LoginModal onDone={reload} />}
    </div>
  );
}
