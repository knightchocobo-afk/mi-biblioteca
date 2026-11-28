// =========================================================================
// MÓDULO EXTERNO: DETECTOR VISUAL DE DUPLICADOS DE ALTA PRECISIÓN (512 BITS)
// =========================================================================
(function () {
  // Porcentaje mínimo de similitud (88% equivale a ~61 bits de diferencia sobre 512)
  if (typeof duplicateFinderState.minSimilarityPct !== 'number') {
    duplicateFinderState.minSimilarityPct = 88;
  }

  // Huella dHash bidireccional (17x16 horizontal + 16x17 vertical = 512 bits) + versión espejo
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

          // Recortar 4% de bordes exteriores para evitar que marcos o marcas de agua alteren la huella
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

          // Normalizar brillo/contraste (ecualización min-max) para resistir cambios de tono
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

          // 1. Gradientes horizontales (16x16 = 256 bits)
          for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
              const left = gray[y * W + x];
              const right = gray[y * W + (x + 1)];
              normalBits += left > right ? '1' : '0';

              const mLeft = gray[y * W + (16 - x)];
              const mRight = gray[y * W + (15 - x)];
              mirrorBits += mLeft > mRight ? '1' : '0';
            }
          }

          // 2. Gradientes verticales (16x16 = 256 bits)
          for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
              const top = gray[y * W + x];
              const bottom = gray[(y + 1) * W + x];
              normalBits += top > bottom ? '1' : '0';

              const mTop = gray[y * W + (15 - x)];
              const mBottom = gray[(y + 1) * W + (15 - x)];
              mirrorBits += mTop > mBottom ? '1' : '0';
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

  // Devuelve distancia mínima considerando imagen normal o volteada en espejo
  window.getVisualDistance = function (fp1, fp2) {
    if (!fp1 || !fp2) return 9999;
    // Compatibilidad si quedara algún string viejo en caché
    if (typeof fp1 === 'string' || typeof fp2 === 'string') {
      return hammingDistance(String(fp1), String(fp2));
    }
    // Si la proporción ancho/alto difiere demasiado (>35%), no son la misma imagen
    const ratioDiff = Math.abs(fp1.aspect - fp2.aspect) / Math.max(fp1.aspect, fp2.aspect);
    if (ratioDiff > 0.35) return 9999;

    const dNormal = hammingDistance(fp1.normal, fp2.normal);
    const dMirror = hammingDistance(fp1.normal, fp2.mirror);
    return Math.min(dNormal, dMirror);
  };

  // Recolector sin límite corto de profundidad
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

  // Escaneo mejorado: agrupa primero por MD5 exacto y luego por similitud visual de 512 bits
  window.runDuplicateVisualScan = async function () {
    if (!driveConfig.accessToken) return;
    duplicateFinderState.scanning = true;
    duplicateFinderState.groups = [];
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

  // Añadir selector de sensibilidad en la barra del detector de duplicados sin tocar renderDuplicatesView
  const origRenderDuplicatesView = window.renderDuplicatesView;
  window.renderDuplicatesView = function (breadcrumb, actions, grid) {
    origRenderDuplicatesView.apply(this, arguments);
    if (!actions || document.getElementById('dup-similarity-select')) return;

    const select = document.createElement('select');
    select.id = 'dup-similarity-select';
    select.className = 'px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200';
    select.innerHTML = `
      <option value="95" ${duplicateFinderState.minSimilarityPct === 95 ? 'selected' : ''}>🎯 Muy exactas (95%)</option>
      <option value="88" ${duplicateFinderState.minSimilarityPct === 88 ? 'selected' : ''}>✨ Recomendado (88%)</option>
      <option value="80" ${duplicateFinderState.minSimilarityPct === 80 ? 'selected' : ''}>🔎 Parecidas / Editadas (80%)</option>
    `;
    select.onchange = function () {
      duplicateFinderState.minSimilarityPct = Number(this.value) || 88;
      if (duplicateFinderState.totalScanned > 0) runDuplicateVisualScan();
    };
    actions.insertBefore(select, actions.firstChild);
  };
})();
