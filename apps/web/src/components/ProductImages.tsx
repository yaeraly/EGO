import { useEffect, useState, type ChangeEvent } from 'react';
import { ApiError, api, apiObjectUrl, apiUpload } from '../api/client';
import type { ProductImage } from '../api/types';

/**
 * One stored photo.
 *
 * The bytes sit behind the same JWT as the rest of the API, so the URL is
 * fetched and turned into a blob rather than handed straight to `src`.
 */
export function ProductPhoto({
  productId,
  image,
  alt,
  size = 96,
}: {
  productId: string;
  image: ProductImage;
  alt: string;
  size?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;

    apiObjectUrl(`/products/${productId}/images/${image.id}`)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        revoked = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));

    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [productId, image.id]);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#f1f1f1',
        flex: '0 0 auto',
      }}
    >
      {url && (
        <img
          src={url}
          alt={alt}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

/** The photos as the product card shows them: the first one is the main. */
export function ProductGallery({
  productId,
  images,
}: {
  productId: string;
  images: ProductImage[];
}) {
  if (images.length === 0) return null;
  return (
    <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
      {images.map((image, index) => (
        <ProductPhoto
          key={image.id}
          productId={productId}
          image={image}
          alt="Товардын сүрөтү"
          size={index === 0 ? 160 : 72}
        />
      ))}
    </div>
  );
}

/**
 * Adding, ordering and removing a product's photos (§12-Б.1).
 *
 * The first picture in the list is the main one, so "негизги кыл" is a move
 * to the front — there is no separate flag that could disagree with the list.
 */
export function ProductImageEditor({ productId }: { productId: string }) {
  const [images, setImages] = useState<ProductImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<ProductImage[]>(`/products/${productId}/images`)
      .then((list) => {
        if (!cancelled) setImages(list);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(message(e));
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function run(work: () => Promise<ProductImage[]>) {
    setBusy(true);
    setError(null);
    try {
      setImages(await work());
    } catch (e: unknown) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (chosen.length === 0) return;

    await run(async () => {
      let list: ProductImage[] = images ?? [];
      for (const file of chosen) {
        list = await apiUpload<ProductImage[]>(
          `/products/${productId}/images`,
          file,
        );
      }
      return list;
    });
  }

  return (
    <div className="stack">
      {error && <p className="banner error">{error}</p>}

      <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
        {(images ?? []).map((image, index) => (
          <div key={image.id} className="stack" style={{ gap: 4 }}>
            <ProductPhoto
              productId={productId}
              image={image}
              alt="Товардын сүрөтү"
            />
            {index === 0 ? (
              <span className="badge ok">Негизги</span>
            ) : (
              <button
                type="button"
                className="link"
                style={{ fontSize: '0.78rem' }}
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api<ProductImage[]>(
                      `/products/${productId}/images/${image.id}/main`,
                      { method: 'POST' },
                    ),
                  )
                }
              >
                Негизги кыл
              </button>
            )}
            <button
              type="button"
              className="link"
              style={{ fontSize: '0.78rem', color: 'var(--danger)' }}
              disabled={busy}
              onClick={() =>
                run(() =>
                  api<ProductImage[]>(
                    `/products/${productId}/images/${image.id}`,
                    { method: 'DELETE' },
                  ),
                )
              }
            >
              Өчүрүү
            </button>
          </div>
        ))}
      </div>

      <label>
        Сүрөт кошуу
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={pick}
        />
      </label>
      <p className="muted" style={{ margin: 0 }}>
        Телефондон тартып же файлдан тандаңыз. Биринчи сүрөт — негизгиси.
      </p>
    </div>
  );
}

/**
 * Photos chosen before the product exists.
 *
 * A new product has no id to upload against, so the files are held here and
 * sent by the form once the product is created.
 */
export function PendingImagePicker({
  files,
  onChange,
}: {
  files: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div className="stack">
      <div className="inline" style={{ flexWrap: 'wrap', gap: 8 }}>
        {files.map((file, index) => (
          <div key={`${file.name}-${index}`} className="stack" style={{ gap: 4 }}>
            <LocalPhoto file={file} />
            <button
              type="button"
              className="link"
              style={{ fontSize: '0.78rem', color: 'var(--danger)' }}
              onClick={() => onChange(files.filter((_, i) => i !== index))}
            >
              Өчүрүү
            </button>
          </div>
        ))}
      </div>
      <label>
        Товардын сүрөтү
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            onChange([...files, ...Array.from(event.target.files ?? [])]);
            event.target.value = '';
          }}
        />
      </label>
      <p className="muted" style={{ margin: 0 }}>
        Сүрөттөр товар сакталгандан кийин жүктөлөт. Биринчиси — негизгиси.
      </p>
    </div>
  );
}

function LocalPhoto({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div
      style={{
        width: 96,
        height: 96,
        borderRadius: 8,
        overflow: 'hidden',
        background: '#f1f1f1',
      }}
    >
      {url && (
        <img
          src={url}
          alt={file.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </div>
  );
}

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : String(error);
}
