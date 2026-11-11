// SPDX-License-Identifier: AGPL-3.0-only

/** WCAG 2.x relative luminance of an sRGB channel triplet. */
function luminance(red: number, green: number, blue: number): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

/**
 * The readable text color on `background` (spec §9.2 appearance). The widget paints the launcher
 * bubble in the bot's theme color, and a fixed white label is unreadable on a light theme.
 */
export function contrastText(hex: string): '#000000' | '#ffffff' {
  const value = hex.replace('#', '');
  const rgba = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const [red = 0, green = 0, blue = 0] = rgba;
  // Contrast against white vs black reduces to the luminance crossing the midpoint.
  return luminance(red, green, blue) > 0.179 ? '#000000' : '#ffffff';
}
