import { buildPaletteFromRGB, type TrackPalette } from './phonkLogic';

/**
 * Extracts a vivid, representative RGB color from any cover image URL using
 * an offscreen 36x36 canvas and scores pixels by vibrancy so dark shadows or
 * washed-out grays don't overpower the album art's signature hue.
 */
export async function extractPaletteFromImage(imageUrl: string): Promise<TrackPalette> {
  return new Promise((resolve) => {
    const fallback = buildPaletteFromRGB(214, 42, 68);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = 36;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(fallback);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let weightedR = 0;
        let weightedG = 0;
        let weightedB = 0;
        let totalWeight = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (r + g + b) / (3 * 255);

          // Favor saturated, mid-to-bright chromatic highlights over pure black asphalt
          if (lum < 0.06 || lum > 0.96) continue;
          const weight = 0.25 + sat * sat * 6.0 + (lum > 0.2 && lum < 0.75 ? 0.6 : 0.1);
          weightedR += r * weight;
          weightedG += g * weight;
          weightedB += b * weight;
          totalWeight += weight;
        }

        if (totalWeight <= 0) {
          resolve(fallback);
          return;
        }

        const avgR = weightedR / totalWeight;
        const avgG = weightedG / totalWeight;
        const avgB = weightedB / totalWeight;
        resolve(buildPaletteFromRGB(avgR, avgG, avgB));
      } catch {
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = imageUrl;
  });
}
