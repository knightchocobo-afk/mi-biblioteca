// =========================================================================
// MÓDULO EXTERNO: MODO MOSAICO (AJUSTE TOTAL) + SELECTOR DE 3 A 6 COLUMNAS
// =========================================================================
(function () {
  state.mosaicMode = localStorage.getItem('mi_boveda_mosaic_mode') === '1';

  const savedCols = Number(localStorage.getItem('mi_boveda_grid_cols'));
  state.gridCols = [3, 4, 5, 6].includes(savedCols) ? savedCols : 4;

  const GRID_COLS_CLASSES = {
    3: 'grid-cols-3 sm:grid-cols-3',
    4: 'grid-cols-4 sm:grid-cols-4',
    5: 'grid-cols-5 sm:grid-cols-5',
    6: 'grid-cols-6 sm:grid-cols-6'
  };

  window.updateMosaicModeButtonUI = function () {
    const btn = document.getElementById('mosaic-mode-btn');
    const label = document.getElementById('mosaic-mode-label');
    if (!btn || !label) return;
    if (state.mosaicMode) {
      label.textContent = 'Mosaico ON';
      btn.classList.add('border-emerald-500', 'bg-emerald-600/25', 'text-emerald-200');
    } else {
      label.textContent = 'Mosaico';
      btn.classList.remove('border-emerald-500', 'bg-emerald-600/25', 'text-emerald-200');
    }
  };

  window.updateGridColsButtonUI = function () {
    const btn = document.getElementById('grid-cols-cycle-btn');
    if (!btn) return;
    btn.innerHTML = `<span>📐</span><span>${state.gridCols} col</span>`;
  };

  window.cycleGridColumns = function () {
    const order = [3, 4, 5, 6];
    const nextIdx = (order.indexOf(state.gridCols) + 1) % order.length;
    state.gridCols = order[nextIdx];
    try {
      localStorage.setItem('mi_boveda_grid_cols', String(state.gridCols));
    } catch (e) {}
    updateGridColsButtonUI();
    applyGridColumnsAndMosaic();
  };

  window.toggleMosaicMode = function () {
    state.mosaicMode = !state.mosaicMode;
    try {
      localStorage.setItem('mi_boveda_mosaic_mode', state.mosaicMode ? '1' : '0');
    } catch (e) {}
    if (!state.mosaicMode) {
      state.selectedImageIds.clear();
      driveBrowserState.selectedIds.clear();
    }
    updateMosaicModeButtonUI();
    renderAll();
  };

  function injectToolbarControls() {
    const refBtn = document.getElementById('thumb-fit-btn');
    if (!refBtn) return;

    // Botón selector de columnas (3 a 6) visible también en tablet/móvil
    if (!document.getElementById('grid-cols-cycle-btn')) {
      const oldDensityBtn = document.getElementById('grid-density-btn');
      if (oldDensityBtn) oldDensityBtn.classList.add('hidden');

      const colsBtn = document.createElement('button');
      colsBtn.id = 'grid-cols-cycle-btn';
      colsBtn.type = 'button';
      colsBtn.onclick = cycleGridColumns;
      colsBtn.title = 'Cambiar cantidad de imágenes por fila (3, 4, 5 o 6)';
      colsBtn.className = 'flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 hover:border-indigo-500 shrink-0';
      refBtn.insertAdjacentElement('beforebegin', colsBtn);
      updateGridColsButtonUI();
    }

    // Botón Modo Mosaico
    if (!document.getElementById('mosaic-mode-btn')) {
      const btn = document.createElement('button');
      btn.id = 'mosaic-mode-btn';
      btn.type = 'button';
      btn.onclick = toggleMosaicMode;
      btn.title = 'Modo Mosaico: ajusta la imagen al recuadro completo, toca imagen para seleccionar y nombre para abrir';
      btn.className = 'flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 hover:border-indigo-500 shrink-0';
      btn.innerHTML = '<span>⊞</span><span id="mosaic-mode-label" class="hidden sm:inline">Mosaico</span>';
      refBtn.insertAdjacentElement('afterend', btn);
      updateMosaicModeButtonUI();
    }
  }

  function forceFullFillSquareInMosaic(card, clickBox) {
    // Quitar expansiones de 2 filas/columnas del modo "Completa" para que no queden huecos
    card.classList.remove('col-span-2', 'row-span-2');
    clickBox.classList.remove('aspect-[1/2]', 'aspect-[2/1]', 'min-h-[120px]', 'bg-slate-950/95');
    clickBox.classList.add('aspect-square', 'w-full', 'h-full');

    // Forzar que todas las imágenes llenen el recuadro al 100% sin franjas negras
    const imgs = clickBox.querySelectorAll('img');
    imgs.forEach((img) => {
      img.classList.remove('object-contain');
      img.classList.add('object-cover', 'w-full', 'h-full');
      img.style.objectFit = 'cover';
      img.style.width = '100%';
      img.style.height = '100%';
    });
  }

  function applyGridColumnsAndMosaic() {
    const grid = document.getElementById('main-grid');
    if (!grid) return;

    const colsClass = GRID_COLS_CLASSES[state.gridCols] || 'grid-cols-4 sm:grid-cols-4';
    const gapClass = state.mosaicMode ? 'gap-1' : 'gap-2.5';
    grid.className = `grid ${colsClass} ${gapClass} grid-flow-dense`;

    // Aplicar también las columnas elegidas a las subcuadrículas (ej. resultados de tags)
    grid.querySelectorAll('.grid').forEach((subGrid) => {
      subGrid.className = `grid ${colsClass} ${gapClass} grid-flow-dense`;
    });

    if (!state.mosaicMode) return;

    // Mostrar barra de acciones masivas en Artistas si hay selección
    const bulkBar = document.getElementById('bulk-select-bar');
    if (bulkBar && state.section === 'artistas' && state.artistId && state.selectedImageIds.size > 0) {
      bulkBar.classList.remove('hidden');
      bulkBar.classList.add('flex');
      const countEl = document.getElementById('bulk-selected-count');
      if (countEl) countEl.textContent = state.selectedImageIds.size;
    }

    const cards = grid.querySelectorAll('.card-hover');
    cards.forEach((card) => {
      const clickBox = card.firstElementChild;
      if (!clickBox) return;

      forceFullFillSquareInMosaic(card, clickBox);

      const originalOnclick = clickBox.getAttribute('onclick') || '';
      const bottomBar = clickBox.lastElementChild;

      // Detectar si es seleccionable (imagen de Artista o archivo en Explorador Drive)
      const favBtn = card.querySelector('button[onclick*="toggleItemFavorite"]');
      const driveSelBtn = card.querySelector('button[onclick*="toggleSelectDriveBrowserItem"]');

      let selectAction = null;
      let isSelected = false;

      if (favBtn) {
        const m = favBtn.getAttribute('onclick').match(/toggleItemFavorite\('artistas',\s*'[^']*',\s*'[^']*',\s*'([^']+)'\)/);
        if (m && m[1]) {
          const imgId = m[1];
          isSelected = state.selectedImageIds.has(imgId);
          selectAction = () => toggleSelectArtistImage(imgId);
        }
      } else if (driveSelBtn) {
        const m = driveSelBtn.getAttribute('onclick').match(/toggleSelectDriveBrowserItem\('([^']+)'\)/);
        if (m && m[1]) {
          const fileId = m[1];
          isSelected = driveBrowserState.selectedIds.has(fileId);
          selectAction = () => toggleSelectDriveBrowserItem(fileId);
        }
      }

      // Estilo compacto sin bordes redondeados en Modo Mosaico
      card.classList.remove('rounded-2xl', 'border-slate-800', 'border-amber-500/40');
      card.classList.add('rounded-none', 'border', isSelected ? 'border-emerald-400' : 'border-slate-950');
      if (isSelected) card.classList.add('ring-2', 'ring-emerald-500');

      if (selectAction) {
        clickBox.onclick = function (e) {
          e.stopPropagation();
          selectAction();
        };

        if (isSelected && !card.querySelector('.mosaic-check-badge')) {
          const badge = document.createElement('span');
          badge.className = 'mosaic-check-badge absolute top-1.5 left-1.5 z-20 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shadow';
          badge.textContent = '✓';
          clickBox.appendChild(badge);
        }
      }

      // Franja inferior sombreada con el nombre: tocarla abre la imagen/carpeta
      if (bottomBar && originalOnclick) {
        const titleEl = bottomBar.querySelector('.truncate');
        const titleText = titleEl ? titleEl.textContent : '';
        bottomBar.className = 'absolute inset-x-0 bottom-0 z-20 bg-black/75 hover:bg-indigo-900/90 px-2 py-1.5 cursor-pointer flex items-center justify-between gap-1';
        bottomBar.innerHTML = `<span class="text-[11px] font-medium text-white truncate">${escapeHtml(titleText)}</span><span class="text-[10px] text-slate-300 shrink-0">↗</span>`;
        bottomBar.onclick = function (e) {
          e.stopPropagation();
          new Function(originalOnclick).call(clickBox);
        };
      }
    });
  }

  // Evitar que applyAdaptiveThumbAspect vuelva a poner franjas negras cuando Mosaico está activo
  if (typeof window.applyAdaptiveThumbAspect === 'function') {
    const origApplyAdaptiveThumbAspect = window.applyAdaptiveThumbAspect;
    window.applyAdaptiveThumbAspect = function (img) {
      if (state.mosaicMode && img) {
        const wrapper = img.parentElement;
        const card = wrapper ? wrapper.closest('.card-hover') : null;
        if (card && wrapper) {
          forceFullFillSquareInMosaic(card, wrapper);
        }
        return;
      }
      origApplyAdaptiveThumbAspect.apply(this, arguments);
    };
  }

  // Envolver renderAll sin tocar el archivo original
  const originalRenderAll = window.renderAll;
  window.renderAll = function () {
    originalRenderAll.apply(this, arguments);
    injectToolbarControls();
    applyGridColumnsAndMosaic();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectToolbarControls();
      applyGridColumnsAndMosaic();
    });
  } else {
    injectToolbarControls();
    applyGridColumnsAndMosaic();
  }
})();
