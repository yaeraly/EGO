import { BadRequestException } from '@nestjs/common';
import sharp, { type OutputInfo } from 'sharp';

/** A picture, ready to be stored. */
export interface EncodedImage {
  data: Buffer;
  contentType: string;
  width: number;
  height: number;
}

/**
 * The widest a stored photo may be.
 *
 * A parts catalogue is read on a phone over mobile data, and a picture from
 * a phone camera is four thousand pixels across for no benefit at all here.
 * One size, because §12-Б.1 asks for a picture of the part, not a gallery.
 */
export const MAX_EDGE = 1400;

/** A phone photo is a few megabytes; anything far past that is not a photo. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const CONTENT_TYPE = 'image/jpeg';

/**
 * Turns whatever was uploaded into the one picture the catalogue stores.
 *
 * Re-encoding rather than copying is the validation: a file that only claims
 * to be a JPEG fails to decode and is refused here, the result carries none
 * of the metadata the original may have had, and a four-thousand-pixel phone
 * photo comes out at the size a product card actually shows.
 */
export async function encodeProductImage(
  file: { buffer: Buffer; size: number } | undefined,
): Promise<EncodedImage> {
  if (!file?.buffer?.length) {
    throw new BadRequestException('Сүрөт файлы бош');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new BadRequestException(
      `Сүрөт ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБдан чоң болбошу керек`,
    );
  }

  let encoded: { data: Buffer; info: OutputInfo };
  try {
    encoded = await sharp(file.buffer)
      .rotate() // honour the phone's orientation before dropping the tag
      .resize({
        width: MAX_EDGE,
        height: MAX_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new BadRequestException(
      'Файл сүрөт эмес же бузулган (JPEG, PNG, WebP кабыл алынат)',
    );
  }

  return {
    data: encoded.data,
    contentType: CONTENT_TYPE,
    width: encoded.info.width,
    height: encoded.info.height,
  };
}
