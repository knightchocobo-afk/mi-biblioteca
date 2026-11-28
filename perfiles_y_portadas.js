// =========================================================================
// MÓDULO EXTERNO: MODO COMPLETA EXACTO (ALTURA MATEMÁTICA 2x1 = 2x(1x1)+GAP) + PERFIL
// =========================================================================
(function () {
  window.getThumbWrapperClass = function (baseExtra = '') {
    return `relative w-full h-full aspect-square bg-slate-800 cursor-pointer flex items-center justify-center overflow-hidden ${baseExtra}`;
  };

  window.getThumbImgClass = function (isLazyDrive = false) {
    const base = 'w-full h-full object-cover';
    return isLazyDrive ? `opacity-0 transition-opacity duration-200 ${base}` : base;
  };

  // Recalcular la altura exacta de cada fila del grid para que 2 cuadradas/anchas = 1 larga
  function syncExactGridRowHeight() {
    const grid = document.getElementById('main-grid');
    if (!grid) return;

    if (!state.fullThumbMode || state.mosaicMode) {
      grid.style.gridAutoRows = '';
      grid.style.gridAutoFlow = '';
      return;
    }

    const cols = Number(state.gridCols) || 4;
    const gapPx = 10; // equivale a gap-2.5 (0.625rem = 10px)
    const gridWidth = grid.clientWidth;
    if (!gridWidth) return;

    const colWidth = Math.floor((gridWidth - gapPx * (cols - 1)) / cols);
    if (colWidth > 20) {
      grid.style.gridAutoRows = `${colWidth}px`;
      grid.style.gridAutoFlow = 'dense';
    }
  }

  function resetCardGridSpan(card, wrapper) {
    card.classList.remove('col-span-2', 'row-span-2');
    card.style.height = '';
    wrapper.classList.remove('aspect-square', 'aspect-[1/2]', 'aspect-[2/1]', 'min-h-[120px]', 'bg-slate-950/95');
    wrapper.style.height = '';
  }

  // Clasificar cada imagen en 1x1, 2x1 (larga) o 1x2 (ancha) ajustándose a la fila exacta del grid
  window.applyAdaptiveThumbAspect = function (img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const wrapper = img.parentElement;
    const card = wrapper ? wrapper.closest('.card-hover') : null;
    if (!wrapper || !card) return;

    if (state.mosaicMode) return;

    // Portadas de artistas en la vista raíz (siempre 2 de largo x 1 de ancho)
    if (wrapper.dataset.forceArtistCover === '1') {
      resetCardGridSpan(card, wrapper);
      wrapper.classList.add('aspect-[1/2]');
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      return;
    }

    resetCardGridSpan(card, wrapper);

    if (!state.fullThumbMode) {
      wrapper.classList.add('aspect-square');
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      return;
    }

    // En Modo Completa: la tarjeta llena el 100% de sus celdas asignadas (1x1, 2x1 o 1x2)
    card.style.height = '100%';
    wrapper.style.height = '100%';

    const ratio = img.naturalWidth / img.naturalHeight;
    if (ratio < 0.72) {
      // Larga: ocupa 2 filas de alto x 1 columna de ancho (incluye el gap central automáticamente)
      card.classList.add('row-span-2');
    } else if (ratio > 1.38) {
      // Ancha: ocupa 1 fila de alto x 2 columnas de ancho
      card.classList.add('col-span-2');
    }

    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.style.display = 'block';
  };

  // Portadas de artistas el doble de largas en Historia, Comics y Artistas
  function enforceDoubleHeightArtistCovers() {
    const isArtistRootView =
      state.activeTags.length === 0 &&
      ['historia', 'comics', 'artistas'].includes(state.section) &&
      !state.artistId;

    if (!isArtistRootView) return;

    const grid = document.getElementById('main-grid');
    if (!grid) return;

    grid.querySelectorAll('.card-hover').forEach((card) => {
      const wrapper = card.firstElementChild;
      if (!wrapper) return;
      wrapper.dataset.forceArtistCover = '1';
      resetCardGridSpan(card, wrapper);
      wrapper.classList.add('aspect-[1/2]');

      const img = wrapper.querySelector('img');
      if (img) {
        img.classList.remove('h-auto', 'object-contain');
        img.classList.add('w-full', 'h-full', 'object-cover');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
      }
    });
  }

  // Estadísticas y perfil de artista
  function computeArtistProfileStats(section, artist) {
    let totalItems = 0;
    let extraLabel = '';
    let latestTs = Number(artist.updatedAt) || Number(artist.createdAt) || 0;

    const touchTs = (ts) => {
      const n = Number(ts) || 0;
      if (n > latestTs) latestTs = n;
    };

    if (section === 'artistas') {
      const looseCount = (artist.images || []).length;
      const foldersCount = (artist.folders || []).length;
      let folderImgsCount = 0;
      (artist.images || []).forEach((i) => touchTs(i.createdAt));
      (artist.folders || []).forEach((f) => {
        touchTs(f.createdAt);
        folderImgsCount += (f.images || []).length;
        (f.images || []).forEach((i) => touchTs(i.createdAt));
      });
      totalItems = looseCount + folderImgsCount;
      extraLabel = `${totalItems} imagen(es) • ${foldersCount} carpeta(s)`;
    } else if (section === 'comics') {
      const comicsCount = (artist.comics || []).length;
      let pagesCount = 0;
      (artist.comics || []).forEach((c) => {
        touchTs(c.createdAt);
        pagesCount += (c.pages || []).length;
        (c.pages || []).forEach((p) => touchTs(p.createdAt));
      });
      totalItems = comicsCount;
      extraLabel = `${comicsCount} cómic(s) • ${pagesCount} página(s)`;
    } else if (section === 'historia') {
      totalItems = (artist.items || []).length;
      (artist.items || []).forEach((st) => touchTs(st.createdAt));
      extraLabel = `${totalItems} documento(s) / historia(s)`;
    }

    const dateStr = latestTs
      ? new Date(latestTs).toLocaleDateString('es-ES', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      : 'Sin fecha';

    return { totalItems, extraLabel, dateStr };
  }

  window.saveArtistProfileNote = async function (section, artistId) {
    const artist = (libraryData[section] || []).find((a) => a.id === artistId);
    const textarea = document.getElementById('artist-profile-note-input');
    if (!artist || !textarea) return;

    artist.note = textarea.value.trim();
    artist.updatedAt = Date.now();
    await persistLibrary(`Actualizada nota de perfil de ${artist.name}`);
    renderAll();
    showToast('📝 Nota del perfil guardada');
  };

  function injectArtistProfileBanner() {
    const existing = document.getElementById('artist-profile-card');
    if (existing) existing.remove();

    const isInsideArtist =
      state.activeTags.length === 0 &&
      ['historia', 'comics', 'artistas'].includes(state.section) &&
      !!state.artistId;

    if (!isInsideArtist) return;

    const artist = (libraryData[state.section] || []).find((a) => a.id === state.artistId);
    if (!artist) return;

    const cover = getArtistPreviewCover(artist, state.section);
    const stats = computeArtistProfileStats(state.section, artist);
    const linksHtml = renderArtistLinksBadges(artist.links, false);
    const tagsHtml = (artist.tags || [])
      .slice(0, 8)
      .map((t) => `<span class="px-2 py-0.5 rounded-full bg-indigo-950/90 border border-indigo-500/30 text-[10px] text-indigo-200">#${escapeHtml(t)}</span>`)
      .join('');

    const mainEl = document.querySelector('main');
    const topPagBar = document.getElementById('pagination-top-bar');
    if (!mainEl || !topPagBar) return;

    const card = document.createElement('section');
    card.id = 'artist-profile-card';
    card.className = 'mb-4 rounded-2xl bg-slate-900/90 border border-slate-800 p-3.5 sm:p-4 shadow-xl flex flex-col sm:flex-row gap-3.5 items-start';

    card.innerHTML = `
      <div class="w-20 sm:w-24 aspect-[1/2] rounded-xl overflow-hidden bg-slate-800 border border-slate-700 shrink-0 flex items-center justify-center">
        ${
          cover.url || cover.driveId
            ? `<img ${cover.driveId ? `data-drive-id="${cover.driveId}"` : ''} src="${escapeHtml(cover.url)}" alt="" class="w-full h-full object-cover ${cover.driveId ? 'opacity-0 transition-opacity duration-200' : ''}" />`
            : `<span class="text-3xl">${state.section === 'artistas' ? '🎨' : state.section === 'comics' ? '💬' : '📚'}</span>`
        }
      </div>

      <div class="flex-1 min-w-0 w-full space-y-2">
        <div class="flex items-start justify-between gap-2 flex-wrap">
          <div>
            <h2 class="text-base sm:text-lg font-bold text-white leading-tight">${escapeHtml(artist.name)}</h2>
            <div class="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-300">
              <span class="px-2 py-0.5 rounded-lg bg-slate-800 font-semibold text-emerald-300">📦 ${escapeHtml(stats.extraLabel)}</span>
              <span class="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">🕒 Última actualización: <strong>${escapeHtml(stats.dateStr)}</strong></span>
            </div>
          </div>
          <button type="button" onclick="openArtistModal('${state.section}', '${artist.id}')" class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-indigo-200 shrink-0">
            ✏️ Editar portada / links
          </button>
        </div>

        ${linksHtml ? `<div>${linksHtml}</div>` : ''}
        ${tagsHtml ? `<div class="flex flex-wrap gap-1">${tagsHtml}</div>` : ''}

        <div class="pt-1">
          <div class="flex items-center gap-2">
            <textarea id="artist-profile-note-input" rows="2" placeholder="Escribe una nota sobre este artista (estilo, comisiones, estado, comentarios...)" class="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 resize-none">${escapeHtml(artist.note || '')}</textarea>
            <button type="button" onclick="saveArtistProfileNote('${state.section}', '${artist.id}')" class="px-3.5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shrink-0 shadow">
              💾 Guardar nota
            </button>
          </div>
        </div>
      </div>
    `;

    mainEl.insertBefore(card, topPagBar);
  }

  const origRenderAll = window.renderAll;
  window.renderAll = function () {
    origRenderAll.apply(this, arguments);

    const grid = document.getElementById('main-grid');
    if (grid) {
      grid.style.columnCount = '';
      grid.style.columnGap = '';
      grid.querySelectorAll(':scope > .card-hover').forEach((card) => {
        card.style.breakInside = '';
        card.style.marginBottom = '';
        card.style.display = '';
        card.style.width = '';
      });
    }

    enforceDoubleHeightArtistCovers();
    injectArtistProfileBanner();
    syncExactGridRowHeight();

    document.querySelectorAll('#main-grid img').forEach((img) => {
      if (img.complete && img.naturalWidth > 0) {
        applyAdaptiveThumbAspect(img);
      }
    });
  };

  window.addEventListener('resize', syncExactGridRowHeight);
})();
