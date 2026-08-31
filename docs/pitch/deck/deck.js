(() => {
  const slides = [...document.querySelectorAll(".slide")];
  const pos = document.getElementById("pos");
  let i = 0;

  function show(n) {
    i = (n + slides.length) % slides.length;
    slides.forEach((s, idx) => s.classList.toggle("is-active", idx === i));
    pos.textContent = `${i + 1} / ${slides.length}`;
    history.replaceState(null, "", `#${i + 1}`);
  }

  document.getElementById("prev").addEventListener("click", () => show(i - 1));
  document.getElementById("next").addEventListener("click", () => show(i + 1));

  window.addEventListener("keydown", (e) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      show(i + 1);
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
      e.preventDefault();
      show(i - 1);
    } else if (e.key === "Home") show(0);
    else if (e.key === "End") show(slides.length - 1);
  });

  // Click left/right thirds
  document.getElementById("deck").addEventListener("click", (e) => {
    if (e.target.closest(".hud") || e.target.closest("a")) return;
    const x = e.clientX / window.innerWidth;
    if (x < 0.28) show(i - 1);
    else if (x > 0.72) show(i + 1);
  });

  const hash = Number((location.hash || "").replace("#", ""));
  show(Number.isFinite(hash) && hash >= 1 && hash <= slides.length ? hash - 1 : 0);
})();
