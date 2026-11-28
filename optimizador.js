// =========================================================================
// MÓDULO EXTERNO: OPTIMIZADOR DE MEMORIA RAM, CACHÉ Y GUARDADO SEGURO
// =========================================================================
(function () {
  const MAX_BLOB_CACHE_ITEMS = 80;
  const MAX_THUMB_CACHE_ITEMS = 250;
  const thumbUrlCache = new Map();
  let persistQueuePromise = Promise.resolve();
  let pendingPersistLog = '';
  let persistScheduled = false;

  // 1. Limpiar URLs de memoria antiguas (LRU) para evitar que la tablet se quede sin RAM
  function trimBlobCacheIfNeeded() {
    if (!driveConfig || !driveConfig.driveBlobCache) return;
    while (driveConfig.driveBlobCache.size > MAX_BLOB_CACHE_ITEMS) {
      const oldestKey = driveConfig.driveBlobCache.keys().next().value;
      const oldestUrl = driveConfig.driveBlobCache.get(oldestKey);
      driveConfig.driveBlobCache.delete(oldestKey);
      if (oldestUrl && typeof oldestUrl === 'string' && oldestUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(oldestUrl);
        } catch (e) {}
      }
    }
  }

  // Envolver resolveDriveBlobUrl para aplicar el límite de memoria
  if (typeof window.resolveDriveBlobUrl === 'function') {
    const origResolveDriveBlobUrl = window.resolveDriveBlobUrl;
    window.resolveDriveBlobUrl = async function (driveId) {
      if (!driveId) return '';
      if (driveConfig.driveBlobCache.has(driveId)) {
        // Mover al final como recién usado
        const cached = driveConfig.driveBlobCache.get(driveId);
        driveConfig.driveBlobCache.delete(driveId);
        driveConfig.driveBlobCache.set(driveId, cached);
        return cached;
      }
      const url = await origResolveDriveBlobUrl.apply(this, arguments);
      trimBlobCacheIfNeeded();
      return url;
    };
  }

  // 2. Miniaturas ligeras para la cuadrícula (evita descargar 24 archivos de 10 MB de golpe)
  async function resolveDriveThumbnailUrl(driveId) {
    if (!driveId || !driveConfig.accessToken) return '';
    if (thumbUrlCache.has(driveId)) {
      const cached = thumbUrlCache.get(driveId);
      thumbUrlCache.delete(driveId);
      thumbUrlCache.set(driveId, cached);
      return cached;
    }
    try {
      const res = await driveApiFetch(
        `https://www.googleapis.com/drive/v3/files/${driveId}?fields=thumbnailLink&supportsAllDrives=true`,
        {},
        15000
      );
      if (res.ok) {
        const data = await res.json();
        if (data && data.thumbnailLink) {
          // Pedir ancho ~480px en lugar del minúsculo de 220px por defecto
          const sizedThumb = data.thumbnailLink.replace(/=s\d+$/, '=s480');
          thumbUrlCache.set(driveId, sizedThumb);
          while (thumbUrlCache.size > MAX_THUMB_CACHE_ITEMS) {
            const oldK = thumbUrlCache.keys().next().value;
            thumbUrlCache.delete(oldK);
          }
          return sizedThumb;
        }
      }
    } catch (e) {}
    return '';
  }

  // Usar thumbnailLink en las tarjetas de galería y dejar el archivo original completo solo para el visor
  window.hydrateDriveImages = function () {
    const imgs = document.querySelectorAll('img[data-drive-id]');
    imgs.forEach(async (img) => {
      const driveId = img.getAttribute('data-drive-id');
      if (!driveId) return;

      // Si ya está el original en caché de alta calidad, usarlo directamente
      if (driveConfig.driveBlobCache.has(driveId)) {
        const blobUrl = driveConfig.driveBlobCache.get(driveId);
        if (blobUrl && img.isConnected) {
          img.onload = () => applyAdaptiveThumbAspect(img);
          img.src = blobUrl;
          img.classList.remove('opacity-0');
          if (img.complete) applyAdaptiveThumbAspect(img);
        }
        return;
      }

      // Intentar primero la miniatura rápida de Google Drive
      const thumbUrl = await resolveDriveThumbnailUrl(driveId);
      if (thumbUrl && img.isConnected) {
        img.onload = () => applyAdaptiveThumbAspect(img);
        img.onerror = async () => {
          // Si la miniatura falla o expira, caer automáticamente al archivo completo
          const fullUrl = await resolveDriveBlobUrl(driveId);
          if (fullUrl && img.isConnected) {
            img.src = fullUrl;
            img.classList.remove('opacity-0');
          }
        };
        img.src = thumbUrl;
        img.classList.remove('opacity-0');
        return;
      }

      // Respaldo: descarga directa si Drive aún no generó miniatura para ese archivo
      const url = await resolveDriveBlobUrl(driveId);
      if (url && img.isConnected) {
        img.onload = () => applyAdaptiveThumbAspect(img);
        img.src = url;
        img.classList.remove('opacity-0');
        if (img.complete) applyAdaptiveThumbAspect(img);
      }
    });

    document.querySelectorAll('img:not([data-drive-id])').forEach((img) => {
      if (img.src) {
        img.onload = () => applyAdaptiveThumbAspect(img);
        if (img.complete) applyAdaptiveThumbAspect(img);
      }
    });

    if (typeof hydratePdfFirstPageCovers === 'function') {
      hydratePdfFirstPageCovers();
    }
  };

  // 3. Protección contra límite de 5 MB en localStorage sin detener la app
  window.saveLocalOnly = function () {
    try {
      const serialized = JSON.stringify(getSerializableLibraryData());
      localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
    } catch (e) {
      // Si se llena la cuota del navegador, liberar caché visual y reintentar una vez
      try {
        thumbUrlCache.clear();
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(getSerializableLibraryData()));
      } catch (err2) {
        console.warn('localStorage lleno; los datos siguen protegidos en Google Drive.');
      }
    }
  };

  // 4. Cola secuencial de guardado en Drive (evita que clics rápidos sobrescriban cambios)
  if (typeof window.persistLibrary === 'function') {
    const origPersistLibrary = window.persistLibrary;
    window.persistLibrary = function (logMessage = '') {
      saveLocalOnly();
      if (logMessage) pendingPersistLog = logMessage;
      if (persistScheduled) return persistQueuePromise;

      persistScheduled = true;
      persistQueuePromise = persistQueuePromise
        .then(
          () =>
            new Promise((resolve) => {
              setTimeout(async () => {
                persistScheduled = false;
                const msgToLog = pendingPersistLog;
                pendingPersistLog = '';
                try {
                  await origPersistLibrary.call(this, msgToLog);
                } catch (e) {
                  console.warn('Error en cola de guardado:', e);
                }
                resolve();
              }, 350);
            })
        )
        .catch(() => {
          persistScheduled = false;
        });

      return persistQueuePromise;
    };
  }
})();
