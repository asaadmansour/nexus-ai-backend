import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class BriefDocumentStorageService {
  constructor(private readonly config: ConfigService) {
    cloudinary.config({
      cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
      api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
      api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
    });
  }

  async upload(projectId: string, fileName: string, content: Buffer) {
    const extension = extname(fileName).toLowerCase().replace(/^\./, '');
    const publicId = `${randomUUID()}-requirements`;
    const uploaded = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          type: 'authenticated',
          folder: `requirements-documents/${projectId}`,
          public_id: publicId,
          format: extension,
          overwrite: false,
          use_filename: false,
          unique_filename: false,
        },
        (error, result) => {
          if (error || !result) {
            reject(
              new InternalServerErrorException(
                'Failed to store the requirements document',
              ),
            );
            return;
          }
          resolve(result);
        },
      );
      stream.end(content);
    });
    return {
      publicId: uploaded.public_id,
      version: uploaded.version,
      format: uploaded.format || extension,
      secureUrl: uploaded.secure_url,
    };
  }

  signedDownloadUrl(publicId: string, format: string) {
    const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
    return {
      url: cloudinary.utils.private_download_url(publicId, format, {
        resource_type: 'raw',
        type: 'authenticated',
        expires_at: expiresAt,
        attachment: true,
      }),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  async download(publicId: string, format: string, expectedSize: number) {
    const { url } = this.signedDownloadUrl(publicId, format);
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Could not load the stored requirements document: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Could not load the stored requirements document (${response.status})`,
      );
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    if (declaredLength > expectedSize || declaredLength > 10 * 1024 * 1024) {
      throw new ServiceUnavailableException(
        'Stored requirements document size does not match its audit record',
      );
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length !== expectedSize) {
      throw new ServiceUnavailableException(
        'Stored requirements document size does not match its audit record',
      );
    }
    return content;
  }

  async remove(publicId: string) {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: 'raw',
      type: 'authenticated',
      invalidate: true,
    });
  }
}
