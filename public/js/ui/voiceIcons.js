export function outlineIcon(kind) {
  const svg = document.createElementNS(
    'http://www.w3.org/2000/svg', 'svg',
  );
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '22', height: '22',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) svg.setAttribute(key, value);

  const paths = kind === 'chat'
    ? [
        'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z',
        'M7 9h10M7 13h7',
      ]
    : [
        'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V5Z',
        'M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8',
        ...(kind === 'mute' ? ['M3 3l18 18'] : []),
      ];

  for (const d of paths) {
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
