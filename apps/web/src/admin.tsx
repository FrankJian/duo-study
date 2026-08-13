import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "@kids-video/contracts";

type Unit = { id: string; slug: string; title: string; subtitle: string | null; status: string; sortOrder: number; videoCount: number };
type Video = { id: string; title: string; unitId: string; unitSlug: string; status: string; sortOrder: number; posterUrl: string | null; fileSize: number; originalFilename: string };

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

type VideoUploadJob = { id: string; title: string; phase: "queued" | "uploading" | "processing" | "success" | "error"; percent: number; message?: string };

function uploadWithProgress<T>(url: string, data: FormData, onProgress: (percent: number) => void, onUploadComplete: () => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-csrf-token", csrf());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.upload.onloadend = onUploadComplete;
    xhr.onerror = () => reject(new Error("网络连接失败，请稍后重试"));
    xhr.onabort = () => reject(new Error("上传已取消"));
    xhr.onload = () => {
      let body: (T & { error?: { message?: string } }) | null = null;
      try { body = JSON.parse(xhr.responseText) as T & { error?: { message?: string } }; } catch { /* empty response */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      reject(new Error(body?.error?.message ?? "上传失败"));
    };
    xhr.send(data);
  });
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
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [unitEditForm, setUnitEditForm] = useState({ slug: "", title: "", subtitle: "", sortOrder: "0", status: "draft" });
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [videoEditForm, setVideoEditForm] = useState({ title: "", unitId: "", sortOrder: "0", status: "draft" });
  const [busyAction, setBusyAction] = useState("");
  const busy = Boolean(busyAction);
  const [success, setSuccess] = useState("");
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const [videoUploads, setVideoUploads] = useState<VideoUploadJob[]>([]);
  const uploadQueueRef = useRef<string[]>([]);
  const uploadTasksRef = useRef(new Map<string, { title: string; body: FormData }>());
  const activeUploadRef = useRef<string | null>(null);
  function beginAction(action: string) { setBusyAction(action); setError(""); setSuccess(""); }
  function endAction() { setBusyAction(""); }
  function updateVideoUpload(id: string, patch: Partial<VideoUploadJob>) { setVideoUploads((current) => current.map((job) => job.id === id ? { ...job, ...patch } : job)); }
  function processNextVideoUpload() {
    if (activeUploadRef.current) return;
    const nextId = uploadQueueRef.current.shift();
    if (!nextId) return;
    const task = uploadTasksRef.current.get(nextId);
    if (!task) return processNextVideoUpload();
    activeUploadRef.current = nextId;
    updateVideoUpload(nextId, { phase: "uploading", percent: 0 });
    void runVideoUpload(nextId, task.title, task.body).finally(() => {
      uploadTasksRef.current.delete(nextId);
      activeUploadRef.current = null;
      processNextVideoUpload();
    });
  }
  useEffect(() => { Promise.all([api<Unit[]>("/api/admin/units"), api<Video[]>("/api/admin/videos?includeDeleted=true")]).then(([nextUnits, nextVideos]) => { setUnits(nextUnits); setVideos(nextVideos); setVideoForm((current) => ({ ...current, unitId: current.unitId || nextUnits.find((unit) => unit.status !== "archived")?.id || "" })); }).catch((reason) => setError(reason instanceof Error ? reason.message : "加载失败")); }, [refresh, setError]);
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
  const editableUnits = units.filter((unit) => unit.status !== "archived");
  async function createUnit(event: FormEvent) { event.preventDefault(); beginAction("create-unit"); try { await api("/api/admin/units", { method: "POST", body: JSON.stringify({ ...unitForm, subtitle: unitForm.subtitle || null, sortOrder: units.length, status: "published" }) }); setUnitForm({ slug: "", title: "", subtitle: "" }); setRefresh((value) => value + 1); setSuccess("Unit 创建成功"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unit 创建失败"); } finally { endAction(); } }
  function uploadVideo(event: FormEvent) {
    event.preventDefault();
    if (!videoFile) { setSuccess(""); return setError("请选择视频文件"); }
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const uploadTitle = videoForm.title.trim() || videoFile.name;
    const body = new FormData();
    body.set("title", videoForm.title);
    body.set("unitId", videoForm.unitId);
    body.set("sortOrder", videoForm.sortOrder);
    body.set("status", videoForm.status);
    body.set("video", videoFile);
    setError("");
    const queued = Boolean(activeUploadRef.current || uploadQueueRef.current.length);
    setSuccess(queued ? `已加入上传队列：${uploadTitle}` : `已开始上传：${uploadTitle}`);
    setVideoUploads((current) => [...current, { id: uploadId, title: uploadTitle, phase: "queued", percent: 0 }]);
    uploadQueueRef.current.push(uploadId);
    uploadTasksRef.current.set(uploadId, { title: uploadTitle, body });
    setVideoFile(null);
    setVideoForm((current) => ({ ...current, title: "", sortOrder: "0" }));
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    processNextVideoUpload();
  }
  async function runVideoUpload(uploadId: string, uploadTitle: string, body: FormData) {
    try {
      await uploadWithProgress("/api/admin/videos", body, (percent) => updateVideoUpload(uploadId, { phase: percent >= 100 ? "processing" : "uploading", percent }), () => updateVideoUpload(uploadId, { phase: "processing", percent: 100 }));
      updateVideoUpload(uploadId, { phase: "success", percent: 100, message: "上传成功，已加入视频库" });
      setRefresh((value) => value + 1);
      setError("");
      setSuccess(`视频上传成功：${uploadTitle}`);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "上传失败";
      updateVideoUpload(uploadId, { phase: "error", message });
      setSuccess("");
      setError(`${uploadTitle}：${message}`);
    }
  }
  async function logout() { beginAction("logout"); try { await api("/api/auth/logout", { method: "POST", body: "{}" }); } catch (reason) { setError(reason instanceof Error ? reason.message : "退出登录失败"); } finally { endAction(); onLoggedOut(); } }
  async function setVideoStatus(video: Video, status: string) { beginAction(`video-status:${video.id}`); try { await api(`/api/admin/videos/${video.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); setRefresh((value) => value + 1); setSuccess("视频状态已更新"); } catch (reason) { setError(reason instanceof Error ? reason.message : "状态更新失败"); } finally { endAction(); } }
  function openUnitEditor(unit: Unit) { setEditingUnit(unit); setUnitEditForm({ slug: unit.slug, title: unit.title, subtitle: unit.subtitle ?? "", sortOrder: String(unit.sortOrder), status: unit.status }); }
  async function saveUnit(event: FormEvent) { event.preventDefault(); if (!editingUnit) return; beginAction("unit-edit"); try { await api(`/api/admin/units/${editingUnit.id}`, { method: "PATCH", body: JSON.stringify({ slug: unitEditForm.slug, title: unitEditForm.title, subtitle: unitEditForm.subtitle || null, sortOrder: Number(unitEditForm.sortOrder), status: unitEditForm.status }) }); setEditingUnit(null); setRefresh((value) => value + 1); setSuccess("Unit 更新成功"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unit 更新失败"); } finally { endAction(); } }
  async function deleteUnit(unit: Unit) { if (!window.confirm(`确定要删除 ${unit.title} 吗？删除后 Unit 会被归档。`)) return; beginAction(`unit-delete:${unit.id}`); try { await api(`/api/admin/units/${unit.id}`, { method: "DELETE" }); setRefresh((value) => value + 1); setSuccess("Unit 已归档"); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unit 删除失败"); } finally { endAction(); } }
  function openVideoEditor(video: Video) { setEditingVideo(video); setVideoEditForm({ title: video.title, unitId: video.unitId, sortOrder: String(video.sortOrder), status: video.status === "deleted" ? "draft" : video.status }); }
  async function saveVideo(event: FormEvent) { event.preventDefault(); if (!editingVideo) return; beginAction("video-edit"); try { await api(`/api/admin/videos/${editingVideo.id}`, { method: "PATCH", body: JSON.stringify({ title: videoEditForm.title, unitId: videoEditForm.unitId, sortOrder: Number(videoEditForm.sortOrder), status: videoEditForm.status }) }); setEditingVideo(null); setRefresh((value) => value + 1); setSuccess("视频更新成功"); } catch (reason) { setError(reason instanceof Error ? reason.message : "视频更新失败"); } finally { endAction(); } }
  async function deleteVideo(video: Video) { if (!window.confirm(`确定要删除视频“${video.title}”吗？视频会进入回收区。`)) return; beginAction(`video-delete:${video.id}`); try { await api(`/api/admin/videos/${video.id}`, { method: "DELETE" }); setRefresh((value) => value + 1); setSuccess("视频已移入回收区"); } catch (reason) { setError(reason instanceof Error ? reason.message : "视频删除失败"); } finally { endAction(); } }
  async function restoreVideo(video: Video) { if (!window.confirm(`确定恢复视频“${video.title}”吗？恢复后会回到草稿状态。`)) return; beginAction(`video-restore:${video.id}`); try { await api(`/api/admin/videos/${video.id}/restore`, { method: "POST", body: "{}" }); setRefresh((value) => value + 1); setSuccess("视频已恢复为草稿"); } catch (reason) { setError(reason instanceof Error ? reason.message : "视频恢复失败"); } finally { endAction(); } }
  async function uploadPoster(video: Video, file: File) {
    const previewUrl = URL.createObjectURL(file);
    const body = new FormData();
    body.set("poster", file);
    setError("");
    setSuccess("");
    setPosterUploads((current) => ({ ...current, [video.id]: previewUrl }));
    try {
      const result = await api<{ posterUrl: string }>(`/api/admin/videos/${video.id}/poster`, { method: "POST", body });
      setVideos((current) => current.map((item) => item.id === video.id ? { ...item, posterUrl: result.posterUrl } : item));
      setRefresh((value) => value + 1);
      setSuccess("封面更新成功");
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
  return <div className="admin-page admin-dashboard"><header className="admin-header"><div><p className="admin-kicker">LEARNING LIBRARY</p><h1>内容管理</h1><p className="admin-muted">你好，{user.username} · {units.length} 个 Unit · {counts.videos} 个视频 · {counts.drafts} 个草稿</p></div><div className="admin-actions"><a className="back-link" href="/">查看公开页面</a><button className="admin-secondary" onClick={logout} disabled={busy}>{busyAction === "logout" ? "退出中…" : "退出登录"}</button></div></header>
    {error ? <div className="admin-error admin-banner" role="alert">{error}</div> : null}
    {success ? <div className="admin-success admin-banner" role="status" aria-live="polite">{success}</div> : null}
    <div className="admin-columns">
      <form className="admin-card form-card" onSubmit={createUnit}>
        <div className="form-card-heading"><span className="form-icon form-icon-purple" aria-hidden="true">＋</span><div><p className="form-eyebrow">STRUCTURE</p><h2>新建 Unit</h2><p className="form-help">创建一个新的学习单元，后续可以在这里归类视频。</p></div></div>
        <label>Slug<input value={unitForm.slug} onChange={(e) => setUnitForm({ ...unitForm, slug: e.target.value })} placeholder="unit3" required /></label>
        <label>标题<input value={unitForm.title} onChange={(e) => setUnitForm({ ...unitForm, title: e.target.value })} placeholder="Unit 3" required /></label>
        <label>副标题<input value={unitForm.subtitle} onChange={(e) => setUnitForm({ ...unitForm, subtitle: e.target.value })} placeholder="可选" /></label>
        <button className="admin-primary" disabled={busy}>{busyAction === "create-unit" ? "创建中…" : "创建 Unit"}</button>
      </form>
      <form className="admin-card form-card" onSubmit={uploadVideo}>
        <div className="form-card-heading"><span className="form-icon form-icon-blue" aria-hidden="true">↑</span><div><p className="form-eyebrow">NEW CONTENT</p><h2>上传视频</h2><p className="form-help">可以连续添加多个视频任务，系统会按顺序上传并自动生成竖屏封面。</p></div></div>
        <label>视频标题<input value={videoForm.title} onChange={(e) => setVideoForm({ ...videoForm, title: e.target.value })} placeholder="例如：Big A, Little a" required /></label>
        <label>所属 Unit<select value={videoForm.unitId} onChange={(e) => setVideoForm({ ...videoForm, unitId: e.target.value })} required>{editableUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
        <div className="form-row"><label>排序<input type="number" min="0" value={videoForm.sortOrder} onChange={(e) => setVideoForm({ ...videoForm, sortOrder: e.target.value })} /></label><label>状态<select value={videoForm.status} onChange={(e) => setVideoForm({ ...videoForm, status: e.target.value })}><option value="draft">草稿</option><option value="published">发布</option><option value="unlisted">不公开</option></select></label></div>
        <label>MP4 文件<input ref={videoFileInputRef} type="file" accept="video/mp4,.mp4" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} required /></label>
        {videoUploads.length > 0 ? <div className="upload-queue" role="status" aria-live="polite"><div className="upload-queue-heading"><span>上传队列</span><span>{videoUploads.filter((job) => job.phase === "uploading" || job.phase === "processing").length} 个进行中 · {videoUploads.filter((job) => job.phase === "queued").length} 个排队中</span></div>{videoUploads.map((job) => { const active = job.phase === "uploading" || job.phase === "processing"; return <div className={`upload-job upload-job-${job.phase}`} key={job.id}><div className="upload-job-meta"><strong title={job.title}>{job.title}</strong><span>{job.phase === "queued" ? "等待上传" : job.phase === "uploading" ? `上传中 ${job.percent}%` : job.phase === "processing" ? "服务器处理中…" : job.phase === "success" ? "已完成" : "上传失败"}</span></div>{active ? <div className="upload-progress-track"><span style={{ width: `${job.percent}%` }} /></div> : null}{job.phase === "queued" ? <p>前一个视频完成后自动开始。</p> : null}{job.phase === "processing" ? <p>正在校验视频并生成封面，请稍候。</p> : null}{job.phase === "error" ? <p>{job.message}</p> : null}</div>; })}</div> : null}
        <button className="admin-primary" disabled={busy}>{busy ? "请等待当前操作…" : "开始上传视频"}</button>
      </form>
    </div>
    <section className="admin-card units-card">
      <div className="library-heading"><div><p className="form-eyebrow">UNIT MANAGEMENT</p><h2>Unit 管理</h2><p className="form-help">编辑 Unit 信息、调整状态，或归档不再使用的 Unit。</p></div><span className="result-count">{units.length} 个 Unit</span></div>
      <div className="unit-admin-grid">{units.map((unit) => <article className={`unit-admin-item${unit.status === "archived" ? " is-archived" : ""}`} key={unit.id}>
        <div className="unit-admin-main"><span className="unit-slug">{unit.slug}</span><div><strong>{unit.title}</strong><small>{unit.subtitle || "暂无副标题"} · {unit.videoCount} 个视频</small></div></div>
        <span className={`unit-status unit-status-${unit.status}`}>{unit.status === "published" ? "已发布" : unit.status === "draft" ? "草稿" : "已归档"}</span>
        <div className="unit-admin-actions"><button className="table-action" type="button" onClick={() => openUnitEditor(unit)} disabled={busy}>编辑</button>{unit.status === "archived" ? null : <button className="table-action table-action-danger" type="button" onClick={() => void deleteUnit(unit)} disabled={busy}>{busyAction === `unit-delete:${unit.id}` ? "归档中…" : "删除"}</button>}</div>
      </article>)}</div>
    </section>
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
            <div className="row-main"><strong>{video.title}</strong><small>{video.originalFilename} · 排序 {video.sortOrder}</small></div>
            {video.status === "deleted"
              ? <span className="unit-status unit-status-archived">已删除</span>
              : <div className="status-control"><select value={video.status} onChange={(e) => void setVideoStatus(video, e.target.value)} disabled={isUploading || busy}><option value="draft">草稿</option><option value="published">已发布</option><option value="unlisted">不公开</option></select>{busyAction === `video-status:${video.id}` ? <span className="inline-feedback">保存中…</span> : null}</div>}
            <div className="row-actions">
              {video.status === "deleted"
                ? <button className="table-action" type="button" onClick={() => void restoreVideo(video)} disabled={busy}>{busyAction === `video-restore:${video.id}` ? "恢复中…" : "恢复"}</button>
                : <button className="table-action" type="button" onClick={() => openVideoEditor(video)} disabled={busy}>编辑</button>}
              {video.status !== "deleted" ? <button className="table-action table-action-danger" type="button" onClick={() => void deleteVideo(video)} disabled={busy}>{busyAction === `video-delete:${video.id}` ? "删除中…" : "删除"}</button> : null}
              {video.status !== "deleted" ? <label className={`poster-upload${isUploading ? " is-uploading" : ""}`}>
                <span>{isUploading ? "正在保存…" : "换封面"}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" disabled={isUploading} onChange={(e) => { const file = e.target.files?.[0]; e.currentTarget.value = ""; if (file) void uploadPoster(video, file); }} />
                {isUploading ? <span className="poster-progress" aria-hidden="true"><span /></span> : null}
              </label> : null}
            </div>
          </div>;
        })}</div>
      </section>)}{filteredVideos.length === 0 ? <div className="empty-library"><span className="empty-library-icon" aria-hidden="true">⌕</span><strong>没有匹配的视频</strong><p>试试清除搜索内容或调整筛选条件。</p></div> : null}</div>
    </section>
    {editingUnit ? <div className="admin-modal-backdrop" role="presentation" onClick={() => setEditingUnit(null)}>
      <form className="admin-card admin-modal" onSubmit={saveUnit} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="form-eyebrow">EDIT UNIT</p><h2>编辑 Unit</h2><p className="form-help">修改 Unit 的展示信息、排序和发布状态。</p></div><button className="close-button admin-close-button" type="button" aria-label="关闭" onClick={() => setEditingUnit(null)}>×</button></div>
        <label>Slug<input value={unitEditForm.slug} onChange={(e) => setUnitEditForm({ ...unitEditForm, slug: e.target.value })} required /></label>
        <label>标题<input value={unitEditForm.title} onChange={(e) => setUnitEditForm({ ...unitEditForm, title: e.target.value })} required /></label>
        <label>副标题<input value={unitEditForm.subtitle} onChange={(e) => setUnitEditForm({ ...unitEditForm, subtitle: e.target.value })} /></label>
        <div className="form-row"><label>排序<input type="number" min="0" value={unitEditForm.sortOrder} onChange={(e) => setUnitEditForm({ ...unitEditForm, sortOrder: e.target.value })} /></label><label>状态<select value={unitEditForm.status} onChange={(e) => setUnitEditForm({ ...unitEditForm, status: e.target.value })}><option value="draft">草稿</option><option value="published">已发布</option><option value="archived">已归档</option></select></label></div>
        <div className="modal-actions"><button className="admin-secondary" type="button" onClick={() => setEditingUnit(null)} disabled={busy}>取消</button><button className="admin-primary" disabled={busy}>{busyAction === "unit-edit" ? "保存中…" : "保存 Unit"}</button></div>
      </form>
    </div> : null}
    {editingVideo ? <div className="admin-modal-backdrop" role="presentation" onClick={() => setEditingVideo(null)}>
      <form className="admin-card admin-modal" onSubmit={saveVideo} onClick={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p className="form-eyebrow">EDIT VIDEO</p><h2>编辑视频</h2><p className="form-help">修改标题、所属 Unit、排序和发布状态。</p></div><button className="close-button admin-close-button" type="button" aria-label="关闭" onClick={() => setEditingVideo(null)}>×</button></div>
        <label>视频标题<input value={videoEditForm.title} onChange={(e) => setVideoEditForm({ ...videoEditForm, title: e.target.value })} required /></label>
        <label>所属 Unit<select value={videoEditForm.unitId} onChange={(e) => setVideoEditForm({ ...videoEditForm, unitId: e.target.value })} required>{units.filter((unit) => unit.status !== "archived" || unit.id === editingVideo.unitId).map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
        <div className="form-row"><label>排序<input type="number" min="0" value={videoEditForm.sortOrder} onChange={(e) => setVideoEditForm({ ...videoEditForm, sortOrder: e.target.value })} /></label><label>状态<select value={videoEditForm.status} onChange={(e) => setVideoEditForm({ ...videoEditForm, status: e.target.value })}><option value="draft">草稿</option><option value="published">已发布</option><option value="unlisted">不公开</option></select></label></div>
        <div className="modal-actions"><button className="admin-secondary" type="button" onClick={() => setEditingVideo(null)} disabled={busy}>取消</button><button className="admin-primary" disabled={busy}>{busyAction === "video-edit" ? "保存中…" : "保存视频"}</button></div>
      </form>
    </div> : null}
  </div>;
}
