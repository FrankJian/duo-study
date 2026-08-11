const CARD_COLORS = ["coral", "sky", "sun", "mint", "lavender", "peach"];

const state = {
  catalog: null,
  activeUnitId: "",
  selectedVideo: null,
  videoError: false,
};

const elements = {
  unitTabs: document.querySelector("#unitTabs"),
  lessonCount: document.querySelector("#lessonCount"),
  statusMessage: document.querySelector("#statusMessage"),
  videoGrid: document.querySelector("#videoGrid"),
  playerOverlay: document.querySelector("#playerOverlay"),
  playerUnitLabel: document.querySelector("#playerUnitLabel"),
  playerTitle: document.querySelector("#playerTitle"),
  videoPlayer: document.querySelector("#videoPlayer"),
  videoError: document.querySelector("#videoError"),
  closeButton: document.querySelector("#closeButton"),
  backButton: document.querySelector("#backButton"),
  previousButton: document.querySelector("#previousButton"),
  nextButton: document.querySelector("#nextButton"),
};

function getVideoUrl(file) {
  const encodedPath = file
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `/${encodedPath}`;
}

function isCatalog(value) {
  return Boolean(
    value &&
      Array.isArray(value.units) &&
      value.units.length > 0 &&
      value.units.every(
        (unit) =>
          unit &&
          typeof unit.id === "string" &&
          typeof unit.title === "string" &&
          Array.isArray(unit.videos),
      ),
  );
}

function getActiveUnit() {
  return state.catalog?.units.find((unit) => unit.id === state.activeUnitId) ?? null;
}

function getSelectedIndex() {
  const activeUnit = getActiveUnit();
  return activeUnit
    ? activeUnit.videos.findIndex((video) => video.file === state.selectedVideo?.file)
    : -1;
}

function showStatus(message, isError = false) {
  elements.statusMessage.className = `status-message${isError ? " status-error" : ""}`;
  elements.statusMessage.setAttribute("role", isError ? "alert" : "status");
  elements.statusMessage.innerHTML = isError
    ? `<span class="status-icon" aria-hidden="true">!</span><div><strong>课程暂时没有打开</strong><p>${message}</p></div>`
    : `<span class="loading-dot" aria-hidden="true"></span><span>${message}</span>`;
  elements.statusMessage.classList.remove("is-hidden");
}

function hideStatus() {
  elements.statusMessage.classList.add("is-hidden");
}

function renderUnitTabs() {
  elements.unitTabs.innerHTML = state.catalog.units
    .map(
      (unit, index) => `
        <button class="unit-tab ${state.activeUnitId === unit.id ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.activeUnitId === unit.id}" aria-controls="panel-${unit.id}" data-unit-id="${unit.id}">
          <span class="unit-tab-number">0${index + 1}</span>
          <span><strong>${unit.title}</strong><small>${unit.subtitle ?? "趣味学习"}</small></span>
          <span class="unit-tab-arrow" aria-hidden="true">→</span>
        </button>`,
    )
    .join("");

  elements.unitTabs.classList.remove("is-hidden");
  elements.unitTabs.querySelectorAll("[data-unit-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeUnitId = button.dataset.unitId;
      renderUnitTabs();
      renderVideoGrid();
    });
  });
}

