let galleries;
const decks = { art: [], design: [] };
const galleryOffsets = { art: 0, design: 0 };
const sortedGalleries = { art: [], design: [] };
const lightbox = document.querySelector(".lightbox");
const lightboxImage = lightbox.querySelector("img");
const lightboxCaption = lightbox.querySelector("figcaption");
const closeButton = lightbox.querySelector(".close-button");
const previousButton = lightbox.querySelector(".lightbox-nav--previous");
const nextButton = lightbox.querySelector(".lightbox-nav--next");
let lastFocusedElement;
let lightboxState = null;

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function refillDeck(galleryName) {
  decks[galleryName] = shuffle(galleries[galleryName]);
}

function imageAt(galleryName, index) {
  if (!decks[galleryName].length) refillDeck(galleryName);
  const length = decks[galleryName].length;
  return decks[galleryName][((index % length) + length) % length];
}

function renderGallery(galleryName) {
  const slots = document.querySelectorAll(`.hotspot[data-gallery="${galleryName}"]`);
  slots.forEach((slot, index) => {
    slot.dataset.index = index;
    setSlotImage(slot, imageAt(galleryName, galleryOffsets[galleryName] + index));
  });
}

function advanceGallery(galleryName, direction) {
  galleryOffsets[galleryName] += direction;
  renderGallery(galleryName);
}

function imageTitle(path) {
  const name = path.split("/").pop().replace(/\.[^/.]+$/, "").replaceAll("_", " ");
  const stripped = name.replace(/[([{][^)\]}]*[)\]}]/g, " ").replace(/\s+/g, " ").trim();
  return stripped || name.trim();
}

// The slots only ever show a small crop, so they load the pre-cropped
// "_thumb" twin that sits next to every full-size image; the lightbox
// keeps the full one. A missing thumb falls back to the original.
function thumbPath(path) {
  return path.replace(/(\.[^/.]+)$/, "_thumb$1");
}

function setSlotImage(slot, path) {
  const image = slot.querySelector("img");
  image.onerror = () => {
    image.onerror = null;
    image.src = path;
  };
  image.src = thumbPath(path);
  image.alt = imageTitle(path);
  slot.dataset.image = path;
}

function showImageInLightbox(galleryName, path) {
  lightboxImage.src = path;
  lightboxImage.alt = imageTitle(path);
  lightboxCaption.textContent = `${galleryName} / ${imageTitle(path)}`;
}

function showLightbox(slot) {
  lastFocusedElement = slot;
  const galleryName = slot.dataset.gallery;
  const order = sortedGalleries[galleryName];
  const index = order.indexOf(slot.dataset.image);
  lightboxState = { galleryName, index: index === -1 ? 0 : index };
  showImageInLightbox(galleryName, order[lightboxState.index]);
  lightbox.hidden = false;
  document.body.classList.add("is-lightbox-open");
  closeButton.focus();
}

function advanceLightbox(direction) {
  if (!lightboxState) return;
  const order = sortedGalleries[lightboxState.galleryName];
  const length = order.length;
  lightboxState.index = ((lightboxState.index + direction) % length + length) % length;
  showImageInLightbox(lightboxState.galleryName, order[lightboxState.index]);
}

function hideLightbox() {
  lightbox.hidden = true;
  document.body.classList.remove("is-lightbox-open");
  lightboxState = null;
  if (lastFocusedElement) lastFocusedElement.focus();
}

function setupGallery(galleryName) {
  decks[galleryName] = shuffle(galleries[galleryName]);
  sortedGalleries[galleryName] = [...galleries[galleryName]].sort((a, b) =>
    imageTitle(a).localeCompare(imageTitle(b))
  );
  galleryOffsets[galleryName] = 0;
  renderGallery(galleryName);
}

// Lets touch devices swipe left/right wherever mouse users would scroll.
// A drag past the threshold counts as a swipe and suppresses the tap's
// click so it advances instead of (re)triggering whatever a plain tap does.
function addSwipeNavigation(element, onSwipe) {
  const SWIPE_THRESHOLD = 40;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let isSwipe = false;

  element.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    tracking = true;
    isSwipe = false;
  }, { passive: true });

  element.addEventListener("touchmove", (event) => {
    if (!tracking) return;
    if (event.touches.length !== 1) {
      tracking = false;
      isSwipe = false;
      return;
    }
    const deltaX = event.touches[0].clientX - startX;
    const deltaY = event.touches[0].clientY - startY;
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      isSwipe = true;
      event.preventDefault();
    }
  }, { passive: false });

  element.addEventListener("touchend", (event) => {
    if (!tracking) return;
    tracking = false;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    if (isSwipe && Math.abs(deltaX) >= SWIPE_THRESHOLD && Math.abs(deltaX) > Math.abs(deltaY)) {
      event.preventDefault();
      onSwipe(deltaX < 0 ? 1 : -1);
    }
  }, { passive: false });

  element.addEventListener("touchcancel", () => {
    tracking = false;
    isSwipe = false;
  });
}

document.querySelectorAll(".hotspot").forEach((slot) => {
  slot.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    advanceGallery(slot.dataset.gallery, event.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  addSwipeNavigation(slot, (direction) => advanceGallery(slot.dataset.gallery, direction));

  slot.addEventListener("click", () => showLightbox(slot));
});

function loadGalleries() {
  function fetchManifest(url) {
    return fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error("Gallery manifest unavailable");
        return response.json();
      });
  }

  return fetchManifest("/api/galleries")
    .catch(() => fetchManifest("galleries.json"));
}

loadGalleries()
  .then((loadedGalleries) => {
    galleries = loadedGalleries;
    Object.entries(galleries).forEach(([galleryName, images]) => {
      if (!images.length) return;
      setupGallery(galleryName);
    });
  })
  .catch((error) => {
    console.error(error);
  });

closeButton.addEventListener("click", hideLightbox);
previousButton.addEventListener("click", () => advanceLightbox(-1));
nextButton.addEventListener("click", () => advanceLightbox(1));
lightbox.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  advanceLightbox(event.clientX < window.innerWidth / 2 ? -1 : 1);
});

lightbox.addEventListener("wheel", (event) => {
  if (!lightboxState) return;
  event.preventDefault();
  advanceLightbox(event.deltaY > 0 ? 1 : -1);
}, { passive: false });

addSwipeNavigation(lightbox, (direction) => advanceLightbox(direction));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !lightbox.hidden) hideLightbox();
});
