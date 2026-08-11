import { useEffect, useMemo, useState } from "react";
import type { CatalogResponse, PublicVideo } from "@kids-video/contracts";
import AdminApp from "./admin";

function formatDuration(durationMs: number | null) {
  if (!durationMs) return "学习视频";
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.floor((durationMs % 60_000) / 1_000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function App() {
  if (window.location.pathname.startsWith("/admin")) return <AdminApp />;
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [activeUnit, setActiveUnit] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicVideo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/catalog")
      .then(async (response) => {
        if (!response.ok) throw new Error("目录暂时无法加载");
        return (await response.json()) as CatalogResponse;
      })
      .then((data) => {
        setCatalog(data);
        setActiveUnit(data.units[0]?.slug ?? null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "目录暂时无法加载"));
  }, []);

  const unit = useMemo(
    () => catalog?.units.find((item) => item.slug === activeUnit) ?? catalog?.units[0],
    [activeUnit, catalog],
  );
  const selectedIndex = unit?.videos.findIndex((video) => video.id === selected?.id) ?? -1;
  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "ArrowLeft" && selectedIndex > 0) setSelected(unit?.videos[selectedIndex - 1] ?? null);
      if (event.key === "ArrowRight" && unit && selectedIndex >= 0 && selectedIndex < unit.videos.length - 1) setSelected(unit.videos[selectedIndex + 1]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, selectedIndex, unit]);

  return (
    <main className="page-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">LET'S LEARN TOGETHER</p>
          <h1>小朋友的学习乐园</h1>
          <p className="hero-copy">挑一个喜欢的视频，和爸爸妈妈一起快乐学习吧！</p>
        </div>
        <div className="hero-illustration" aria-hidden="true">🌈</div>
      </header>

      {error ? <div className="notice error">{error}</div> : null}
      {!catalog && !error ? <div className="notice">正在准备学习内容…</div> : null}
      {catalog && catalog.units.length === 0 ? <div className="notice">老师还在准备新内容，请稍后再来看看吧！</div> : null}

      {catalog && catalog.units.length > 0 ? (
        <>
          <nav className="unit-tabs" aria-label="课程单元">
            {catalog.units.map((item) => (
              <button
                className={item.slug === unit?.slug ? "unit-tab active" : "unit-tab"}
                key={item.id}
                onClick={() => setActiveUnit(item.slug)}
              >
                {item.title}
              </button>
            ))}
          </nav>
          <section className="unit-section" aria-labelledby="unit-title">
            <div className="section-heading">
              <div>
                <h2 id="unit-title">{unit?.title}</h2>
                {unit?.subtitle ? <p>{unit.subtitle}</p> : null}
              </div>
              <span className="video-count">{unit?.videos.length ?? 0} 个视频</span>
            </div>
            <div className="video-grid">
              {unit?.videos.map((video, index) => (
                <button className="video-card" key={video.id} onClick={() => setSelected(video)}>
                  <span className="poster-wrap">
                    {video.posterUrl ? <img src={video.posterUrl} alt="" loading="lazy" /> : <span className="poster-fallback">▶</span>}
                    <span className="play-badge">▶</span>
                    <span className="video-number">{index + 1}</span>
                  </span>
                  <span className="video-title">{video.title}</span>
                  <span className="video-meta">{formatDuration(video.durationMs)}</span>
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {selected ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setSelected(null)}>
          <section className="player-modal" role="dialog" aria-modal="true" aria-label={selected.title} onClick={(event) => event.stopPropagation()}>
            <button className="close-button" onClick={() => setSelected(null)} aria-label="关闭">×</button>
            <h2>{selected.title}</h2>
            <video controls autoPlay playsInline poster={selected.posterUrl ?? undefined} src={selected.videoUrl} />
            <div className="player-nav"><button disabled={selectedIndex <= 0} onClick={() => setSelected(unit?.videos[selectedIndex - 1] ?? null)}>← 上一个</button><button disabled={!unit || selectedIndex < 0 || selectedIndex >= unit.videos.length - 1} onClick={() => setSelected(unit?.videos[selectedIndex + 1] ?? null)}>下一个 →</button></div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
