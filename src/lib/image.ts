'use client';

/** Wycina środek obrazka do kwadratu i zmniejsza do 512×512 (PNG). */
export async function toSquarePng(file: File, size = 512): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Nie udało się wczytać obrazka.'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, size, size);
    c.imageSmoothingQuality = 'high';
    c.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Błąd konwersji obrazka.'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

