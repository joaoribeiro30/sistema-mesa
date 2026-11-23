const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_SIZE_LABEL = '5 MB';
export const IMAGE_TOO_LARGE_MESSAGE = `A imagem excede o limite de ${IMAGE_SIZE_LABEL}.`;

const mediaTypesByExtension = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;
const acceptedMediaTypes = new Set<string>(Object.values(mediaTypesByExtension));
export const EVENT_IMAGE_ACCEPT = [...acceptedMediaTypes, ...Object.keys(mediaTypesByExtension).map((extension) => `.${extension}`)].join(',');

export function eventImageMediaType(file: File): string | null {
  const type = file.type.toLowerCase();
  if (acceptedMediaTypes.has(type)) return type;
  if (type && type !== 'application/octet-stream') return null;

  const extension = /\.(jpe?g|png|webp)$/i.exec(file.name)?.[1]?.toLowerCase();
  return extension ? mediaTypesByExtension[extension as keyof typeof mediaTypesByExtension] : null;
}

export function validateImageFile(file: File): string | null {
  if (file.size > MAX_IMAGE_BYTES) return IMAGE_TOO_LARGE_MESSAGE;
  if (!file.size) return 'O arquivo da imagem está vazio.';
  if (!eventImageMediaType(file)) return 'Formato inválido. Envie uma imagem PNG, JPEG ou WebP.';
  return null;
}
