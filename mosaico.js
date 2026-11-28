// =========================================================================
// MÓDULO EXTERNO: MODO MOSAICO Y SELECCIÓN MÚLTIPLE (SIN TOCAR EL VISOR)
// =========================================================================
(function () {
  state.mosaicMode = localStorage.getItem('mi_boveda_mosaic_mode') === '1';

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

  function injectMosaicButton() {
    const refBtn = document.getElementById('thumb-fit-btn');
    if (!refBtn || document.getElementById('mosaic-mode-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'mosaic-mode-btn';
    btn.type = 'button';
    btn.onclick = toggleMosaicMode;
    btn.title = 'Modo Mosaico: toca la imagen para seleccionar varias y toca el nombre para abrir';
    btn.className = 'flex items-center gap-1 px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 hover:border-indigo-500 shrink-0';
    btn.innerHTML = '<span>⊞</span><span id="mosaic-mode-label" class="hidden sm:inline">Mosaico</span>';
    refBtn.insertAdjacentElement('afterend', btn);
    updateMosaicModeButtonUI();
  }

  function applyMosaicBehaviorToGrid() {
    if (!state.mosaicMode) return;
    const grid = document.getElementById('main-grid');
    if (!grid) return;

    // Ajustar cuadrícula compacta tipo mosaico
    grid.className = 'grid grid-cols-4 sm:grid-cols-6 gap-1 grid-flow-dense';

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

      const originalOnclick = clickBox.getAttribute('onclick') || '';
      const bottomBar = clickBox.lastElementChild;

      // Detectar ID de imagen en Artistas o archivo en Explorador Drive
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

      if (!selectAction) return;

      // Estilo compacto mosaico + borde verde si está seleccionada
      card.classList.remove('rounded-2xl', 'border-slate-800', 'border-amber-500/40');
      card.classList.add('rounded-none', 'border', isSelected ? 'border-emerald-400' : 'border-slate-900');
      if (isSelected) card.classList.add('ring-2', 'ring-emerald-500');

      // Al tocar la imagen -> selecciona / deselecciona
      clickBox.onclick = function (e) {
        e.stopPropagation();
        selectAction();
      };

      // Mostrar check verde arriba a la izquierda si está seleccionada
      if (isSelected && !card.querySelector('.mosaic-check-badge')) {
        const badge = document.createElement('span');
        badge.className = 'mosaic-check-badge absolute top-1.5 left-1.5 z-20 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold shadow';
        badge.textContent = '✓';
        clickBox.appendChild(badge);
      }

      // Al tocar la franja inferior sombreada del nombre -> abre la imagen/carpeta
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

  // Envolver renderAll sin modificar el código original
  const originalRenderAll = window.renderAll;
  window.renderAll = function () {
    originalRenderAll.apply(this, arguments);
    injectMosaicButton();
    applyMosaicBehaviorToGrid();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectMosaicButton();
      applyMosaicBehaviorToGrid();
    });
  } else {
    injectMosaicButton();
    applyMosaicBehaviorToGrid();
  }
})();