function renderVideoGrid() {
  const activeUnit = getActiveUnit();
  if (!activeUnit) {
    elements.videoGrid.classList.add("is-hidden");
    elements.lessonCount.classList.add("is-hidden");
    return;
  }

  elements.lessonCount.textContent = `${activeUnit.videos.length} 个小视频`;
  elements.lessonCount.classList.remove("is-hidden");
  elements.videoGrid.setAttribute("id", `panel-${activeUnit.id}`);
  elements.videoGrid.setAttribute("aria-label", activeUnit.title);
  elements.videoGrid.innerHTML = activeUnit.videos
    .map(
      (video, index) => `
        <button class="video-card" type="button" data-video-file="${encodeURIComponent(video.file)}">
          <span class="card-art ${CARD_COLORS[index % CARD_COLORS.length]}" aria-hidden="true">
            ${video.poster ? `<img class="card-poster" src="${encodeURI(video.poster)}" alt="" loading="lazy" decoding="async">` : ""}
            <span class="card-art-number">${String(video.order).padStart(2, "0")}</span>
            <span class="card-art-doodle">${index % 3 === 0 ? "✦" : index % 3 === 1 ? "☼" : "●"}</span>
            <span class="play-circle">▶</span>
          </span>
          <span class="video-card-body">
            <span class="video-card-label">LESSON ${String(video.order).padStart(2, "0")}</span>
            <span class="video-card-title">${video.title}</span>
            <span class="video-card-action">点击观看 <span aria-hidden="true">↗</span></span>
          </span>
        </button>`,
    )
    .join("");

  elements.videoGrid.classList.remove("is-hidden");
  elements.videoGrid.querySelectorAll("[data-video-file]").forEach((button) => {
    button.addEventListener("click", () => {
      const file = decodeURIComponent(button.dataset.videoFile);
      const video = activeUnit.videos.find((item) => item.file === file);
      if (video) openPlayer(video);
    });
  });
}

function updatePlayerNavigation() {
  const activeUnit = getActiveUnit();
  const selectedIndex = getSelectedIndex();
  elements.previousButton.disabled = selectedIndex <= 0;
  elements.nextButton.disabled = !activeUnit || selectedIndex >= activeUnit.videos.length - 1;
}

function openPlayer(video) {
  const activeUnit = getActiveUnit();
  if (!activeUnit) return;

  state.selectedVideo = video;
  state.videoError = false;
  elements.playerUnitLabel.textContent = `${activeUnit.title} · LESSON ${String(video.order).padStart(2, "0")}`;
  elements.playerTitle.textContent = video.title;
  elements.videoError.classList.add("is-hidden");
  elements.videoPlayer.src = getVideoUrl(video.file);
  elements.playerOverlay.classList.remove("is-hidden");
  document.body.classList.add("player-open");
  updatePlayerNavigation();
  elements.videoPlayer.load();
  elements.videoPlayer.play().catch(() => {});
}

function closePlayer() {
  elements.videoPlayer.pause();
  elements.videoPlayer.removeAttribute("src");
  elements.videoPlayer.load();
  elements.playerOverlay.classList.add("is-hidden");
  document.body.classList.remove("player-open");
  state.selectedVideo = null;
  state.videoError = false;
}

function playAdjacent(direction) {
  const activeUnit = getActiveUnit();
  const selectedIndex = getSelectedIndex();
  const nextVideo = activeUnit?.videos[selectedIndex + direction];
  if (nextVideo) openPlayer(nextVideo);
}

async function loadCatalog() {
  try {
    const response = await fetch("videos.json", { cache: "no-store" });
    if (!response.ok) throw new Error("视频清单加载失败");
    const data = await response.json();
    if (!isCatalog(data)) throw new Error("视频清单格式不正确");

    state.catalog = {
      units: data.units.map((unit) => ({
        ...unit,
        videos: [...unit.videos].sort((a, b) => a.order - b.order),
      })),
    };
    state.activeUnitId = state.catalog.units[0]?.id ?? "";
    hideStatus();
    renderUnitTabs();
    renderVideoGrid();
  } catch (error) {
    showStatus(`${error instanceof Error ? error.message : "暂时打不开课程"} 请检查 videos.json 是否存在。`, true);
  }
}

elements.closeButton.addEventListener("click", closePlayer);
elements.backButton.addEventListener("click", closePlayer);
elements.previousButton.addEventListener("click", () => playAdjacent(-1));
elements.nextButton.addEventListener("click", () => playAdjacent(1));
elements.videoPlayer.addEventListener("error", () => {
  state.videoError = true;
  elements.videoError.classList.remove("is-hidden");
});
elements.playerOverlay.addEventListener("mousedown", (event) => {
  if (event.target === elements.playerOverlay) closePlayer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.selectedVideo) closePlayer();
});

loadCatalog();
