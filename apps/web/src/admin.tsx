import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@kids-video/contracts";

type Unit = { id: string; slug: string; title: string; subtitle: string | null; status: string; sortOrder: number; videoCount: number };
type Video = { id: string; title: string; unitId: string; unitSlug: string; status: string; posterUrl: string | null; fileSize: number; originalFilename: string };

function csrf() {
  return document.cookie.split("; ").find((item) => item.startsWith("kids_csrf="))?.slice("kids_csrf=".length) ?? "";
}

async function api<T>(url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (init?.method && init.method !== "GET") headers.set("x-csrf-token", csrf());
  const response = await fetch(url, { ...init, headers, credentials: "include" });
  const body = await response.json().catch(() => null) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(body?.error?.message ?? "操作失败");
  return body;
}

export default function AdminApp() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ user: User | null }>("/api/auth/me").then((result) => setUser(result.user)).catch(() => setUser(null)).finally(() => setChecking(false));
  }, []);
  if (checking) return <div className="admin-page"><div className="admin-card">正在检查登录状态…</div></div>;
  if (!user) return <LoginForm onLoggedIn={(nextUser) => { setUser(nextUser); window.history.replaceState({}, "", "/admin"); }} error={error} setError={setError} />;
  return <Dashboard user={user} onLoggedOut={() => setUser(null)} error={error} setError={setError} />;
}

function LoginForm({ onLoggedIn, error, setError }: { onLoggedIn: (user: User) => void; error: string; setError: (value: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{ user: User }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }); onLoggedIn(result.user); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "登录失败"); }
    finally { setBusy(false); }
  }
  return <div className="admin-page"><form className="admin-card login-card" onSubmit={submit}>
    <p className="admin-kicker">ADMIN</p><h1>管理后台</h1><p className="admin-muted">登录后可以管理课程、视频和封面。</p>
    <label>用户名<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required /></label>
    <label>密码<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required /></label>
    {error ? <p className="admin-error">{error}</p> : null}<button className="admin-primary" disabled={busy}>{busy ? "登录中…" : "登录"}</button>
    <a className="back-link" href="/">← 返回公开页面</a>
  </form></div>;
}

