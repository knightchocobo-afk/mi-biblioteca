// =========================================================================
// MÓDULO EXTERNO: DETECTOR VISUAL DE DUPLICADOS (512 BITS + COMPARADOR + BORRADO MASIVO)
// =========================================================================
(function () {
  if (typeof duplicateFinderState.minSimilarityPct !== 'number') {
    duplicateFinderState.minSimilarityPct = 88;
  }
  if (!duplicateFinderState.selectedForDelete) {
    duplicateFinderState.selectedForDelete = new Set();
  }

  // Huella dHash bidireccional (17x16 horizontal + 16x17 vertical = 512 bits) + espejo
  window.computePerceptualFingerprintFromUrl = function (url) {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const W = 17;
          const H = 17;
          const canvas = document.createElement('canvas');
          canvas.width = W;
          canvas.height = H;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          const sw = img.naturalWidth || img.width;
          const sh = img.naturalHeight || img.height;
          const padX = Math.floor(sw * 0.04);
          const padY = Math.floor(sh * 0.04);
          ctx.drawImage(
            img,
            padX,
            padY,
            Math.max(1, sw - padX * 2),
            Math.max(1, sh - padY * 2),
            0,
            0,
            W,
            H
          );

          const data = ctx.getImageData(0, 0, W, H).data;
          const gray = new Float32Array(W * H);

          let minG = 255;
          let maxG = 0;
          for (let i = 0; i < W * H; i++) {
            const p = i * 4;
            const g = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
            gray[i] = g;
            if (g < minG) minG = g;
            if (g > maxG) maxG = g;
          }
          const span = Math.max(1, maxG - minG);
          for (let i = 0; i < gray.length; i++) {
            gray[i] = ((gray[i] - minG) / span) * 255;
          }

          let normalBits = '';
          let mirrorBits = '';

          for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
              normalBits += gray[y * W + x] > gray[y * W + (x + 1)] ? '1' : '0';
              mirrorBits += gray[y * W + (16 - x)] > gray[y * W + (15 - x)] ? '1' : '0';
            }
          }

          for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
              normalBits += gray[y * W + x] > gray[(y + 1) * W + x] ? '1' : '0';
              mirrorBits += gray[y * W + (15 - x)] > gray[(y + 1) * W + (15 - x)] ? '1' : '0';
            }
          }

          resolve({
            normal: normalBits,
            mirror: mirrorBits,
            aspect: sw / Math.max(1, sh)
          });
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  };

  function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return 9999;
    let d = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) d++;
    }
    return d;
  }

  window.getVisualDistance = function (fp1, fp2) {
    if (!fp1 || !fp2) return 9999;
    if (typeof fp1 === 'string' || typeof fp2 === 'string') {
      return hammingDistance(String(fp1), String(fp2));
    }
    const ratioDiff = Math.abs(fp1.aspect - fp2.aspect) / Math.max(fp1.aspect, fp2.aspect);
    if (ratioDiff > 0.35) return 9999;
    return Math.min(hammingDistance(fp1.normal, fp2.normal), hammingDistance(fp1.normal, fp2.mirror));
  };

  window.collectAllImagesForDuplicatesScan = async function (folderId, recursive = true, depth = 0) {
    if (depth > 12) return [];
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const items = await driveFetchAllPages(
      `https://www.googleapis.com/drive/v3/files?q=${q}&includeItemsFromAllDrives=true&supportsAllDrives=true&fields=nextPageToken,files(id,name,mimeType,size,md5Checksum)`
    );
    let images = [];
    for (const it of items) {
      const mime = it.mimeType || '';
      if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(it.name || '')) {
        images.push({
          id: it.id,
          name: it.name,
          size: Number(it.size) || 0,
          md5: it.md5Checksum || ''
        });
      } else if (recursive && mime === 'application/vnd.google-apps.folder') {
        const subImgs = await collectAllImagesForDuplicatesScan(it.id, true, depth + 1);
        images = images.concat(subImgs);
      }
    }
    return images;
  };

  window.runDuplicateVisualScan = async function () {
    if (!driveConfig.accessToken) return;
    duplicateFinderState.scanning = true;
    duplicateFinderState.groups = [];
    duplicateFinderState.selectedForDelete.clear();
    duplicateFinderState.progressText = 'Listando todas las imágenes de la carpeta...';
    renderAll();

    try {
      const images = await collectAllImagesForDuplicatesScan(
        duplicateFinderState.targetFolderId,
        duplicateFinderState.includeSubfolders
      );
      duplicateFinderState.totalScanned = images.length;

      const fingerprinted = [];
      for (let i = 0; i < images.length; i += 8) {
        duplicateFinderState.progressText = `Analizando huella visual: ${Math.min(i + 8, images.length)} de ${images.length} imágenes...`;
        renderAll();
        const batch = images.slice(i, i + 8);
        await Promise.all(
          batch.map(async (img) => {
            let fp = driveConfig.imageHashCache.get(img.id + '_v2');
            if (!fp) {
              const url = await resolveDriveBlobUrl(img.id);
              fp = await computePerceptualFingerprintFromUrl(url);
              if (fp) driveConfig.imageHashCache.set(img.id + '_v2', fp);
            }
            if (fp) fingerprinted.push({ ...img, fp });
          })
        );
      }

      const maxAllowedDist = Math.round(512 * ((100 - duplicateFinderState.minSimilarityPct) / 100));
      const visited = new Array(fingerprinted.length).fill(false);
      const groups = [];

      for (let i = 0; i < fingerprinted.length; i++) {
        if (visited[i]) continue;
        const group = [fingerprinted[i]];
        visited[i] = true;

        for (let j = i + 1; j < fingerprinted.length; j++) {
          if (visited[j]) continue;
          const sameMd5 =
            fingerprinted[i].md5 &&
            fingerprinted[j].md5 &&
            fingerprinted[i].md5 === fingerprinted[j].md5;
          const dist = sameMd5 ? 0 : getVisualDistance(fingerprinted[i].fp, fingerprinted[j].fp);

          if (sameMd5 || dist <= maxAllowedDist) {
            const simPct = sameMd5 ? 100 : Math.max(0, Math.round((1 - dist / 512) * 100));
            fingerprinted[j].similarityPct = simPct;
            group.push(fingerprinted[j]);
            visited[j] = true;
          }
        }

        if (group.length > 1) {
          group.sort((a, b) => b.size - a.size);
          groups.push(group);
        }
      }

      duplicateFinderState.groups = groups;
    } finally {
      duplicateFinderState.scanning = false;
      renderAll();
    }
  };

  // Abrir las copias de un grupo en el visor Lightbox para compararlas con zoom
  window.openDuplicateGroupInLightbox = function (groupIdx, itemIdx) {
    const group = duplicateFinderState.groups[groupIdx];
    if (!group || !group.length) return;
    const lightboxItems = group.map((item, idx) => ({
      id: item.id,
      driveId: item.id,
      title: `${idx === 0 ? '[Mayor peso] ' : `[Copia ${idx + 1}] `}${item.name} (${formatFileSize(item.size)})`,
      tags: item.similarityPct ? [`parecido ${item.similarityPct}%`] : [],
      favorite: false
    }));
    openLightbox(lightboxItems, itemIdx);
  };

  // Seleccionar / deseleccionar una copia para borrar
  window.toggleDuplicateDeleteSelection = function (fileId) {
    if (duplicateFinderState.selectedForDelete.has(fileId)) {
      duplicateFinderState.selectedForDelete.delete(fileId);
    } else {
      duplicateFinderState.selectedForDelete.add(fileId);
    }
    renderAll();
  };

  // Seleccionar todas las copias secundarias de un grupo (deja libre la de mayor peso)
  window.selectSmallerDuplicatesInGroup = function (groupIdx) {
    const group = duplicateFinderState.groups[groupIdx];
    if (!group || group.length < 2) return;
    for (let i = 1; i < group.length; i++) {
      duplicateFinderState.selectedForDelete.add(group[i].id);
    }
    renderAll();
  };

  // Seleccionar todas las copias secundarias de TODOS los grupos
  window.selectAllSmallerDuplicates = function () {
    for (const group of duplicateFinderState.groups) {
      for (let i = 1; i < group.length; i++) {
        duplicateFinderState.selectedForDelete.add(group[i].id);
      }
    }
    renderAll();
  };

  window.clearDuplicateDeleteSelection = function () {
    duplicateFinderState.selectedForDelete.clear();
    renderAll();
  };

  // Borrar en bloque todas las copias seleccionadas
  window.deleteSelectedDuplicateItems = async function () {
    const ids = Array.from(duplicateFinderState.selectedForDelete);
    if (!ids.length) return;

    const ok = await askYesNoConfirm({
      title: 'Borrar duplicados seleccionados',
      message: `¿Enviar ${ids.length} imagen(es) seleccionada(s) a la papelera de Google Drive?`,
      doubleStep: true,
      icon: '🗑️',
      yesLabel: 'Sí, borrar seleccionadas',
      noLabel: 'No'
    });
    if (!ok) return;

    for (const fileId of ids) {
      await trashDriveItemById(fileId);
      removeDriveIdFromCatalog(fileId);
    }

    duplicateFinderState.selectedForDelete.clear();
    await persistLibrary(`Borradas ${ids.length} copia(s) duplicada(s)`);

    const deletedSet = new Set(ids);
    duplicateFinderState.groups = duplicateFinderState.groups
      .map((g) => g.filter((item) => !deletedSet.has(item.id)))
      .filter((g) => g.length > 1);

    renderAll();
    showToast(`🗑️ ${ids.length} copia(s) enviada(s) a la papelera`);
  };

  // Render completo mejorado para el Detector de Duplicados
  window.renderDuplicatesView = function (breadcrumb, actions, grid) {
    const selCount = duplicateFinderState.selectedForDelete.size;

    breadcrumb.innerHTML = `<span class="font-bold text-white">👯 Detector Visual de Duplicados</span>`;
    actions.innerHTML = `
      <select id="dup-similarity-select" onchange="duplicateFinderState.minSimilarityPct = Number(this.value) || 88; if (duplicateFinderState.totalScanned > 0) runDuplicateVisualScan();" class="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200">
        <option value="95" ${duplicateFinderState.minSimilarityPct === 95 ? 'selected' : ''}>🎯 Muy exactas (95%)</option>
        <option value="88" ${duplicateFinderState.minSimilarityPct === 88 ? 'selected' : ''}>✨ Recomendado (88%)</option>
        <option value="80" ${duplicateFinderState.minSimilarityPct === 80 ? 'selected' : ''}>🔎 Parecidas / Editadas (80%)</option>
      </select>
      <button onclick="openDupFolderPickerModal()" class="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-indigo-300">
        📂 Carpeta: ${escapeHtml(duplicateFinderState.targetFolderName)}
      </button>
      <button onclick="runDuplicateVisualScan()" ${duplicateFinderState.scanning ? 'disabled' : ''} class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow disabled:opacity-50">
        ${duplicateFinderState.scanning ? '⏳ Analizando...' : '🔍 Buscar Duplicados'}
      </button>
    `;

    if (!driveConfig.accessToken) {
      grid.innerHTML = `
        <div class="col-span-full py-16 text-center space-y-3">
          <div class="text-4xl">☁️</div>
          <div class="text-base font-bold text-white">Conecta Google Drive para analizar imágenes duplicadas</div>
          <button onclick="openDriveModal()" class="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold">Conectar ahora</button>
        </div>
      `;
      return;
    }

    if (duplicateFinderState.scanning) {
      grid.innerHTML = `<div class="col-span-full py-16 text-center text-sm text-indigo-300">${escapeHtml(duplicateFinderState.progressText || 'Analizando imágenes...')}</div>`;
      return;
    }

    if (!duplicateFinderState.groups.length) {
      grid.innerHTML = `
        <div class="col-span-full py-14 text-center space-y-3 bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <div class="text-4xl">👯</div>
          <div class="text-sm font-bold text-white">
            ${duplicateFinderState.totalScanned > 0
              ? `Se analizaron ${duplicateFinderState.totalScanned} imágenes en "${escapeHtml(duplicateFinderState.targetFolderName)}" y no se encontraron copias repetidas.`
              : `Selecciona una carpeta de Google Drive y pulsa "Buscar Duplicados" para agrupar copias iguales o comprimidas.`}
          </div>
          <label class="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input type="checkbox" ${duplicateFinderState.includeSubfolders ? 'checked' : ''} onchange="duplicateFinderState.includeSubfolders = this.checked" class="w-4 h-4 accent-indigo-500" />
            <span>Incluir subcarpetas</span>
          </label>
        </div>
      `;
      return;
    }

    grid.innerHTML = `
      <div class="col-span-full space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-2 text-xs text-slate-300 bg-slate-900 border border-slate-800 px-4 py-3 rounded-xl">
          <div>
            Se encontraron <strong class="text-rose-300">${duplicateFinderState.groups.length} grupo(s)</strong> entre ${duplicateFinderState.totalScanned} imágenes.
            <span class="text-slate-400 block sm:inline sm:ml-1">Toca cualquier imagen para abrirla en grande con zoom y comparar.</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button onclick="selectAllSmallerDuplicates()" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-200 font-semibold">
              ☑️ Marcar todas las de menor peso
            </button>
            ${selCount > 0 ? `
              <button onclick="clearDuplicateDeleteSelection()" class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300">
                Desmarcar (${selCount})
              </button>
              <button onclick="deleteSelectedDuplicateItems()" class="px-3.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold shadow">
                🗑️ Borrar ${selCount} seleccionada(s)
              </button>
            ` : ''}
          </div>
        </div>

        ${duplicateFinderState.groups.map((group, gIdx) => `
          <div class="p-3.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5">
            <div class="flex items-center justify-between flex-wrap gap-2 text-xs">
              <span class="font-bold text-rose-300">Grupo #${gIdx + 1} — ${group.length} copias detectadas</span>
              <button onclick="selectSmallerDuplicatesInGroup(${gIdx})" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-200 font-semibold text-[11px]">
                ☑️ Marcar copias menores de este grupo
              </button>
            </div>
            <div class="flex gap-3 overflow-x-auto pb-2">
              ${group.map((item, idx) => {
                const isMarked = duplicateFinderState.selectedForDelete.has(item.id);
                return `
                  <div class="w-48 shrink-0 rounded-xl overflow-hidden bg-slate-950 border ${isMarked ? 'border-rose-500 ring-2 ring-rose-500/60' : idx === 0 ? 'border-emerald-500/60' : 'border-slate-800'} flex flex-col">
                    <div onclick="openDuplicateGroupInLightbox(${gIdx}, ${idx})" title="Tocar para abrir en visor y comparar" class="relative aspect-[3/4] bg-slate-800 cursor-pointer group">
                      <img data-drive-id="${item.id}" src="" alt="" class="opacity-0 transition-opacity duration-200 w-full h-full object-cover" />
                      <span class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded text-[10px] font-bold ${idx === 0 ? 'bg-emerald-600 text-white' : 'bg-black/75 text-slate-200'}">
                        ${idx === 0 ? 'Mayor peso' : `Copia ${idx + 1}${item.similarityPct ? ` (${item.similarityPct}%)` : ''}`}
                      </span>
                      <button type="button" onclick="event.stopPropagation(); toggleDuplicateDeleteSelection('${item.id}');" title="Seleccionar para borrar" class="absolute top-1.5 right-1.5 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shadow ${isMarked ? 'bg-rose-600 text-white' : 'bg-black/75 text-slate-200 border border-slate-400'}">
                        ${isMarked ? '✓' : ''}
                      </button>
                      <span class="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded bg-black/80 text-[10px] font-semibold text-indigo-200">
                        🔍 Ver
                      </span>
                      <span class="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded bg-black/80 text-[11px] font-bold text-white">
                        ${formatFileSize(item.size)}
                      </span>
                    </div>
                    <div class="p-2 space-y-1.5">
                      <div class="text-[11px] text-slate-200 truncate" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
                      <button type="button" onclick="toggleDuplicateDeleteSelection('${item.id}')" class="w-full py-1.5 rounded-lg ${isMarked ? 'bg-rose-600 text-white font-bold' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold'} text-[11px] transition">
                        ${isMarked ? '☑️ Marcada para borrar' : '☐ Seleccionar para borrar'}
                      </button>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  };
})();
