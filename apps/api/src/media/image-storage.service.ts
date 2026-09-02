import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp, { type OutputInfo } from 'sharp';

/** What a stored image looks like on a product's card. */
export interface StoredImage {
  id: string;
  /** The long side, in pixels, after resizing. */
  width: number;
  height: number;
  bytes: number;
  uploaded_at: string;
  uploaded_by: string;
}

/**
 * The widest a stored photo may be.
 *
 * A parts catalogue is read on a phone over mobile data, and a picture from
 * a phone camera is four thousand pixels across for no benefit at all here.
 * One size, because §12-Б.1 asks for a picture of the part, not a gallery.
 */
const MAX_EDGE = 1400;

/** A phone photo is a few megabytes; anything far past that is not a photo. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/**
 * Product images on disk (§12-Б.1).
 *
 * The bytes live in a directory the OWNER's server backs up; the database
 * keeps only the list. Two things matter more than they look:
 *
 * Nothing the uploader sends decides where a file lands. The name is a UUID
 * this service makes and the extension comes from what the bytes actually
 * are, so no request can write outside the directory or overwrite another
 * product's picture.
 *
 * Every upload is re-encoded through an image decoder rather than copied. A
 * file that only claims to be a JPEG fails to decode and is refused, and the
 * output carries no metadata the original may have had.
 */
@Injectable()
export class ImageStorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(
      config.get<string>('UPLOAD_DIR') ?? join(process.cwd(), 'var', 'uploads'),
    );
  }

  /** Where the files are, so an operator knows what to back up. */
  get directory(): string {
    return this.root;
  }

  async store(
    file: { buffer: Buffer; size: number; mimetype?: string } | undefined,
    uploadedBy: string,
  ): Promise<StoredImage> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Сүрөт файлы бош');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `Сүрөт ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБдан чоң болбошу керек`,
      );
    }

    let resized: { data: Buffer; info: OutputInfo };
    try {
      // Re-encoding is the check: bytes that are not really an image fail
      // here, and the result carries none of the original's metadata.
      resized = await sharp(file.buffer)
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

    const id = randomUUID();
    await mkdir(this.root, { recursive: true });
    await writeFile(this.pathOf(id), resized.data);

    return {
      id,
      width: resized.info.width,
      height: resized.info.height,
      bytes: resized.data.length,
      uploaded_at: new Date().toISOString(),
      uploaded_by: uploadedBy,
    };
  }

  async read(id: string): Promise<Buffer> {
    this.assertId(id);
    try {
      return await readFile(this.pathOf(id));
    } catch {
      throw new NotFoundException('Сүрөт табылган жок');
    }
  }

  async remove(id: string): Promise<void> {
    this.assertId(id);
    await rm(this.pathOf(id), { force: true });
  }

  /**
   * A stored id is a UUID this service generated.
   *
   * Checked again on the way out: an id reaching here from a URL is user
   * input, and a path is not somewhere to find that out the hard way.
   */
  private assertId(id: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ) {
      throw new NotFoundException('Сүрөт табылган жок');
    }
  }

  private pathOf(id: string): string {
    return join(this.root, `${id}.jpg`);
  }
}