function Dashboard({ user, onLoggedOut, error, setError }: { user: User; onLoggedOut: () => void; error: string; setError: (value: string) => void }) {
  const [units, setUnits] = useState<Unit[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [unitForm, setUnitForm] = useState({ slug: "", title: "", subtitle: "" });
  const [videoForm, setVideoForm] = useState({ title: "", unitId: "", sortOrder: "0", status: "draft" });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [posterUploads, setPosterUploads] = useState<Record<string, string>>({});
  const [videoUnitFilter, setVideoUnitFilter] = useState("all");
  const [videoStatusFilter, setVideoStatusFilter] = useState("all");
  const [videoSearch, setVideoSearch] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { Promise.all([api<Unit[]>("/api/admin/units"), api<Video[]>("/api/admin/videos")]).then(([nextUnits, nextVideos]) => { setUnits(nextUnits); setVideos(nextVideos); setVideoForm((current) => ({ ...current, unitId: current.unitId || nextUnits[0]?.id || "" })); }).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败")); }, [refresh, setError]);
  const counts = useMemo(() => ({ videos: videos.length, drafts: videos.filter((item) => item.status === "draft").length }), [videos]);
  const filteredVideos = useMemo(() => {
    const search = videoSearch.trim().toLocaleLowerCase();
    return videos.filter((video) => {
      if (videoUnitFilter !== "all" && video.unitSlug !== videoUnitFilter) return false;
      if (videoStatusFilter !== "all" && video.status !== videoStatusFilter) return false;
      if (search && !`${video.title} ${video.originalFilename}`.toLocaleLowerCase().includes(search)) return false;
      return true;
    });
  }, [videoSearch, videoStatusFilter, videoUnitFilter, videos]);
  const videoGroups = useMemo(() => units
    .map((unit) => ({ unit, videos: filteredVideos.filter((video) => video.unitId === unit.id) }))
    .filter((group) => group.videos.length > 0), [filteredVideos, units]);
  async function createUnit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api("/api/admin/units", { method: "POST", body: JSON.stringify({ ...unitForm, subtitle: unitForm.subtitle || null, sortOrder: units.length, status: "published" }) }); setUnitForm({ slug: "", title: "", subtitle: "" }); setRefresh((value) => value + 1); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unit 创建失败"); } finally { setBusy(false); } }
  async function uploadVideo(event: FormEvent) { event.preventDefault(); if (!videoFile) return setError("请选择视频文件"); setBusy(true); setError(""); const body = new FormData(); body.set("title", videoForm.title); body.set("unitId", videoForm.unitId); body.set("sortOrder", videoForm.sortOrder); body.set("status", videoForm.status); body.set("video", videoFile); try { await api("/api/admin/videos", { method: "POST", body }); setVideoFile(null); setVideoForm((current) => ({ ...current, title: "", sortOrder: "0" })); setRefresh((value) => value + 1); } catch (reason) { setError(reason instanceof Error ? reason.message : "上传失败"); } finally { setBusy(false); } }
  async function logout() { try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } finally { onLoggedOut(); } }
  async function setVideoStatus(video: Video, status: string) { try { await api(`/api/admin/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setRefresh((value) => value + 1); } catch (reason) { setError(reason instanceof Error ? reason.message : "状态更新失败"); } }
  async function uploadPoster(video: Video, file: File) {
    const previewUrl = URL.createObjectURL(file);
    const body = new FormData();
    body.set("poster", file);
    setError("");
    setPosterUploads((current) => ({ ...current, [video.id]: previewUrl }));
    try {
      const result = await api<{ posterUrl: string }>(`/api/admin/videos/${video.id}/poster`, { method: "POST", body });
      setVideos((current) => current.map((item) => item.id === video.id ? { ...item, posterUrl: result.posterUrl } : item));
      setRefresh((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "封面上传失败");
    } finally {
      URL.revokeObjectURL(previewUrl);
      setPosterUploads((current) => {
        const next = { ...current };
        delete next[video.id];
        return next;
      });
    }
  }
  return <div className="admin-page admin-dashboard"><header className="admin-header"><div><p className="admin-kicker">LEARNING LIBRARY</p><h1>内容管理</h1><p className="admin-muted">你好，{user.username} · {units.length} 个 Unit · {counts.videos} 个视频 · {counts.drafts} 个草稿</p></div><div className="admin-actions"><a className="back-link" href="/">查看公开页面</a><button className="admin-secondary" onClick={logout}>退出登录</button></div></header>
    {error ? <div className="admin-error admin-banner">{error}</div> : null}
    <div className="admin-columns">
      <form className="admin-card form-card" onSubmit={createUnit}>
        <div className="form-card-heading"><span className="form-icon form-icon-purple" aria-hidden="true">＋</span><div><p className="form-eyebrow">STRUCTURE</p><h2>新建 Unit</h2><p className="form-help">创建一个新的学习单元，后续可以在这里归类视频。</p></div></div>
        <label>Slug<input value={unitForm.slug} onChange={(e) => setUnitForm({ ...unitForm, slug: e.target.value })} placeholder="unit3" required /></label>
        <label>标题<input value={unitForm.title} onChange={(e) => setUnitForm({ ...unitForm, title: e.target.value })} placeholder="Unit 3" required /></label>
        <label>副标题<input value={unitForm.subtitle} onChange={(e) => setUnitForm({ ...unitForm, subtitle: e.target.value })} placeholder="可选" /></label>
        <button className="admin-primary" disabled={busy}>创建 Unit</button>
      </form>
      <form className="admin-card form-card" onSubmit={uploadVideo}>
        <div className="form-card-heading"><span className="form-icon form-icon-blue" aria-hidden="true">↑</span><div><p className="form-eyebrow">NEW CONTENT</p><h2>上传视频</h2><p className="form-help">上传 MP4 后，系统会自动生成竖屏封面并保存到对应 Unit。</p></div></div>
        <label>视频标题<input value={videoForm.title} onChange={(e) => setVideoForm({ ...videoForm, title: e.target.value })} placeholder="例如：Big A, Little a" required /></label>
        <label>所属 Unit<select value={videoForm.unitId} onChange={(e) => setVideoForm({ ...videoForm, unitId: e.target.value })} required>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
        <div className="form-row"><label>排序<input type="number" min="0" value={videoForm.sortOrder} onChange={(e) => setVideoForm({ ...videoForm, sortOrder: e.target.value })} /></label><label>状态<select value={videoForm.status} onChange={(e) => setVideoForm({ ...videoForm, status: e.target.value })}><option value="draft">草稿</option><option value="published">发布</option><option value="unlisted">不公开</option></select></label></div>
        <label>MP4 文件<input type="file" accept="video/mp4,.mp4" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} required /></label>
        <button className="admin-primary" disabled={busy}>{busy ? "上传处理中…" : "上传视频"}</button>
      </form>
    </div>
    <section className="admin-card table-card">
      <div className="library-heading"><div><p className="form-eyebrow">CONTENT LIBRARY</p><h2>视频库</h2><p className="form-help">按 Unit 分组管理内容，也可以快速筛选和搜索。</p></div><span className="result-count">显示 {filteredVideos.length} / {videos.length}</span></div>
      <div className="library-filters">
        <label className="filter-control filter-search">搜索视频<input value={videoSearch} onChange={(e) => setVideoSearch(e.target.value)} placeholder="搜索标题或文件名" /></label>
        <label className="filter-control">Unit<select value={videoUnitFilter} onChange={(e) => setVideoUnitFilter(e.target.value)}><option value="all">全部 Unit</option>{units.map((unit) => <option key={unit.id} value={unit.slug}>{unit.title}</option>)}</select></label>
        <label className="filter-control">状态<select value={videoStatusFilter} onChange={(e) => setVideoStatusFilter(e.target.value)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="published">已发布</option><option value="unlisted">不公开</option><option value="deleted">已删除</option></select></label>
      </div>
      <div className="video-groups">{videoGroups.map(({ unit, videos: groupVideos }) => <section className="video-group" key={unit.id}>
        <header className="video-group-heading"><div className="video-group-title"><span className="unit-slug">{unit.slug}</span><div><h3>{unit.title}</h3>{unit.subtitle ? <p>{unit.subtitle}</p> : null}</div></div><span className="group-count">{groupVideos.length} 个视频</span></header>
        <div className="admin-table">{groupVideos.map((video) => {
          const uploadPreview = posterUploads[video.id];
          const isUploading = Boolean(uploadPreview);
          const posterSrc = uploadPreview ?? video.posterUrl;
          return <div className="admin-row" key={video.id}>
            <div className={`row-poster${isUploading ? " is-uploading" : ""}`} aria-busy={isUploading}>
              {posterSrc ? <img src={posterSrc} alt="" /> : "—"}
              {isUploading ? <span className="poster-loading-overlay" role="status"><span className="poster-spinner" aria-hidden="true" /><span className="sr-only">正在保存封面</span></span> : null}
            </div>
            <div className="row-main"><strong>{video.title}</strong><small>{video.originalFilename}</small></div>
            <select value={video.status} onChange={(e) => setVideoStatus(video, e.target.value)} disabled={isUploading}><option value="draft">草稿</option><option value="published">已发布</option><option value="unlisted">不公开</option><option value="deleted">已删除</option></select>
            <label className={`poster-upload${isUploading ? " is-uploading" : ""}`}>
              <span>{isUploading ? "正在保存…" : "换封面"}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploading} onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) void uploadPoster(video, file); }} />
              {isUploading ? <span className="poster-progress" aria-hidden="true"><span /></span> : null}
            </label>
          </div>;
        })}</div>
      </section>)}{filteredVideos.length === 0 ? <div className="empty-library"><span className="empty-library-icon" aria-hidden="true">⌕</span><strong>没有匹配的视频</strong><p>试试清除搜索内容或调整筛选条件。</p></div> : null}</div>
    </section>
  </div>;
}
