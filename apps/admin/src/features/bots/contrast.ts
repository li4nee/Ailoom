// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WCAG relative luminance of one sRGB channel, as a fraction of full intensity.
 *
 * A copy of the API's rule (the widget paints the same label): the admin cannot import the api
 * package, and the preview must pick the same text color the widget will.
 */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** The readable label color on `background`; white unless the background is light. */
export function contrastText(hex: string): '#000000' | '#ffffff' {
  const value = hex.replace('#', '');
  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
  const luminance = 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  return luminance > 0.179 ? '#000000' : '#ffffff';
}
